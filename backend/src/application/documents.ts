import { isPeriodLocked } from '../domain/stateMachines';
import type {
  AgentTask,
  DocumentRecord,
  DocumentType,
  Extraction,
  FactorSet,
  Job,
  Measurement,
  MeasurementType,
  ReportingPeriod,
} from '../domain/types';
import { isSupportedUnit, toCanonical, UnitError } from '../domain/units';
import {
  AppError,
  audit,
  badRequest,
  conflict,
  forbidden,
  newId,
  notFound,
  nowIso,
  orgPath,
  requireFacility,
  requireOrg,
  requireRole,
  sha256,
  type Deps,
  type RequestContext,
} from './core';
import { extractWithGoogleAi, parseSpreadsheet } from './extraction';
import { getActiveFactorSet } from './factors';
import { getPeriod } from './organizations';
import { assertQuota, incrementUsage } from './usage';
import { afterEvidenceChange, setTaskStatus } from './carbonops';

const ALLOWED = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
} as const;
type AllowedMime = keyof typeof ALLOWED;

/** Determines the real file type from its bytes, never trusting the browser-declared MIME type alone. */
export function sniffMime(buf: Buffer, declared: string, fileName: string): AllowedMime | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0x50 && buf[1] === 0x4b && /\.xlsx$/i.test(fileName)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (/\.csv$/i.test(fileName) || declared === 'text/csv') {
    const sample = buf.subarray(0, 4096).toString('utf8');
    // Reject binary content masquerading as CSV.
    if (!/[\u0000-\u0008\u000e-\u001f]/.test(sample)) return 'text/csv';
  }
  return null;
}

export interface UploadInput {
  periodId: string;
  declaredType?: DocumentType;
  relatedTaskId?: string;
  fileName: string;
  declaredMime: string;
  data: Buffer;
}

export async function uploadDocument(deps: Deps, ctx: RequestContext, input: UploadInput): Promise<DocumentRecord> {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'WORKER');
  const period = await getPeriod(deps, ctx, input.periodId);
  if (isPeriodLocked(period.status)) throw conflict(`Period ${period.key} is ${period.status}; reopen it before adding evidence`);
  if (input.data.length === 0) throw badRequest('The file is empty');
  if (input.data.length > deps.config.maxUploadBytes) throw new AppError(413, 'FILE_TOO_LARGE', `Files must be under ${Math.round(deps.config.maxUploadBytes / 1048576)} MB`);
  const mime = sniffMime(input.data, input.declaredMime, input.fileName);
  if (!mime) throw new AppError(415, 'UNSUPPORTED_FILE', 'Only PDF, JPG, PNG, CSV and XLSX files are accepted');
  await assertQuota(deps, orgId, 'documentsProcessed');

  const checksum = sha256(input.data);
  const dupes = await deps.store.list<DocumentRecord>(orgPath(orgId, 'documents'), [['checksum', '==', checksum]]);
  const activeDupe = dupes.find((d) => d.status !== 'REJECTED' && d.status !== 'FAILED');
  if (activeDupe) {
    throw new AppError(409, 'DUPLICATE_DOCUMENT', `This exact file was already uploaded (${activeDupe.fileName}, period ${activeDupe.periodId.split('_').pop()})`, { documentId: activeDupe.id });
  }

  let task: AgentTask | null = null;
  if (input.relatedTaskId) {
    task = await deps.store.get<AgentTask>(orgPath(orgId, 'tasks', input.relatedTaskId));
    if (!task || task.periodId !== period.id) throw badRequest('The task does not belong to this reporting period');
    if (ctx.role === 'WORKER' && task.assigneeUid !== ctx.uid) throw forbidden('This task is assigned to someone else');
    if (task.approvalState === 'PENDING_APPROVAL') throw conflict('This task has not been approved yet');
  }

  const id = newId('doc');
  const jobId = `job-${id}`;
  const safeName = input.fileName.replace(/[^\w.\-]+/g, '_').slice(-100);
  const storagePath = `orgs/${orgId}/periods/${period.id}/${id}/${safeName}`;
  await deps.files.write(storagePath, input.data, mime);
  const now = nowIso(deps);
  const doc: DocumentRecord = {
    id,
    organizationId: orgId,
    facilityId: period.facilityId,
    periodId: period.id,
    declaredType: input.declaredType,
    fileName: input.fileName.slice(0, 200),
    contentType: mime,
    sizeBytes: input.data.length,
    storagePath,
    checksum,
    status: 'QUEUED',
    uploadedBy: ctx.uid,
    uploadedAt: now,
    relatedTaskId: task?.id,
    jobId,
  };
  const job: Job = {
    id: jobId,
    organizationId: orgId,
    type: 'PROCESS_DOCUMENT',
    payload: { documentId: id },
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
  };
  await deps.store.create(orgPath(orgId, 'documents', id), doc);
  await deps.store.create(orgPath(orgId, 'jobs', jobId), job);
  await audit(deps, orgId, ctx.uid, 'DOCUMENT_UPLOADED', 'document', id, `Uploaded "${doc.fileName}" to period ${period.key}`);
  if (task) {
    await deps.store.update(orgPath(orgId, 'tasks', task.id), { responseDocumentIds: [...task.responseDocumentIds, id] });
    await setTaskStatus(deps, orgId, task.id, 'SUBMITTED', ctx.uid, `Evidence uploaded: ${doc.fileName}`);
  }
  if (['COLLECTING_DATA', 'NEEDS_CORRECTION', 'READY_FOR_REVIEW'].includes(period.status)) {
    await deps.store.update(orgPath(orgId, 'periods', period.id), { status: 'PROCESSING', updatedAt: now });
  }
  await deps.queue.enqueue({ jobId, organizationId: orgId, type: 'PROCESS_DOCUMENT', payload: { documentId: id } });
  return doc;
}

