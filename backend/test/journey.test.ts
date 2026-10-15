import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { bill, buildTestDeps, client, fakePdf, type Harness } from './helpers';

// End-to-end: the Lanka Aluminium Works journey through the real HTTP API and business logic.
describe('ComplyBridge journey: Lanka Aluminium Works', () => {
  let h: Harness;
  const owner = () => client(h, 'owner1', 'owner@lanka-alu.test');
  const worker = () => client(h, 'worker1', 'priya@lanka-alu.test');
  const reviewer = () => client(h, 'rev1', 'anita@lanka-alu.test');
  let facilityId = '';
  const periods: Record<string, string> = {};
  let marchTaskId = '';
  let reportId = '';
  let shareLink = '';

  beforeAll(async () => {
    h = buildTestDeps('2026-05-03T09:00:00Z');
    await h.install();
  });

  async function uploadAndConfirm(as: ReturnType<typeof owner>, periodKey: string, doc: ReturnType<typeof bill>, extraFields: Record<string, string> = {}) {
    const up = await as.upload('/api/v1/documents', { periodId: periods[periodKey], ...extraFields }, fakePdf(doc), `${doc.documentType}-${periodKey}.pdf`);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    await h.queue.drain();
    const d = await as.get(`/api/v1/documents/${up.body.id}`);
    expect(d.body.status).toBe('NEEDS_REVIEW');
    const ext = await as.get(`/api/v1/extractions/${d.body.extractionId}`);
    const items = ext.body.items.map((it: { measurementType: string; reportingMonth: string; quantity: number; unit: string; fuelType: string | null }, index: number) => ({ index, include: true, measurementType: it.measurementType, reportingMonth: it.reportingMonth, quantity: it.quantity, unit: it.unit, fuelType: it.fuelType }));
    const c = await as.post(`/api/v1/extractions/${d.body.extractionId}/confirm`, { items });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    return { documentId: up.body.id as string, confirm: c.body };
  }

  it('1. registers the company and onboards the owner', async () => {
    const me0 = await owner().get('/api/v1/me');
    expect(me0.body.organization).toBeNull();
    const r = await owner().post('/api/v1/organizations', { name: 'Lanka Aluminium Works', country: 'Sri Lanka', industry: 'Aluminium manufacturing', contactEmail: 'owner@lanka-alu.test', preferredLanguage: 'en', displayName: 'Ravi' });
    expect(r.status).toBe(200);
    expect(r.body.plan).toBe('TRIAL');
    const me = await owner().get('/api/v1/me');
    expect(me.body.member.role).toBe('OWNER');
  });

  it('2. creates the facility and Jan-Apr 2026 reporting periods', async () => {
    const f = await owner().post('/api/v1/facilities', { name: 'Biyagama Extrusion Plant', location: 'Biyagama', country: 'Sri Lanka', timeZone: 'Asia/Colombo', industry: 'Aluminium', processes: ['Extrusion', 'Anodising'], productCategories: ['Aluminium profiles'], methodologies: ['energy-scope-v1'] });
    expect(f.status).toBe(200);
    facilityId = f.body.id;
    for (const month of [1, 2, 3, 4]) {
      const p = await owner().post('/api/v1/reporting-periods', { facilityId, year: 2026, month });
      expect(p.status).toBe(200);
      periods[p.body.key] = p.body.id;
    }
    const dupe = await owner().post('/api/v1/reporting-periods', { facilityId, year: 2026, month: 1 });
    expect(dupe.status).toBe(409);
  });

  it('3. invites a Tamil-speaking worker and a reviewer', async () => {
    for (const [email, role, uid, lang] of [['priya@lanka-alu.test', 'WORKER', 'worker1', 'ta'], ['anita@lanka-alu.test', 'REVIEWER', 'rev1', 'en']] as const) {
      const inv = await owner().post('/api/v1/members/invites', { email, role, facilityIds: [facilityId] });
      expect(inv.status).toBe(200);
      const token = inv.body.inviteLink.split('/invite/')[1];
      const pub = await request(h.app).get(`/api/v1/invites/${token}`);
      expect(pub.body.organizationName).toBe('Lanka Aluminium Works');
      const acc = await client(h, uid, email).post(`/api/v1/invites/${token}/accept`, { displayName: role === 'WORKER' ? 'Priya' : 'Anita', language: lang });
      expect(acc.status).toBe(200);
      expect(acc.body.role).toBe(role);
    }
    const reuse = await owner().post('/api/v1/members/invites', { email: 'x@y.test', role: 'WORKER', facilityIds: ['fac_unknown'] });
    expect(reuse.status).toBe(400);
  });

  it('4. worker uploads Jan, Feb and Apr evidence; Google AI extraction is confirmed by a person', async () => {
    const data: Record<string, [number, number, number]> = { '2026-01': [10000, 1000, 50], '2026-02': [10400, 1000, 52], '2026-04': [11000, 1100, 54] };
    for (const [key, [kwh, litres, tonnes]] of Object.entries(data)) {
      await uploadAndConfirm(worker(), key, bill('ELECTRICITY', key, kwh, 'kWh'));
      await uploadAndConfirm(worker(), key, bill('FUEL', key, litres, 'L'));
      const last = await uploadAndConfirm(worker(), key, bill('PRODUCTION', key, tonnes, 't'));
      expect(last.confirm.analysis.calculationId).toBeTruthy();
    }
    const p = await owner().get(`/api/v1/reporting-periods/${periods['2026-01']}`);
    expect(p.body.status).toBe('READY_FOR_REVIEW');
  });

  it('5. rejects duplicates and unsupported files, and keeps corrections in history', async () => {
    const doc = fakePdf(bill('FUEL', '2026-03', 900, 'L'), 'fixed-salt');
    const first = await worker().upload('/api/v1/documents', { periodId: periods['2026-03'] }, doc, 'diesel-march.pdf');
    expect(first.status).toBe(200);
    const again = await worker().upload('/api/v1/documents', { periodId: periods['2026-03'] }, doc, 'diesel-march-copy.pdf');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DUPLICATE_DOCUMENT');
    const exe = await worker().upload('/api/v1/documents', { periodId: periods['2026-03'] }, Buffer.from('MZ\x90\x00binary'), 'invoice.pdf');
    expect(exe.status).toBe(415);
    await h.queue.drain();
    const d = await worker().get(`/api/v1/documents/${first.body.id}`);
    const ext = await worker().get(`/api/v1/extractions/${d.body.extractionId}`);
    // AI read 900 L; the worker corrects it to 950 L.
    const c = await worker().post(`/api/v1/extractions/${ext.body.id}/confirm`, { items: [{ index: 0, include: true, measurementType: 'FUEL', reportingMonth: '2026-03', quantity: 950, unit: 'L', fuelType: 'diesel' }] });
    expect(c.status).toBe(200);
    expect(c.body.measurements[0]).toMatchObject({ aiValue: 900, quantity: 950, corrected: true });
    await uploadAndConfirm(worker(), '2026-03', bill('PRODUCTION', '2026-03', 50, 't'));
  });

  it('6. CarbonOps detects the missing March electricity bill', async () => {
    const r = await owner().post(`/api/v1/reporting-periods/${periods['2026-03']}/analyze`);
    expect(r.status).toBe(200);
    const missing = r.body.issues.find((i: { type: string; category: string }) => i.type === 'MISSING_CATEGORY' && i.category === 'ELECTRICITY');
    expect(missing).toBeTruthy();
    expect(missing.title).toBe('No confirmed electricity bill for March 2026.');
    const p = await owner().get(`/api/v1/reporting-periods/${periods['2026-03']}`);
    expect(p.body.status).toBe('NEEDS_CORRECTION');
  });

  it('7. the Gemini agent drafts a request through controlled tools; owner approval is required', async () => {
    const run = await owner().post('/api/v1/carbonops/run', { periodId: periods['2026-03'] });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.run.status).toBe('SUCCEEDED');
    const tools = run.body.run.toolActions.map((a: { tool: string }) => a.tool);
    expect(tools).toEqual(expect.arrayContaining(['listOpenIssues', 'draftClarification', 'assignTask', 'requestHumanApproval']));
    const task = run.body.tasks[0];
    expect(task.approvalState).toBe('PENDING_APPROVAL');
    expect(task.localizedLanguage).toBe('ta');
    expect(task.messageLocalized).toMatch(/^\[ta\] /);
    marchTaskId = task.id;
    // Not visible to the worker until approved.
    const before = await worker().get('/api/v1/tasks');
    expect(before.body.find((t: { id: string }) => t.id === marchTaskId)).toBeUndefined();
    // Worker cannot approve.
    expect((await worker().post(`/api/v1/tasks/${marchTaskId}/approve`)).status).toBe(403);
    const ok = await owner().post(`/api/v1/tasks/${marchTaskId}/approve`);
    expect(ok.body.status).toBe('ASSIGNED');
    const after = await worker().get('/api/v1/tasks');
    expect(after.body.find((t: { id: string }) => t.id === marchTaskId).status).toBe('ASSIGNED');
    const notes = await worker().get('/api/v1/notifications');
    expect(notes.body.length).toBeGreaterThan(0);
  });

  it('8. agent tools reject unknown tools and out-of-scope ids', async () => {
    h.llm.agentPlan = 'malicious';
    const run = await owner().post('/api/v1/carbonops/run', { periodId: periods['2026-03'] });
    h.llm.agentPlan = 'normal';
    expect(run.status).toBe(200);
    const actions = run.body.run.toolActions as { tool: string; ok: boolean }[];
    expect(actions.map((a) => a.tool)).toEqual(['deleteAllData', 'assignTask']);
    expect(actions.every((a) => a.ok === false)).toBe(true);
  });

  it('9. worker uploads the missing bill against the task; re-analysis resolves it automatically', async () => {
    const up = await worker().upload('/api/v1/documents', { periodId: periods['2026-03'], relatedTaskId: marchTaskId }, fakePdf(bill('ELECTRICITY', '2026-03', 10200, 'kWh')), 'march-electricity-photo.pdf');
    expect(up.status).toBe(200);
    expect((await worker().get(`/api/v1/tasks/${marchTaskId}`)).body.status).toBe('SUBMITTED');
    await h.queue.drain();
    const d = await worker().get(`/api/v1/documents/${up.body.id}`);
    const ext = await worker().get(`/api/v1/extractions/${d.body.extractionId}`);
    const c = await worker().post(`/api/v1/extractions/${ext.body.id}/confirm`, { items: [{ index: 0, include: true, measurementType: 'ELECTRICITY', reportingMonth: '2026-03', quantity: ext.body.items[0].quantity, unit: 'kWh' }] });
    expect(c.status).toBe(200);
    const t = await worker().get(`/api/v1/tasks/${marchTaskId}`);
    expect(t.body.status).toBe('RESOLVED');
    expect(t.body.history.map((x: { to: string }) => x.to)).toEqual(['OPEN', 'ASSIGNED', 'SUBMITTED', 'REVALIDATING', 'RESOLVED']);
    const issues = await owner().get(`/api/v1/issues?periodId=${periods['2026-03']}&status=OPEN`);
    expect(issues.body.filter((i: { severity: string }) => i.severity !== 'LOW')).toHaveLength(0);
  });

  it('10. deterministic calculation matches the hand-calculated fixture', async () => {
    const r = await owner().post('/api/v1/calculations/run', { periodId: periods['2026-03'] });
    expect(r.status).toBe(200);
    // 10,200 kWh x 0.5 = 5.1 t; 950 L x 0.84 = 798 kg x 3.1863 = 2,542.6674 kg = 2.5427 t; total 7.6427 t / 50 t = 0.1529
    expect(r.body.result).toMatchObject({ electricityKWh: 10200, dieselKg: 798, productionT: 50, electricityTCo2e: 5.1, fuelTCo2e: 2.5427, totalTCo2e: 7.6427, intensityTCo2ePerT: 0.1529 });
    expect(r.body.status).toBe('COMPLETE');
    expect(r.body.boundary).toContain('not a complete CBAM');
    expect(r.body.result.lines.every((l: { measurementIds: string[]; sourceDocumentIds: string[] }) => l.measurementIds.length === 0 || l.sourceDocumentIds.length > 0)).toBe(true);
  });

  it('11. dashboard shows persisted monthly series', async () => {
    const r = await owner().get(`/api/v1/intelligence/dashboard?facilityId=${facilityId}`);
    expect(r.status).toBe(200);
    expect(r.body.series.map((s: { key: string }) => s.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(r.body.kpis.evidenceCompletenessPct).toBe(100);
    const workerView = await worker().get(`/api/v1/intelligence/dashboard?facilityId=${facilityId}`);
    expect(workerView.status).toBe(403);
  });

  it('12. CarbonTwin: diesel -10% is hypothetical and leaves real data unchanged', async () => {
    const s = await owner().post('/api/v1/scenarios', { periodId: periods['2026-03'], inputs: { electricityChangePct: 0, dieselChangePct: -10, productionChangePct: 0, dieselPricePerL: 350, currency: 'LKR' } });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('HYPOTHETICAL');
    expect(s.body.projected.fuelTCo2e).toBe(2.2884); // 718.2 kg x 3.1863
    expect(s.body.delta.costChange).toBe(-33250); // -95 L x 350
    expect(s.body.explanationIsAiGenerated).toBe(true);
    const ms = await owner().get(`/api/v1/reporting-periods/${periods['2026-03']}/measurements`);
    expect(ms.body.find((x: { type: string }) => x.type === 'FUEL').quantity).toBe(950);
    const act = await owner().post('/api/v1/improvement-actions', { title: 'Investigate generator diesel use', description: 'Check generator run hours during power cuts', metric: 'DIESEL_L', baselinePeriodId: periods['2026-03'], targetChangePct: -10, scenarioId: s.body.id, assigneeUid: 'worker1', startDate: '2026-04-01', dueDate: '2026-04-30' });
    expect(act.status).toBe(200);
    expect(act.body.baselineValue).toBe(950);
    expect(act.body.targetValue).toBe(855);
    const ev = await owner().post(`/api/v1/improvement-actions/${act.body.id}/evaluate`);
    expect(ev.body.followUps[0]).toMatchObject({ periodKey: '2026-04', actualValue: 1100 });
  });

  it('13. readiness, report generation, separation of duties and immutable approval', async () => {
    const rd = await reviewer().get(`/api/v1/reporting-periods/${periods['2026-03']}/readiness`);
    expect(rd.status).toBe(200);
    expect(rd.body.status).toBe('READY_FOR_HUMAN_REVIEW');
    const g = await owner().post('/api/v1/reports/generate', { periodId: periods['2026-03'] });
    expect(g.status).toBe(200);
    reportId = g.body.id;
    const pdf = await owner().get(`/api/v1/reports/${reportId}/download?format=pdf`);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await worker().post(`/api/v1/reports/${reportId}/approve`, { comment: 'ok' })).status).toBe(403);
    expect((await owner().post(`/api/v1/reports/${reportId}/approve`, { comment: 'ok' })).status).toBe(403);
    const ap = await reviewer().post(`/api/v1/reports/${reportId}/approve`, { comment: 'Evidence traced to bills; energy scope only.' });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect(ap.body.status).toBe('APPROVED');
    expect(ap.body.readiness.status).toBe('APPROVED_FOR_SHARING');
    const p = await owner().get(`/api/v1/reporting-periods/${periods['2026-03']}`);
    expect(p.body.status).toBe('APPROVED');
    const locked = await worker().upload('/api/v1/documents', { periodId: periods['2026-03'] }, fakePdf(bill('FUEL', '2026-03', 1, 'L')), 'late.pdf');
    expect(locked.status).toBe(409);
    const again = await reviewer().post(`/api/v1/reports/${reportId}/approve`, { comment: 'again' });
    expect(again.status).toBe(409);
    for (const f of ['csv', 'xlsx']) expect((await owner().get(`/api/v1/reports/${reportId}/download?format=${f}`)).status).toBe(200);
  });

  it('14. secure buyer sharing: view, download, clarify, revoke, expire', async () => {
    expect((await worker().post(`/api/v1/reports/${reportId}/share`, { buyerName: 'X', buyerEmail: 'x@x.test', expiresInDays: 5 })).status).toBe(403);
    const s = await owner().post(`/api/v1/reports/${reportId}/share`, { buyerName: 'Klaus GmbH', buyerEmail: 'klaus@buyer.test', expiresInDays: 14 });
    expect(s.status).toBe(200);
    shareLink = s.body.shareLink;
    expect(s.body.tokenHash).toBeUndefined();
    const token = shareLink.split('/shared/')[1];
    const view = await request(h.app).get(`/api/v1/shared/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.supplier.name).toBe('Lanka Aluminium Works');
    expect(view.body.calculation.totalTCo2e).toBe(7.6427);
    expect(JSON.stringify(view.body)).not.toContain('storagePath');
    const dl = await request(h.app).get(`/api/v1/shared/${token}/download?format=pdf`);
    expect(dl.status).toBe(200);
    expect(dl.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await request(h.app).post(`/api/v1/shared/${token}/clarifications`).send({ name: 'Klaus', message: 'Which grid factor year?' })).status).toBe(200);
    expect((await request(h.app).get('/api/v1/shared/not-a-real-token-but-long-enough')).status).toBe(404);
    // Expiry
    const s2 = await owner().post(`/api/v1/reports/${reportId}/share`, { buyerName: 'Short', buyerEmail: 's@buyer.test', expiresInDays: 1 });
    const t2 = s2.body.shareLink.split('/shared/')[1];
    h.setNow('2026-05-06T09:00:00Z');
    expect((await request(h.app).get(`/api/v1/shared/${t2}`)).status).toBe(410);
    h.setNow('2026-05-03T09:00:00Z');
    // Revocation
    await owner().post(`/api/v1/shares/${s.body.id}/revoke`);
    expect((await request(h.app).get(`/api/v1/shared/${token}`)).status).toBe(410);
    const shares = await owner().get(`/api/v1/reports/${reportId}/shares`);
    expect(shares.body.find((x: { id: string }) => x.id === s.body.id).accessLog.length).toBeGreaterThanOrEqual(3);
  });

  it('15. VoiceMate: chat in Tamil, transcript requires confirmation, speech output', async () => {
    const chat = await worker().post('/api/v1/assistant/chat', { message: 'What should I do?', language: 'ta' });
    expect(chat.status).toBe(200);
    expect(chat.body.aiGenerated).toBe(true);
    const tr = await worker().post('/api/v1/assistant/transcribe', { audioBase64: Buffer.from('audio-bytes').toString('base64'), mimeType: 'audio/webm', language: 'ta' });
    expect(tr.body.requiresConfirmation).toBe(true);
    const sp = await worker().post('/api/v1/assistant/speak', { text: 'Upload the bill', language: 'ta' });
    expect(sp.body.mimeType).toBe('audio/mpeg');
  });

  it('16. monthly scheduler opens May and assigns collection tasks (internal auth only)', async () => {
    expect((await request(h.app).post('/internal/scheduler/monthly-close')).status).toBe(401);
    const r = await request(h.app).post('/internal/scheduler/monthly-close').set('Authorization', 'Bearer internal-test-secret');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ periodKey: '2026-05', periodsOpened: 1, tasksCreated: 1 });
    const again = await request(h.app).post('/internal/scheduler/monthly-close').set('Authorization', 'Bearer internal-test-secret');
    expect(again.body.tasksCreated).toBe(0);
    const tasks = await worker().get('/api/v1/tasks');
    expect(tasks.body.some((t: { kind: string }) => t.kind === 'MONTHLY_COLLECTION')).toBe(true);
  });

  it('17. subscription, quotas, audit trail and platform admin', async () => {
    expect((await worker().get('/api/v1/subscription')).status).toBe(403);
    const sub = await owner().get('/api/v1/subscription');
    expect(sub.body.plan.id).toBe('TRIAL');
    expect(sub.body.usage.documentsProcessed).toBeGreaterThan(0);
    expect(sub.body.payments.status).toBe('NOT_CONNECTED');
    expect((await owner().get('/api/v1/admin/organizations')).status).toBe(403);
    const admin = client(h, 'adm', 'admin@platform.test');
    const orgs = await admin.get('/api/v1/admin/organizations');
    expect(orgs.status).toBe(200);
    const orgId = orgs.body[0].id;
    await admin.patch(`/api/v1/admin/organizations/${orgId}`, { plan: 'STARTER' });
    const twin = await owner().post('/api/v1/scenarios', { periodId: periods['2026-04'], inputs: { electricityChangePct: -5, dieselChangePct: 0, productionChangePct: 0 } });
    expect(twin.status).toBe(402);
    await admin.patch(`/api/v1/admin/organizations/${orgId}`, { plan: 'TRIAL' });
    const health = await admin.get('/api/v1/admin/health');
    expect(health.body.jobs.failed).toBe(0);
    const audit = await owner().get('/api/v1/audit');
    const actions = new Set(audit.body.map((e: { action: string }) => e.action));
    for (const a of ['ORGANIZATION_CREATED', 'DOCUMENT_UPLOADED', 'VALUE_CORRECTED', 'TASK_DRAFTED', 'REPORT_APPROVED', 'REPORT_SHARED', 'SHARE_REVOKED']) expect(actions.has(a)).toBe(true);
  });
});
