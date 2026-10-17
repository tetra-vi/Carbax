import { randomBytes } from 'node:crypto';
import { assessReadiness } from '../domain/readiness';
import type {
  DocumentRecord,
  EvidenceIssue,
  Facility,
  Measurement,
  Member,
  ReadinessAssessment,
  Report,
  ReportingPeriod,
  ShareGrant,
} from '../domain/types';
import { renderCsv, renderPdf, renderXlsx, type ReportModel } from '../infra/reportRender';
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
  requireOrg,
  requireRole,
  sha256,
  type Deps,
  type RequestContext,
} from './core';
import { confirmedForPeriod, latestCalculation } from './calculations';
import { getFactorSet } from './factors';
import { getPeriod, transitionPeriod } from './organizations';
import { assertFeature, getOrganization, incrementUsage, meteredAi } from './usage';
import { notify } from './notifications';

// ---------- Verification readiness ----------

async function computeReadiness(deps: Deps, orgId: string, period: ReportingPeriod, reviewerApproved: boolean): Promise<ReadinessAssessment> {
  const [documents, measurements, openIssues] = await Promise.all([
    deps.store.list<DocumentRecord>(orgPath(orgId, 'documents'), [['periodId', '==', period.id]]),
    deps.store.list<Measurement>(orgPath(orgId, 'measurements'), [['periodId', '==', period.id]]),
    deps.store.list<EvidenceIssue>(orgPath(orgId, 'issues'), [['periodId', '==', period.id], ['status', '==', 'OPEN']]),
  ]);
  const calculation = await latestCalculation(deps, orgId, period.id);
  const factorSet = calculation ? await getFactorSet(deps, calculation.factorSetId).catch(() => null) : null;
  const { status, checks } = assessReadiness({ period, documents: documents.filter((d) => d.status !== 'REJECTED'), measurements, openIssues, calculation, factorSet, reviewerApproved });
  return {
    status,
    checks,
    outstandingIssues: openIssues.map((i) => ({ id: i.id, title: i.title, severity: i.severity })),
    summary: null,
    summaryIsAiGenerated: false,
    assessedAt: nowIso(deps),
  };
}

export async function assessPeriodReadiness(deps: Deps, ctx: RequestContext, periodId: string, withSummary = true) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  const period = await getPeriod(deps, ctx, periodId);
  const approved = (await deps.store.list<Report>(orgPath(orgId, 'reports'), [['periodId', '==', periodId], ['status', '==', 'APPROVED']])).length > 0;
  const r = await computeReadiness(deps, orgId, period, approved);
  if (withSummary) {
    try {
      r.summary = await meteredAi(deps, orgId, () =>
        deps.llm.generateText({
          system:
            'Summarise an evidence-readiness checklist for a compliance reviewer in at most 90 words: what is proven, what is estimated, and what a verifier must still check. ' +
            'Never say the data is certified, compliant or verified. Use only the checklist provided.' +
            (ctx.language !== 'en' ? ` Answer in the language with ISO code "${ctx.language}".` : ''),
          parts: [{ text: JSON.stringify({ status: r.status, checks: r.checks, outstanding: r.outstandingIssues }) }],
        }),
      );
      r.summaryIsAiGenerated = true;
    } catch {
      r.summary = null;
    }
  }
  await deps.store.update(orgPath(orgId, 'periods', periodId), { latestReadiness: r.status });
  return r;
}

// ---------- Reports ----------

async function buildModel(deps: Deps, orgId: string, report: Report, readiness: ReadinessAssessment): Promise<ReportModel> {
  const period = await deps.store.get<ReportingPeriod>(orgPath(orgId, 'periods', report.periodId));
  const calc = await deps.store.get<import('../domain/types').CalculationRun>(orgPath(orgId, 'calculations', report.calculationId));
  if (!period || !calc) throw notFound('Report inputs');
  const organization = await getOrganization(deps, orgId);
  const facility = (await deps.store.get<Facility>(orgPath(orgId, 'facilities', report.facilityId)))!;
  const measurements = await confirmedForPeriod(deps, orgId, period);
  const documents = await deps.store.list<DocumentRecord>(orgPath(orgId, 'documents'), [['periodId', '==', period.id]]);
  const openIssues = await deps.store.list<EvidenceIssue>(orgPath(orgId, 'issues'), [['periodId', '==', period.id], ['status', '==', 'OPEN']]);
  const reviewer = report.reviewerUid ? await deps.store.get<Member>(orgPath(orgId, 'members', report.reviewerUid)) : null;
  return { report, organization, facility, calculation: calc, measurements, documents, openIssues, readiness, reviewerName: reviewer?.displayName ?? null, generatedAt: nowIso(deps) };
}