/**
 * Background worker. Idempotent: a job that already succeeded is skipped; a job currently
 * running elsewhere is not processed twice. Throws to signal Cloud Tasks to retry.
 */
export async function processDocumentJob(deps: Deps, job: { jobId: string; organizationId: string }): Promise<'done' | 'skipped' | 'failed'> {
  const orgId = job.organizationId;
  const jobPath = orgPath(orgId, 'jobs', job.jobId);
  const claim = await deps.store.transaction(async (tx) => {
    const j = await tx.get<Job>(jobPath);
    if (!j) return null;
    if (j.status === 'SUCCEEDED' || j.status === 'FAILED') return null;
    const staleMs = deps.clock.now().getTime() - new Date(j.updatedAt).getTime();
    if (j.status === 'RUNNING' && staleMs < 10 * 60_000) return null;
    const next = { status: 'RUNNING' as const, attempts: j.attempts + 1, updatedAt: nowIso(deps) };
    tx.update(jobPath, next);
    return { ...j, ...next };
  });
  if (!claim) return 'skipped';

  const docPath = orgPath(orgId, 'documents', claim.payload.documentId);
  const doc = await deps.store.get<DocumentRecord>(docPath);
  if (!doc) {
    await deps.store.update(jobPath, { status: 'FAILED', lastError: 'Document not found', updatedAt: nowIso(deps) });
    return 'failed';
  }
  await deps.store.update(docPath, { status: 'PROCESSING' });
  try {
    const data = await deps.files.read(doc.storagePath);
    const isSheet = doc.contentType === 'text/csv' || doc.contentType.includes('spreadsheetml');
    if (!isSheet) await assertQuota(deps, orgId, 'aiCalls');
    const outcome = isSheet ? await parseSpreadsheet(data, doc.contentType) : await extractWithGoogleAi(deps, data, doc.contentType, doc.declaredType);
    if (!isSheet) await incrementUsage(deps, orgId, 'aiCalls');
    let rawTextRef: string | null = null;
    if (outcome.ocrText) {
      rawTextRef = `${doc.storagePath}.ocr.txt`;
      await deps.files.write(rawTextRef, Buffer.from(outcome.ocrText, 'utf8'), 'text/plain');
    }
    const ext: Extraction = {
      id: newId('ext'),
      organizationId: orgId,
      documentId: doc.id,
      periodId: doc.periodId,
      facilityId: doc.facilityId,
      documentType: outcome.documentType,
      supplierName: outcome.supplierName,
      invoiceNumber: outcome.invoiceNumber,
      invoiceDate: outcome.invoiceDate,
      detectedLanguage: outcome.detectedLanguage,
      items: outcome.items,
      warnings: outcome.warnings,
      engine: outcome.engine,
      modelVersion: outcome.modelVersion,
      rawTextRef,
      status: 'NEEDS_REVIEW',
      createdAt: nowIso(deps),
    };
    await deps.store.set(orgPath(orgId, 'extractions', ext.id), ext);
    await deps.store.update(docPath, { status: 'NEEDS_REVIEW', extractionId: ext.id, error: null });
    await deps.store.update(jobPath, { status: 'SUCCEEDED', updatedAt: nowIso(deps) });
    await incrementUsage(deps, orgId, 'documentsProcessed');
    await audit(deps, orgId, 'system:worker', 'DOCUMENT_EXTRACTED', 'document', doc.id, `Extracted ${ext.items.length} value(s) using ${ext.engine}; awaiting human confirmation`);
    await afterEvidenceChange(deps, orgId, doc.periodId, 'system:worker', { recalculate: false });
    return 'done';
  } catch (e) {
    const message = safeError(e);
    const finalAttempt = claim.attempts >= claim.maxAttempts;
    await deps.store.update(jobPath, { status: finalAttempt ? 'FAILED' : 'QUEUED', lastError: message, updatedAt: nowIso(deps) });
    if (finalAttempt) {
      await deps.store.update(docPath, { status: 'FAILED', error: message });
      await audit(deps, orgId, 'system:worker', 'DOCUMENT_FAILED', 'document', doc.id, `Processing failed after ${claim.attempts} attempt(s): ${message}`);
      await afterEvidenceChange(deps, orgId, doc.periodId, 'system:worker', { recalculate: false });
      return 'failed';
    }
    await deps.store.update(docPath, { status: 'QUEUED', error: `Retrying after: ${message}` });
    throw new Error(`Retryable processing failure: ${message}`);
  }
}

