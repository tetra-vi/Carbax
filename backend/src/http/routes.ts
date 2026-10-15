import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type multer from 'multer';
import { z } from 'zod';
import { AppError, type Deps, type RequestContext } from '../application/core';
import * as orgs from '../application/organizations';
import * as docs from '../application/documents';
import * as ops from '../application/carbonops';
import * as calcs from '../application/calculations';
import * as intel from '../application/intelligence';
import * as reports from '../application/reports';
import * as platform from '../application/platform';
import * as notes from '../application/notifications';
import { DOCUMENT_TYPES, LANGUAGES, MEASUREMENT_TYPES, ROLES } from '../domain/types';

type H = (req: Request, res: Response) => Promise<unknown>;
const a =
  (fn: H): RequestHandler =>
  (req, res, next) =>
    fn(req, res).then((r) => {
      if (!res.headersSent) res.json(r ?? { ok: true });
    }, next);
const ctx = (req: Request): RequestContext => {
  if (!req.ctx) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
  return req.ctx;
};
const id = z.string().min(1).max(160).regex(/^[\w-]+$/);
const lang = z.enum(LANGUAGES);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const sendFile = (res: Response, f: { data: Buffer; contentType: string; fileName: string }, inline = false) => {
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${f.fileName.replace(/[^\w.\-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(f.data);
};

export function registerRoutes(
  app: Express,
  deps: Deps,
  mw: { authenticate: RequestHandler; upload: multer.Multer },
) {
  const v1 = '/api/v1';
  const auth = mw.authenticate;

  // ---------- Public ----------
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get(`${v1}/health`, (_req, res) => res.json({ status: 'ok', service: 'complybridge-api', version: '3.0.0' }));
  app.get(`${v1}/invites/:token`, a(async (req) => orgs.getInvite(deps, z.string().max(100).parse(req.params.token))));
  app.get(`${v1}/shared/:token`, a(async (req) => reports.viewSharedReport(deps, req.params.token)));
  app.get(`${v1}/shared/:token/download`, async (req, res, next) => {
    try {
      const format = z.enum(['pdf', 'csv', 'xlsx']).parse(req.query.format ?? 'pdf');
      sendFile(res, await reports.downloadSharedReport(deps, req.params.token, format));
    } catch (e) {
      next(e);
    }
  });
  app.post(`${v1}/shared/:token/clarifications`, a(async (req) => {
    const b = z.object({ name: z.string().min(1).max(120), message: z.string().min(1).max(2000) }).parse(req.body);
    return reports.requestClarification(deps, req.params.token, b.name, b.message);
  }));

  // ---------- Internal (Cloud Tasks / Cloud Scheduler, OIDC-verified) ----------
  const internal: RequestHandler = async (req, _res, next) => {
    try {
      if (!(await deps.internalAuth.verify(req.header('authorization')))) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid internal caller');
      next();
    } catch (e) {
      next(e);
    }
  };
  app.post('/internal/tasks/process-document', internal, a(async (req) => {
    const b = z.object({ jobId: z.string().min(1).max(200), organizationId: id }).parse(req.body);
    return { result: await docs.processDocumentJob(deps, b) };
  }));
  app.post('/internal/scheduler/monthly-close', internal, a(async () => platform.runMonthlyClose(deps)));

  // ---------- Authenticated ----------
  app.use(v1, (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/shared/') || req.path.startsWith('/invites/') && req.method === 'GET' || req.path === '/health') return next();
    return auth(req, res, next);
  });

  // Me & organization
  app.get(`${v1}/me`, a(async (req) => orgs.getMe(deps, ctx(req))));
  app.patch(`${v1}/me/preferences`, a(async (req) => {
    const b = z.object({ language: lang.optional(), guidedMode: z.boolean().optional(), displayName: z.string().min(1).max(120).optional() }).parse(req.body);
    return orgs.updatePreferences(deps, ctx(req), b);
  }));
  app.post(`${v1}/organizations`, a(async (req) => {
    const b = z.object({
      name: z.string().min(2).max(200), country: z.string().min(2).max(80), industry: z.string().min(2).max(120),
      contactEmail: z.string().email(), registrationNumber: z.string().max(80).optional(), address: z.string().max(300).optional(),
      phone: z.string().max(40).optional(), preferredLanguage: lang, displayName: z.string().min(1).max(120),
    }).parse(req.body);
    return orgs.createOrganization(deps, ctx(req), b);
  }));
  app.get(`${v1}/organizations/current`, a(async (req) => (await orgs.getMe(deps, ctx(req))).organization));
  app.patch(`${v1}/organizations/current`, a(async (req) => {
    const b = z.object({
      name: z.string().min(2).max(200).optional(), country: z.string().max(80).optional(), industry: z.string().max(120).optional(),
      contactEmail: z.string().email().optional(), registrationNumber: z.string().max(80).optional(), address: z.string().max(300).optional(),
      phone: z.string().max(40).optional(), preferredLanguage: lang.optional(),
    }).parse(req.body);
    return orgs.updateOrganization(deps, ctx(req), b);
  }));

  // Members & invitations
  app.get(`${v1}/members`, a(async (req) => orgs.listMembers(deps, ctx(req))));
  app.post(`${v1}/members/invites`, a(async (req) => {
    const b = z.object({ email: z.string().email(), role: z.enum(ROLES), facilityIds: z.array(z.string().max(100)).min(1) }).parse(req.body);
    return orgs.createInvite(deps, ctx(req), b);
  }));
  app.post(`${v1}/invites/:token/accept`, a(async (req) => {
    const b = z.object({ displayName: z.string().min(1).max(120), language: lang }).parse(req.body);
    return orgs.acceptInvite(deps, ctx(req), z.string().max(100).parse(req.params.token), b.displayName, b.language);
  }));
  app.patch(`${v1}/members/:uid`, a(async (req) => {
    const b = z.object({ role: z.enum(ROLES).optional(), facilityIds: z.array(z.string().max(100)).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }).parse(req.body);
    return orgs.updateMember(deps, ctx(req), z.string().max(128).parse(req.params.uid), b);
  }));

  // Facilities
  const facilityBody = z.object({
    name: z.string().min(2).max(200), location: z.string().min(1).max(200), country: z.string().min(2).max(80),
    timeZone: z.string().min(2).max(60), industry: z.string().min(2).max(120),
    processes: z.array(z.string().max(120)).max(20), productCategories: z.array(z.string().max(120)).max(20),
    methodologies: z.array(z.string().max(120)).max(10), baselinePeriod: month.optional(),
  });
  app.post(`${v1}/facilities`, a(async (req) => orgs.createFacility(deps, ctx(req), facilityBody.parse(req.body))));
  app.get(`${v1}/facilities`, a(async (req) => orgs.listFacilities(deps, ctx(req))));
  app.get(`${v1}/facilities/:facilityId`, a(async (req) => orgs.getFacility(deps, ctx(req), id.parse(req.params.facilityId))));
  app.patch(`${v1}/facilities/:facilityId`, a(async (req) => {
    const b = facilityBody.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).parse(req.body);
    return orgs.updateFacility(deps, ctx(req), id.parse(req.params.facilityId), b);
  }));

  // Reporting periods
  app.post(`${v1}/reporting-periods`, a(async (req) => {
    const b = z.object({ facilityId: id, year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12), requiredCategories: z.array(z.enum(MEASUREMENT_TYPES)).optional() }).parse(req.body);
    return orgs.createPeriod(deps, ctx(req), b);
  }));
  app.get(`${v1}/reporting-periods`, a(async (req) => orgs.listPeriods(deps, ctx(req), req.query.facilityId ? id.parse(req.query.facilityId) : undefined)));
  app.get(`${v1}/reporting-periods/:periodId`, a(async (req) => orgs.getPeriod(deps, ctx(req), id.parse(req.params.periodId))));
  app.post(`${v1}/reporting-periods/:periodId/analyze`, a(async (req) => ops.analyzePeriod(deps, ctx(req), id.parse(req.params.periodId))));
  app.post(`${v1}/reporting-periods/:periodId/close`, a(async (req) => orgs.closePeriod(deps, ctx(req), id.parse(req.params.periodId))));
  app.post(`${v1}/reporting-periods/:periodId/reopen`, a(async (req) => orgs.reopenPeriod(deps, ctx(req), id.parse(req.params.periodId), z.object({ reason: z.string().max(500) }).parse(req.body).reason)));
  app.get(`${v1}/reporting-periods/:periodId/documents`, a(async (req) => docs.listDocuments(deps, ctx(req), id.parse(req.params.periodId))));
  app.get(`${v1}/reporting-periods/:periodId/measurements`, a(async (req) => docs.listMeasurements(deps, ctx(req), id.parse(req.params.periodId))));
  app.get(`${v1}/reporting-periods/:periodId/readiness`, a(async (req) => reports.assessPeriodReadiness(deps, ctx(req), id.parse(req.params.periodId), req.query.summary !== 'false')));
  app.get(`${v1}/reporting-periods/:periodId/agent-runs`, a(async (req) => ops.listAgentRuns(deps, ctx(req), id.parse(req.params.periodId))));
  app.get(`${v1}/reporting-periods/:periodId/scenarios`, a(async (req) => intel.listScenarios(deps, ctx(req), id.parse(req.params.periodId))));

  // Documents
  app.post(`${v1}/documents`, mw.upload.single('file'), a(async (req) => {
    const b = z.object({ periodId: id, declaredType: z.enum(DOCUMENT_TYPES).optional(), relatedTaskId: id.optional() }).parse(req.body);
    if (!req.file) throw new AppError(400, 'BAD_REQUEST', 'Attach a file in the "file" field');
    return docs.uploadDocument(deps, ctx(req), { ...b, fileName: req.file.originalname, declaredMime: req.file.mimetype, data: req.file.buffer });
  }));
  app.get(`${v1}/documents/:documentId`, a(async (req) => docs.getDocument(deps, ctx(req), id.parse(req.params.documentId))));
  app.get(`${v1}/documents/:documentId/file`, async (req, res, next) => {
    try {
      sendFile(res, await docs.getDocumentFile(deps, ctx(req), id.parse(req.params.documentId)), true);
    } catch (e) {
      next(e);
    }
  });
  app.post(`${v1}/documents/:documentId/process`, a(async (req) => docs.retryDocument(deps, ctx(req), id.parse(req.params.documentId))));
  app.get(`${v1}/extractions/:extractionId`, a(async (req) => docs.getExtraction(deps, ctx(req), id.parse(req.params.extractionId))));
  app.post(`${v1}/extractions/:extractionId/confirm`, a(async (req) => {
    const b = z.object({
      items: z.array(z.object({
        index: z.number().int().min(0).max(100), include: z.boolean(), measurementType: z.enum(MEASUREMENT_TYPES),
        reportingMonth: month, quantity: z.number().finite(), unit: z.string().min(1).max(20), fuelType: z.string().max(40).nullable().optional(),
      })).min(1).max(50),
    }).parse(req.body);
    return docs.confirmExtraction(deps, ctx(req), id.parse(req.params.extractionId), b.items);
  }));
  app.post(`${v1}/extractions/:extractionId/reject`, a(async (req) => docs.rejectExtraction(deps, ctx(req), id.parse(req.params.extractionId), z.object({ reason: z.string().min(1).max(500) }).parse(req.body).reason)));

  // CarbonOps
  app.get(`${v1}/issues`, a(async (req) => ops.listIssues(deps, ctx(req), req.query.periodId ? id.parse(req.query.periodId) : undefined, req.query.status ? z.enum(['OPEN', 'RESOLVED']).parse(req.query.status) : undefined)));
  app.post(`${v1}/issues/:issueId/recheck`, a(async (req) => ops.recheckIssue(deps, ctx(req), id.parse(req.params.issueId))));
  app.post(`${v1}/carbonops/run`, a(async (req) => ops.runCarbonOpsAgent(deps, ctx(req), z.object({ periodId: id }).parse(req.body).periodId)));
  app.get(`${v1}/tasks`, a(async (req) => ops.listTasks(deps, ctx(req), { periodId: req.query.periodId ? id.parse(req.query.periodId) : undefined, mine: req.query.mine === 'true' })));
  app.get(`${v1}/tasks/:taskId`, a(async (req) => ops.getTask(deps, ctx(req), id.parse(req.params.taskId))));
  app.post(`${v1}/tasks/:taskId/approve`, a(async (req) => {
    const b = z.object({ messageEnglish: z.string().min(10).max(600).optional(), assigneeUid: z.string().max(128).optional() }).parse(req.body ?? {});
    return ops.approveTask(deps, ctx(req), id.parse(req.params.taskId), b);
  }));
  app.post(`${v1}/tasks/:taskId/decline`, a(async (req) => ops.declineTask(deps, ctx(req), id.parse(req.params.taskId), z.object({ reason: z.string().min(1).max(300) }).parse(req.body).reason)));
  app.post(`${v1}/tasks/:taskId/respond`, a(async (req) => {
    const b = z.object({ note: z.string().max(1000).optional(), start: z.boolean().optional() }).parse(req.body ?? {});
    return ops.respondToTask(deps, ctx(req), id.parse(req.params.taskId), b);
  }));

  // Calculations
  app.post(`${v1}/calculations/run`, a(async (req) => calcs.runCalculation(deps, ctx(req), z.object({ periodId: id }).parse(req.body).periodId)));
  app.get(`${v1}/calculations/:calculationId`, a(async (req) => calcs.getCalculation(deps, ctx(req), id.parse(req.params.calculationId))));

  // Carbon Intelligence
  app.get(`${v1}/intelligence/dashboard`, a(async (req) => intel.getDashboard(deps, ctx(req), id.parse(req.query.facilityId), req.query.periodId ? id.parse(req.query.periodId) : undefined)));
  app.post(`${v1}/intelligence/explain`, a(async (req) => intel.explainDashboard(deps, ctx(req), z.object({ facilityId: id }).parse(req.body).facilityId)));

  // CarbonTwin
  app.post(`${v1}/scenarios`, a(async (req) => {
    const b = z.object({
      periodId: id,
      explain: z.boolean().optional(),
      inputs: z.object({
        electricityChangePct: z.number().min(-100).max(200), dieselChangePct: z.number().min(-100).max(200), productionChangePct: z.number().min(-100).max(200),
        dieselPricePerL: z.number().min(0).max(1e6).nullable().optional(), electricityPricePerKWh: z.number().min(0).max(1e6).nullable().optional(), currency: z.string().max(8).nullable().optional(),
      }),
    }).parse(req.body);
    return intel.createScenario(deps, ctx(req), b);
  }));
  app.get(`${v1}/scenarios/:scenarioId`, a(async (req) => intel.getScenario(deps, ctx(req), id.parse(req.params.scenarioId))));
  app.post(`${v1}/improvement-actions`, a(async (req) => {
    const b = z.object({
      title: z.string().min(3).max(200), description: z.string().max(2000), metric: z.enum(['DIESEL_L', 'ELECTRICITY_KWH', 'INTENSITY']),
      baselinePeriodId: id, targetChangePct: z.number().min(-100).max(100), scenarioId: id.optional(), issueId: id.optional(),
      assigneeUid: z.string().max(128).optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.body);
    return intel.createAction(deps, ctx(req), b);
  }));
  app.get(`${v1}/improvement-actions`, a(async (req) => intel.listActions(deps, ctx(req), id.parse(req.query.facilityId))));
  app.patch(`${v1}/improvement-actions/:actionId`, a(async (req) => {
    const b = z.object({ status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(), assigneeUid: z.string().max(128).nullable().optional(), completionEvidence: z.string().max(2000).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
    return intel.updateAction(deps, ctx(req), id.parse(req.params.actionId), b as Parameters<typeof intel.updateAction>[3]);
  }));
  app.post(`${v1}/improvement-actions/:actionId/evaluate`, a(async (req) => intel.evaluateAction(deps, ctx(req), id.parse(req.params.actionId))));

  // Reports & sharing
  app.post(`${v1}/reports/generate`, a(async (req) => reports.generateReport(deps, ctx(req), z.object({ periodId: id }).parse(req.body).periodId)));
  app.get(`${v1}/reports`, a(async (req) => reports.listReports(deps, ctx(req), req.query.periodId ? id.parse(req.query.periodId) : undefined)));
  app.get(`${v1}/reports/:reportId`, a(async (req) => reports.getReport(deps, ctx(req), id.parse(req.params.reportId))));
  app.post(`${v1}/reports/:reportId/approve`, a(async (req) => reports.reviewReport(deps, ctx(req), id.parse(req.params.reportId), 'APPROVE', z.object({ comment: z.string().min(1).max(2000) }).parse(req.body).comment)));
  app.post(`${v1}/reports/:reportId/reject`, a(async (req) => reports.reviewReport(deps, ctx(req), id.parse(req.params.reportId), 'REJECT', z.object({ comment: z.string().min(1).max(2000) }).parse(req.body).comment)));
  app.get(`${v1}/reports/:reportId/download`, async (req, res, next) => {
    try {
      const format = z.enum(['pdf', 'csv', 'xlsx']).parse(req.query.format ?? 'pdf');
      sendFile(res, await reports.downloadReport(deps, ctx(req), id.parse(req.params.reportId), format));
    } catch (e) {
      next(e);
    }
  });
  app.post(`${v1}/reports/:reportId/share`, a(async (req) => {
    const b = z.object({ buyerName: z.string().min(1).max(200), buyerEmail: z.string().email(), expiresInDays: z.number().int().min(1).max(365) }).parse(req.body);
    return reports.createShare(deps, ctx(req), id.parse(req.params.reportId), b);
  }));
  app.get(`${v1}/reports/:reportId/shares`, a(async (req) => reports.listShares(deps, ctx(req), id.parse(req.params.reportId))));
  app.post(`${v1}/shares/:shareId/revoke`, a(async (req) => reports.revokeShare(deps, ctx(req), id.parse(req.params.shareId))));

  // VoiceMate
  app.post(`${v1}/assistant/chat`, a(async (req) => {
    const b = z.object({ message: z.string().min(1).max(1000), language: lang.optional() }).parse(req.body);
    return platform.assistantChat(deps, ctx(req), b.message, b.language);
  }));
  app.post(`${v1}/assistant/transcribe`, a(async (req) => {
    const b = z.object({ audioBase64: z.string().min(10).max(1_500_000), mimeType: z.string().max(60), language: lang }).parse(req.body);
    return platform.assistantTranscribe(deps, ctx(req), b);
  }));
  app.post(`${v1}/assistant/speak`, a(async (req) => platform.assistantSpeak(deps, ctx(req), z.object({ text: z.string().min(1).max(1500), language: lang }).parse(req.body))));
  app.post(`${v1}/assistant/translate`, a(async (req) => platform.translateText(deps, ctx(req), z.object({ text: z.string().min(1).max(3000), target: lang }).parse(req.body))));
  app.get(`${v1}/assistant/speech-support`, a(async () => platform.speechSupport(deps)));

  // Notifications, audit, SaaS
  app.get(`${v1}/notifications`, a(async (req) => notes.listNotifications(deps, ctx(req))));
  app.post(`${v1}/notifications/:id/read`, a(async (req) => notes.markNotificationRead(deps, ctx(req), id.parse(req.params.id))));
  app.get(`${v1}/audit`, a(async (req) => platform.listAudit(deps, ctx(req), req.query.entityId ? id.parse(req.query.entityId) : undefined)));
  app.get(`${v1}/subscription`, a(async (req) => platform.getSubscription(deps, ctx(req))));
  app.get(`${v1}/usage`, a(async (req) => platform.getUsage(deps, ctx(req))));

  // Platform admin
  app.get(`${v1}/admin/organizations`, a(async (req) => platform.adminListOrganizations(deps, ctx(req))));
  app.patch(`${v1}/admin/organizations/:orgId`, a(async (req) => {
    const b = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), plan: z.enum(['TRIAL', 'STARTER', 'GROWTH', 'BUSINESS', 'BUYER_NETWORK']).optional() }).parse(req.body);
    return platform.adminUpdateOrganization(deps, ctx(req), id.parse(req.params.orgId), b);
  }));
  app.get(`${v1}/admin/jobs`, a(async (req) => platform.adminJobs(deps, ctx(req), req.query.status ? z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']).parse(req.query.status) : 'FAILED')));
  app.get(`${v1}/admin/health`, a(async (req) => platform.adminHealth(deps, ctx(req))));
}