async function renderAndStore(deps: Deps, orgId: string, report: Report, readiness: ReadinessAssessment, suffix: string) {
  const model = await buildModel(deps, orgId, report, readiness);
  const base = `orgs/${orgId}/reports/${report.id}/${suffix}`;
  const [pdf, xlsx] = await Promise.all([renderPdf(model), renderXlsx(model)]);
  await deps.files.write(`${base}.pdf`, pdf, 'application/pdf');
  await deps.files.write(`${base}.csv`, renderCsv(model), 'text/csv');
  await deps.files.write(`${base}.xlsx`, xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return { pdfPath: `${base}.pdf`, csvPath: `${base}.csv`, xlsxPath: `${base}.xlsx` };
}

export async function generateReport(deps: Deps, ctx: RequestContext, periodId: string): Promise<Report> {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  const period = await getPeriod(deps, ctx, periodId);
  if (period.status === 'APPROVED' || period.status === 'CLOSED') throw conflict('This period already has an approved report. Reopen the period to create a corrected version.');
  const calc = await latestCalculation(deps, orgId, periodId);
  if (!calc) throw conflict('Run a calculation before generating a report');
  const existing = await deps.store.list<Report>(orgPath(orgId, 'reports'), [['periodId', '==', periodId]]);
  for (const r of existing.filter((x) => x.status === 'DRAFT')) await deps.store.update(orgPath(orgId, 'reports', r.id), { status: 'SUPERSEDED' });
  const readiness = await computeReadiness(deps, orgId, period, false);
  const report: Report = {
    id: newId('rep'),
    organizationId: orgId,
    facilityId: period.facilityId,
    periodId,
    periodKey: period.key,
    version: existing.length + 1,
    calculationId: calc.id,
    readiness,
    status: 'DRAFT',
    pdfPath: null,
    csvPath: null,
    xlsxPath: null,
    createdBy: ctx.uid,
    createdAt: nowIso(deps),
  };
  Object.assign(report, await renderAndStore(deps, orgId, report, readiness, `v${report.version}-draft`));
  await deps.store.set(orgPath(orgId, 'reports', report.id), report);
  await incrementUsage(deps, orgId, 'reportsGenerated');
  await audit(deps, orgId, ctx.uid, 'REPORT_GENERATED', 'report', report.id, `Draft report v${report.version} for ${period.key} (readiness ${readiness.status})`);
  const reviewers = (await deps.store.list<Member>(orgPath(orgId, 'members'), [['role', '==', 'REVIEWER']])).filter((m) => m.status === 'ACTIVE');
  for (const r of reviewers) await notify(deps, orgId, r.uid, `Draft evidence package for ${period.key} is ready for review.`, 'Review requested', `/review/${report.id}`);
  return report;
}

export async function getReport(deps: Deps, ctx: RequestContext, reportId: string): Promise<Report> {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  const r = await deps.store.get<Report>(orgPath(orgId, 'reports', reportId));
  if (!r) throw notFound('Report');
  await getPeriod(deps, ctx, r.periodId);
  return r;
}

export async function listReports(deps: Deps, ctx: RequestContext, periodId?: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  const list = await deps.store.list<Report>(orgPath(orgId, 'reports'), periodId ? [['periodId', '==', periodId]] : []);
  return list.filter((r) => ctx.facilityIds.includes('*') || ctx.facilityIds.includes(r.facilityId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Reviewer decision. Approved reports are immutable; corrections require a new version. */
export async function reviewReport(deps: Deps, ctx: RequestContext, reportId: string, decision: 'APPROVE' | 'REJECT', comment: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'REVIEWER');
  const report = await getReport(deps, ctx, reportId);
  if (report.status !== 'DRAFT') throw conflict(`Report is ${report.status}; only drafts can be reviewed`);
  if (!comment?.trim()) throw badRequest('A reviewer comment is required');
  const period = await getPeriod(deps, ctx, report.periodId);
  const latest = await latestCalculation(deps, orgId, period.id);
  if (latest?.id !== report.calculationId) throw conflict('Evidence changed after this draft was generated; generate a new draft');
  const now = nowIso(deps);
  if (decision === 'REJECT') {
    await deps.store.update(orgPath(orgId, 'reports', reportId), { status: 'REJECTED', reviewerUid: ctx.uid, reviewerComment: comment.slice(0, 2000), reviewedAt: now });
    await transitionPeriod(deps, orgId, period.id, 'NEEDS_CORRECTION', ctx.uid, 'Report rejected by reviewer').catch(() => undefined);
    await audit(deps, orgId, ctx.uid, 'REPORT_REJECTED', 'report', reportId, `Reviewer rejected v${report.version}: ${comment.slice(0, 200)}`);
    if (report.createdBy && !report.createdBy.includes(':')) await notify(deps, orgId, report.createdBy, comment.slice(0, 300), `Report ${report.periodKey} needs correction`, `/reports`);
    return getReport(deps, ctx, reportId);
  }
  const pre = await computeReadiness(deps, orgId, period, false);
  if (pre.status !== 'READY_FOR_HUMAN_REVIEW') {
    throw new AppError(409, 'NOT_READY', `Cannot approve: readiness is ${pre.status}. Resolve the open checks first.`, { checks: pre.checks.filter((c) => !c.passed) });
  }
  const approvedReport: Report = { ...report, status: 'APPROVED', reviewerUid: ctx.uid, reviewerComment: comment.slice(0, 2000), reviewedAt: now };
  const readiness = await computeReadiness(deps, orgId, period, true);
  approvedReport.readiness = readiness;
  Object.assign(approvedReport, await renderAndStore(deps, orgId, approvedReport, readiness, `v${report.version}-approved`));
  await deps.store.set(orgPath(orgId, 'reports', reportId), approvedReport);
  if (period.status !== 'READY_FOR_REVIEW') await transitionPeriod(deps, orgId, period.id, 'READY_FOR_REVIEW', ctx.uid).catch(() => undefined);
  await transitionPeriod(deps, orgId, period.id, 'APPROVED', ctx.uid, `Report v${report.version} approved`);
  await deps.store.update(orgPath(orgId, 'periods', period.id), { latestReadiness: readiness.status });
  await audit(deps, orgId, ctx.uid, 'REPORT_APPROVED', 'report', reportId, `Reviewer approved v${report.version} for ${period.key}`);
  return approvedReport;
}

export async function downloadReport(deps: Deps, ctx: RequestContext, reportId: string, format: 'pdf' | 'csv' | 'xlsx') {
  const r = await getReport(deps, ctx, reportId);
  return readReportFile(deps, r, format);
}

async function readReportFile(deps: Deps, r: Report, format: 'pdf' | 'csv' | 'xlsx') {
  const path = format === 'pdf' ? r.pdfPath : format === 'csv' ? r.csvPath : r.xlsxPath;
  if (!path) throw notFound('Report file');
  const contentType = format === 'pdf' ? 'application/pdf' : format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return { data: await deps.files.read(path), contentType, fileName: `ecuraa-${r.periodKey}-v${r.version}-${r.status.toLowerCase()}.${format}` };
}

// ---------- Buyer sharing ----------

export async function createShare(deps: Deps, ctx: RequestContext, reportId: string, input: { buyerName: string; buyerEmail: string; expiresInDays: number }) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  await assertFeature(deps, orgId, 'BUYER_SHARING');
  const report = await getReport(deps, ctx, reportId);
  if (report.status !== 'APPROVED') throw conflict('Only approved reports can be shared with buyers');
  const days = Math.min(Math.max(1, Math.floor(input.expiresInDays)), deps.config.shareLinkMaxDays);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const grant: ShareGrant = {
    id: newId('shr'),
    organizationId: orgId,
    reportId,
    buyerName: input.buyerName,
    buyerEmail: input.buyerEmail.toLowerCase(),
    tokenHash,
    createdBy: ctx.uid,
    createdAt: nowIso(deps),
    expiresAt: new Date(deps.clock.now().getTime() + days * 86400_000).toISOString(),
    accessLog: [],
    clarifications: [],
  };
  await deps.store.set(orgPath(orgId, 'shares', grant.id), grant);
  await deps.store.set(`shareTokens/${tokenHash}`, { organizationId: orgId, shareId: grant.id });
  await audit(deps, orgId, ctx.uid, 'REPORT_SHARED', 'share', grant.id, `Report ${report.periodKey} v${report.version} shared with ${grant.buyerName} until ${grant.expiresAt.slice(0, 10)}`);
  const { tokenHash: _omit, ...publicGrant } = grant;
  return { ...publicGrant, shareLink: `${deps.config.publicAppUrl}/shared/${token}` };
}

export async function listShares(deps: Deps, ctx: RequestContext, reportId: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  await getReport(deps, ctx, reportId);
  const list = await deps.store.list<ShareGrant>(orgPath(orgId, 'shares'), [['reportId', '==', reportId]]);
  return list.map(({ tokenHash: _t, ...g }) => g);
}

export async function revokeShare(deps: Deps, ctx: RequestContext, shareId: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  const g = await deps.store.get<ShareGrant>(orgPath(orgId, 'shares', shareId));
  if (!g) throw notFound('Share');
  await deps.store.update(orgPath(orgId, 'shares', shareId), { revokedAt: nowIso(deps) });
  await audit(deps, orgId, ctx.uid, 'SHARE_REVOKED', 'share', shareId, `Access revoked for ${g.buyerName}`);
  return { ok: true };
}

async function resolveShare(deps: Deps, token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound('Shared report');
  const ref = await deps.store.get<{ organizationId: string; shareId: string }>(`shareTokens/${sha256(token)}`);
  if (!ref) throw notFound('Shared report');
  const grant = await deps.store.get<ShareGrant>(orgPath(ref.organizationId, 'shares', ref.shareId));
  if (!grant) throw notFound('Shared report');
  if (grant.revokedAt) throw new AppError(410, 'REVOKED', 'Access to this report has been revoked');
  if (new Date(grant.expiresAt) < deps.clock.now()) throw new AppError(410, 'EXPIRED', 'This share link has expired');
  const report = await deps.store.get<Report>(orgPath(ref.organizationId, 'reports', grant.reportId));
  if (!report || report.status !== 'APPROVED') throw forbidden('This report is no longer available');
  return { grant, report, orgId: ref.organizationId };
}

async function logAccess(deps: Deps, orgId: string, grant: ShareGrant, action: 'VIEW' | 'DOWNLOAD' | 'CLARIFICATION') {
  const fresh = await deps.store.get<ShareGrant>(orgPath(orgId, 'shares', grant.id));
  await deps.store.update(orgPath(orgId, 'shares', grant.id), { accessLog: [...(fresh?.accessLog ?? []), { at: nowIso(deps), action }].slice(-500) });
}

/** Public buyer view: only the explicitly shared, approved report. */
export async function viewSharedReport(deps: Deps, token: string) {
  const { grant, report, orgId } = await resolveShare(deps, token);
  const org = await getOrganization(deps, orgId);
  const facility = await deps.store.get<Facility>(orgPath(orgId, 'facilities', report.facilityId));
  const calc = await deps.store.get<import('../domain/types').CalculationRun>(orgPath(orgId, 'calculations', report.calculationId));
  await logAccess(deps, orgId, grant, 'VIEW');
  return {
    buyerName: grant.buyerName,
    expiresAt: grant.expiresAt,
    supplier: { name: org.name, country: org.country },
    facility: facility ? { name: facility.name, country: facility.country, products: facility.productCategories } : null,
    report: { periodKey: report.periodKey, version: report.version, status: report.status, reviewedAt: report.reviewedAt, reviewerComment: report.reviewerComment },
    readiness: { status: report.readiness.status, checks: report.readiness.checks },
    calculation: calc
      ? { totalTCo2e: calc.result.totalTCo2e, intensityTCo2ePerT: calc.result.intensityTCo2ePerT, electricityKWh: calc.result.electricityKWh, dieselKg: calc.result.dieselKg, productionT: calc.result.productionT, boundary: calc.boundary, coverage: calc.coverage, factorSet: `${calc.factorSetId} v${calc.factorSetVersion}`, formulaVersion: calc.formulaVersion }
      : null,
    clarifications: grant.clarifications,
  };
}

export async function downloadSharedReport(deps: Deps, token: string, format: 'pdf' | 'csv' | 'xlsx') {
  const { grant, report, orgId } = await resolveShare(deps, token);
  await logAccess(deps, orgId, grant, 'DOWNLOAD');
  return readReportFile(deps, report, format);
}

export async function requestClarification(deps: Deps, token: string, name: string, message: string) {
  const { grant, orgId, report } = await resolveShare(deps, token);
  if (!message.trim()) throw badRequest('Message is required');
  const fresh = (await deps.store.get<ShareGrant>(orgPath(orgId, 'shares', grant.id)))!;
  const entry = { at: nowIso(deps), message: message.slice(0, 2000), name: name.slice(0, 120) };
  await deps.store.update(orgPath(orgId, 'shares', grant.id), { clarifications: [...fresh.clarifications, entry].slice(-100) });
  await logAccess(deps, orgId, grant, 'CLARIFICATION');
  const owners = (await deps.store.list<Member>(orgPath(orgId, 'members'), [['role', '==', 'OWNER']])).filter((m) => m.status === 'ACTIVE');
  for (const o of owners) await notify(deps, orgId, o.uid, `${grant.buyerName}: ${entry.message.slice(0, 300)}`, `Buyer clarification on ${report.periodKey}`, `/reports`);
  await audit(deps, orgId, `buyer:${grant.id}`, 'BUYER_CLARIFICATION', 'share', grant.id, `Clarification requested by ${grant.buyerName}`);
  return { ok: true };
}