/** Manual retry of a failed document (owner/worker). */
export async function retryDocument(deps: Deps, ctx: RequestContext, documentId: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'WORKER');
  const doc = await getDocument(deps, ctx, documentId);
  if (doc.status !== 'FAILED') throw conflict('Only failed documents can be retried');
  const jobId = `job-${doc.id}-r${Date.now()}`;
  const now = nowIso(deps);
  await deps.store.create(orgPath(orgId, 'jobs', jobId), { id: jobId, organizationId: orgId, type: 'PROCESS_DOCUMENT', payload: { documentId: doc.id }, status: 'QUEUED', attempts: 0, maxAttempts: 3, createdAt: now, updatedAt: now } satisfies Job);
  await deps.store.update(orgPath(orgId, 'documents', doc.id), { status: 'QUEUED', jobId, error: null });
  await deps.queue.enqueue({ jobId, organizationId: orgId, type: 'PROCESS_DOCUMENT', payload: { documentId: doc.id } });
  return { ...doc, status: 'QUEUED' as const, jobId };
}

function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/\s+/g, ' ').slice(0, 300);
}

export async function listDocuments(deps: Deps, ctx: RequestContext, periodId: string): Promise<DocumentRecord[]> {
  const orgId = requireOrg(ctx);
  await getPeriod(deps, ctx, periodId);
  const docs = await deps.store.list<DocumentRecord>(orgPath(orgId, 'documents'), [['periodId', '==', periodId]]);
  return docs.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function getDocument(deps: Deps, ctx: RequestContext, documentId: string): Promise<DocumentRecord> {
  const orgId = requireOrg(ctx);
  if (ctx.role === 'BUYER') throw forbidden();
  const d = await deps.store.get<DocumentRecord>(orgPath(orgId, 'documents', documentId));
  if (!d) throw notFound('Document');
  requireFacility(ctx, d.facilityId);
  return d;
}

export async function getDocumentFile(deps: Deps, ctx: RequestContext, documentId: string) {
  const d = await getDocument(deps, ctx, documentId);
  return { data: await deps.files.read(d.storagePath), contentType: d.contentType, fileName: d.fileName };
}

export async function getExtraction(deps: Deps, ctx: RequestContext, extractionId: string): Promise<Extraction> {
  const orgId = requireOrg(ctx);
  const e = await deps.store.get<Extraction>(orgPath(orgId, 'extractions', extractionId));
  if (!e) throw notFound('Extraction');
  requireFacility(ctx, e.facilityId);
  return e;
}

export interface ConfirmItemInput {
  index: number;
  include: boolean;
  measurementType: MeasurementType;
  reportingMonth: string;
  quantity: number;
  unit: string;
  fuelType?: string | null;
}

/** Human confirmation of AI-extracted values. Only confirmed values become measurements. */
export async function confirmExtraction(deps: Deps, ctx: RequestContext, extractionId: string, items: ConfirmItemInput[]) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'WORKER', 'REVIEWER');
  const ext = await getExtraction(deps, ctx, extractionId);
  const period = await deps.store.get<ReportingPeriod>(orgPath(orgId, 'periods', ext.periodId));
  if (!period) throw notFound('Reporting period');
  if (isPeriodLocked(period.status)) throw conflict(`Period ${period.key} is locked`);
  const included = items.filter((i) => i.include);
  if (!included.length) throw badRequest('Select at least one value to confirm, or reject the document');

  const factors: FactorSet | null = await getActiveFactorSet(deps).catch(() => null);
  const now = nowIso(deps);
  const measurements: Measurement[] = [];
  for (const it of included) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(it.reportingMonth)) throw badRequest(`Item ${it.index}: reporting month must be YYYY-MM`);
    if (!isSupportedUnit(it.measurementType, it.unit)) throw badRequest(`Item ${it.index}: unit "${it.unit}" is not valid for ${it.measurementType}`);
    let canonical: { quantity: number; unit: 'kWh' | 'kg' | 't' };
    try {
      canonical = toCanonical(it.measurementType, it.quantity, it.unit, factors);
    } catch (e) {
      if (e instanceof UnitError) throw badRequest(`Item ${it.index}: ${e.message}`);
      throw e;
    }
    const original = ext.items[it.index];
    const corrected =
      !original ||
      original.quantity !== it.quantity ||
      (original.unit ?? '') !== it.unit ||
      original.reportingMonth !== it.reportingMonth ||
      original.measurementType !== it.measurementType;
    measurements.push({
      id: newId('mea'),
      organizationId: orgId,
      facilityId: ext.facilityId,
      periodId: ext.periodId,
      type: it.measurementType,
      reportingMonth: it.reportingMonth,
      quantity: it.quantity,
      unit: it.unit,
      canonicalQuantity: canonical.quantity,
      canonicalUnit: canonical.unit,
      fuelType: it.measurementType === 'FUEL' ? (it.fuelType ?? original?.fuelType ?? 'diesel') : null,
      sourceDocumentId: ext.documentId,
      extractionId: ext.id,
      itemIndex: it.index,
      sourceSnippet: original?.sourceSnippet ?? null,
      page: original?.page ?? null,
      aiValue: original?.quantity ?? null,
      aiUnit: original?.unit ?? null,
      corrected,
      reviewState: 'CONFIRMED',
      confirmedBy: ctx.uid,
      confirmedAt: now,
    });
  }

  const previous = await deps.store.list<Measurement>(orgPath(orgId, 'measurements'), [['extractionId', '==', ext.id]]);
  for (const p of previous.filter((x) => x.reviewState === 'CONFIRMED')) {
    await deps.store.update(orgPath(orgId, 'measurements', p.id), { reviewState: 'SUPERSEDED' });
  }
  for (const m of measurements) await deps.store.set(orgPath(orgId, 'measurements', m.id), m);
  await deps.store.update(orgPath(orgId, 'extractions', ext.id), { status: 'CONFIRMED', reviewedBy: ctx.uid, reviewedAt: now });
  await deps.store.update(orgPath(orgId, 'documents', ext.documentId), { status: 'CONFIRMED' });
  for (const m of measurements) {
    await audit(
      deps, orgId, ctx.uid, m.corrected ? 'VALUE_CORRECTED' : 'VALUE_CONFIRMED', 'measurement', m.id,
      `${m.type} ${m.quantity} ${m.unit} for ${m.reportingMonth} confirmed${m.corrected ? ' with correction' : ''}`,
      m.corrected ? { quantity: m.aiValue, unit: m.aiUnit } : null,
      { quantity: m.quantity, unit: m.unit, reportingMonth: m.reportingMonth },
    );
  }

  const doc = await deps.store.get<DocumentRecord>(orgPath(orgId, 'documents', ext.documentId));
  if (doc?.relatedTaskId) await setTaskStatus(deps, orgId, doc.relatedTaskId, 'REVALIDATING', ctx.uid, 'Evidence confirmed; re-checking');
  const analysis = await afterEvidenceChange(deps, orgId, ext.periodId, ctx.uid, { recalculate: true });
  return { measurements, analysis };
}

