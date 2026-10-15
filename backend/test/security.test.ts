import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { bill, buildTestDeps, client, fakePdf, TEST_FACTORS, type Harness } from './helpers';

describe('security and tenant isolation', () => {
  let h: Harness;
  const ownerA = () => client(h, 'ownerA', 'a@company-a.test');
  const ownerB = () => client(h, 'ownerB', 'b@company-b.test');
  const workerA = () => client(h, 'workerA', 'w@company-a.test');
  let facA = '';
  let facA2 = '';
  let periodA = '';
  let docA = '';

  beforeAll(async () => {
    h = buildTestDeps();
    await h.install();
    for (const [c, name, email] of [[ownerA(), 'Company A', 'a@company-a.test'], [ownerB(), 'Company B', 'b@company-b.test']] as const) {
      await c.post('/api/v1/organizations', { name, country: 'Sri Lanka', industry: 'Aluminium', contactEmail: email, preferredLanguage: 'en', displayName: name });
    }
    facA = (await ownerA().post('/api/v1/facilities', { name: 'Plant A', location: 'X', country: 'LK', timeZone: 'Asia/Colombo', industry: 'Al', processes: [], productCategories: [], methodologies: [] })).body.id;
    periodA = (await ownerA().post('/api/v1/reporting-periods', { facilityId: facA, year: 2026, month: 3 })).body.id;
    const up = await ownerA().upload('/api/v1/documents', { periodId: periodA }, fakePdf(bill('ELECTRICITY', '2026-03', 100, 'kWh')), 'a.pdf');
    docA = up.body.id;
    await h.queue.drain();
  });

  it('rejects missing and invalid tokens', async () => {
    expect((await request(h.app).get('/api/v1/me')).status).toBe(401);
    expect((await request(h.app).get('/api/v1/me').set('Authorization', 'Bearer forged')).status).toBe(401);
  });

  it('Organization B cannot read Organization A records', async () => {
    expect((await ownerB().get(`/api/v1/documents/${docA}`)).status).toBe(404);
    expect((await ownerB().get(`/api/v1/documents/${docA}/file`)).status).toBe(404);
    expect((await ownerB().get(`/api/v1/reporting-periods/${periodA}`)).status).toBe(404);
    expect((await ownerB().get(`/api/v1/facilities/${facA}`)).status).toBe(404); // no existence leak
    expect((await ownerB().upload('/api/v1/documents', { periodId: periodA }, fakePdf(bill('FUEL', '2026-03', 1, 'L')), 'x.pdf')).status).toBe(404);
    const listB = await ownerB().get('/api/v1/facilities');
    expect(listB.body).toEqual([]);
  });

  it('workers are restricted to their assigned facility and cannot see financial data', async () => {
    // Plan limit: TRIAL allows one facility; upgrade A to BUSINESS through the platform admin to add a second.
    const admin = client(h, 'adm', 'admin@platform.test');
    const orgs = await admin.get('/api/v1/admin/organizations');
    const a = orgs.body.find((o: { name: string }) => o.name === 'Company A');
    await admin.patch(`/api/v1/admin/organizations/${a.id}`, { plan: 'BUSINESS' });
    facA2 = (await ownerA().post('/api/v1/facilities', { name: 'Plant A2', location: 'Y', country: 'LK', timeZone: 'Asia/Colombo', industry: 'Al', processes: [], productCategories: [], methodologies: [] })).body.id;
    const inv = await ownerA().post('/api/v1/members/invites', { email: 'w@company-a.test', role: 'WORKER', facilityIds: [facA2] });
    await workerA().post(`/api/v1/invites/${inv.body.inviteLink.split('/invite/')[1]}/accept`, { displayName: 'W', language: 'en' });
    expect((await workerA().get(`/api/v1/documents/${docA}`)).status).toBe(403);
    expect((await workerA().get(`/api/v1/reporting-periods/${periodA}`)).status).toBe(403);
    expect((await workerA().get('/api/v1/subscription')).status).toBe(403);
    expect((await workerA().get('/api/v1/audit')).status).toBe(403);
    expect((await workerA().post('/api/v1/facilities', { name: 'Hack', location: 'x', country: 'LK', timeZone: 'UTC', industry: 'Aluminium', processes: [], productCategories: [], methodologies: [] })).status).toBe(403);
    expect((await workerA().patch('/api/v1/members/workerA', { role: 'OWNER' })).status).toBe(403);
  });

  it('invitations cannot be used by a different email address', async () => {
    const inv = await ownerA().post('/api/v1/members/invites', { email: 'intended@company-a.test', role: 'REVIEWER', facilityIds: ['*'] });
    const token = inv.body.inviteLink.split('/invite/')[1];
    expect((await client(h, 'thief', 'thief@evil.test').post(`/api/v1/invites/${token}/accept`, { displayName: 'T', language: 'en' })).status).toBe(403);
  });

  it('prompt-injection text in a document is treated as data and flagged', async () => {
    const malicious = bill('ELECTRICITY', '2026-03', 200, 'kWh', { suspiciousInstructions: true });
    const up = await ownerA().upload('/api/v1/documents', { periodId: periodA }, fakePdf(malicious), 'evil.pdf');
    await h.queue.drain();
    const d = await ownerA().get(`/api/v1/documents/${up.body.id}`);
    expect(d.body.status).toBe('NEEDS_REVIEW');
    const ext = await ownerA().get(`/api/v1/extractions/${d.body.extractionId}`);
    expect(ext.body.warnings.join(' ')).toContain('looks like instructions');
    expect(ext.body.status).toBe('NEEDS_REVIEW'); // never auto-confirmed
    const reports = await ownerA().get('/api/v1/reports');
    expect(reports.body).toEqual([]);
  });

  it('rejects AI output that fails schema validation instead of saving it', async () => {
    const up = await ownerA().upload('/api/v1/documents', { periodId: periodA }, fakePdf({ documentType: 'NOT_A_TYPE', items: 'nope' }), 'garbage.pdf');
    await h.queue.drain();
    const d = await ownerA().get(`/api/v1/documents/${up.body.id}`);
    expect(d.body.status).toBe('FAILED');
    expect(d.body.error).toContain('schema validation');
    expect(d.body.extractionId).toBeUndefined();
  });

  it('jobs are idempotent: a finished job is not processed twice', async () => {
    const d = await ownerA().get(`/api/v1/documents/${docA}`);
    const r = await request(h.app).post('/internal/tasks/process-document').set('Authorization', 'Bearer internal-test-secret').send({ jobId: d.body.jobId, organizationId: d.body.organizationId });
    expect(r.body.result).toBe('skipped');
    expect((await request(h.app).post('/internal/tasks/process-document').send({ jobId: d.body.jobId, organizationId: d.body.organizationId })).status).toBe(401);
  });

  it('rejects invalid confirmations (bad unit, bad month)', async () => {
    const d = await ownerA().get(`/api/v1/documents/${docA}`);
    const bad = await ownerA().post(`/api/v1/extractions/${d.body.extractionId}/confirm`, { items: [{ index: 0, include: true, measurementType: 'ELECTRICITY', reportingMonth: '2026-03', quantity: 100, unit: 'litres' }] });
    expect(bad.status).toBe(400);
    const badMonth = await ownerA().post(`/api/v1/extractions/${d.body.extractionId}/confirm`, { items: [{ index: 0, include: true, measurementType: 'ELECTRICITY', reportingMonth: '2026-13', quantity: 100, unit: 'kWh' }] });
    expect(badMonth.status).toBe(400);
  });

  it('refuses to calculate when the grid factor is not configured', async () => {
    await h.deps.store.set(`factorSets/${TEST_FACTORS.id}`, { ...TEST_FACTORS, electricity: { ...TEST_FACTORS.electricity, kgCo2ePerKWh: null } });
    const r = await ownerA().post('/api/v1/calculations/run', { periodId: periodA });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('FACTOR_NOT_CONFIGURED');
    await h.install();
  });

  it('cannot approve a report while evidence is incomplete', async () => {
    const inv = await ownerA().post('/api/v1/members/invites', { email: 'r@company-a.test', role: 'REVIEWER', facilityIds: ['*'] });
    const rev = client(h, 'revA', 'r@company-a.test');
    await rev.post(`/api/v1/invites/${inv.body.inviteLink.split('/invite/')[1]}/accept`, { displayName: 'R', language: 'en' });
    const d = await ownerA().get(`/api/v1/documents/${docA}`);
    await ownerA().post(`/api/v1/extractions/${d.body.extractionId}/confirm`, { items: [{ index: 0, include: true, measurementType: 'ELECTRICITY', reportingMonth: '2026-03', quantity: 100, unit: 'kWh' }] });
    const g = await ownerA().post('/api/v1/reports/generate', { periodId: periodA });
    expect(g.status).toBe(200);
    expect(g.body.readiness.status).not.toBe('READY_FOR_HUMAN_REVIEW');
    const ap = await rev.post(`/api/v1/reports/${g.body.id}/approve`, { comment: 'trying' });
    expect(ap.status).toBe(409);
    expect(ap.body.error.code).toBe('NOT_READY');
  });

  it('enforces upload size limits', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3 * 1024 * 1024, 65)]);
    expect((await ownerA().upload('/api/v1/documents', { periodId: periodA }, big, 'big.pdf')).status).toBe(413);
  });
});