export async function rejectExtraction(deps: Deps, ctx: RequestContext, extractionId: string, reason: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'WORKER', 'REVIEWER');
  const ext = await getExtraction(deps, ctx, extractionId);
  const now = nowIso(deps);
  await deps.store.update(orgPath(orgId, 'extractions', ext.id), { status: 'REJECTED', reviewedBy: ctx.uid, reviewedAt: now });
  await deps.store.update(orgPath(orgId, 'documents', ext.documentId), { status: 'REJECTED' });
  const prior = await deps.store.list<Measurement>(orgPath(orgId, 'measurements'), [['extractionId', '==', ext.id]]);
  for (const p of prior) await deps.store.update(orgPath(orgId, 'measurements', p.id), { reviewState: 'SUPERSEDED' });
  await audit(deps, orgId, ctx.uid, 'EXTRACTION_REJECTED', 'extraction', ext.id, `Extraction rejected: ${reason.slice(0, 200)}`);
  const doc = await deps.store.get<DocumentRecord>(orgPath(orgId, 'documents', ext.documentId));
  if (doc?.relatedTaskId) await setTaskStatus(deps, orgId, doc.relatedTaskId, 'WAITING_FOR_EVIDENCE', ctx.uid, 'Submitted evidence was rejected');
  await afterEvidenceChange(deps, orgId, ext.periodId, ctx.uid, { recalculate: true });
  return { ok: true };
}

export async function listMeasurements(deps: Deps, ctx: RequestContext, periodId: string): Promise<Measurement[]> {
  const orgId = requireOrg(ctx);
  await getPeriod(deps, ctx, periodId);
  return deps.store.list<Measurement>(orgPath(orgId, 'measurements'), [['periodId', '==', periodId], ['reviewState', '==', 'CONFIRMED']]);
}
