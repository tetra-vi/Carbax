import { randomBytes } from 'node:crypto';
import { PLANS, TRIAL_DAYS } from '../domain/plans';
import { canTransitionPeriod } from '../domain/stateMachines';
import type {
  Facility,
  Invite,
  Language,
  Member,
  MeasurementType,
  Organization,
  PeriodStatus,
  ReportingPeriod,
  Role,
  UserIndex,
} from '../domain/types';
import {
  AppError,
  audit,
  badRequest,
  canAccessFacility,
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
import { getOrganization } from './usage';

// ---------- Identity / context ----------

export async function buildContext(deps: Deps, idToken: string): Promise<RequestContext> {
  let ident: { uid: string; email: string; emailVerified: boolean };
  try {
    ident = await deps.identity.verifyIdToken(idToken);
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired sign-in token');
  }
  const isSuperAdmin = ident.emailVerified && deps.config.superAdminEmails.includes(ident.email.toLowerCase());
  const user = await deps.store.get<UserIndex>(`users/${ident.uid}`);
  const base: RequestContext = {
    uid: ident.uid,
    email: ident.email.toLowerCase(),
    organizationId: null,
    role: null,
    facilityIds: [],
    language: 'en',
    isSuperAdmin,
  };
  if (!user?.organizationId) return base;
  const member = await deps.store.get<Member>(orgPath(user.organizationId, 'members', ident.uid));
  if (!member) return base;
  if (member.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_DISABLED', 'Your account has been disabled by your company');
  return {
    ...base,
    organizationId: user.organizationId,
    role: member.role,
    facilityIds: member.facilityIds,
    language: member.language,
  };
}

// ---------- Organizations ----------

export interface CreateOrgInput {
  name: string;
  country: string;
  industry: string;
  contactEmail: string;
  registrationNumber?: string;
  address?: string;
  phone?: string;
  preferredLanguage: Language;
  displayName: string;
}

export async function createOrganization(deps: Deps, ctx: RequestContext, input: CreateOrgInput) {
  if (ctx.organizationId) throw conflict('You already belong to an organization');
  const id = newId('org');
  const now = nowIso(deps);
  const trialEnds = new Date(deps.clock.now().getTime() + TRIAL_DAYS * 86400_000).toISOString();
  const org: Organization = {
    id,
    name: input.name,
    registrationNumber: input.registrationNumber,
    country: input.country,
    address: input.address,
    contactEmail: input.contactEmail,
    phone: input.phone,
    industry: input.industry,
    plan: 'TRIAL',
    trialEndsAt: trialEnds,
    preferredLanguage: input.preferredLanguage,
    status: 'ACTIVE',
    createdAt: now,
    createdBy: ctx.uid,
  };
  const member: Member = {
    uid: ctx.uid,
    email: ctx.email,
    displayName: input.displayName,
    role: 'OWNER',
    facilityIds: ['*'],
    status: 'ACTIVE',
    language: input.preferredLanguage,
    guidedMode: false,
    joinedAt: now,
  };
  await deps.store.transaction(async (tx) => {
    const existing = await tx.get<UserIndex>(`users/${ctx.uid}`);
    if (existing?.organizationId) throw conflict('You already belong to an organization');
    tx.create(orgPath(id), org);
    tx.create(orgPath(id, 'members', ctx.uid), member);
    tx.set(`users/${ctx.uid}`, { uid: ctx.uid, email: ctx.email, organizationId: id } satisfies UserIndex);
  });
  await audit(deps, id, ctx.uid, 'ORGANIZATION_CREATED', 'organization', id, `Organization "${org.name}" registered`);
  return org;
}

export async function getMe(deps: Deps, ctx: RequestContext) {
  const org = ctx.organizationId ? await getOrganization(deps, ctx.organizationId) : null;
  const member = ctx.organizationId ? await deps.store.get<Member>(orgPath(ctx.organizationId, 'members', ctx.uid)) : null;
  return { uid: ctx.uid, email: ctx.email, isSuperAdmin: ctx.isSuperAdmin, organization: org, member };
}

export async function updateOrganization(deps: Deps, ctx: RequestContext, patch: Partial<Organization>) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  const allowed: (keyof Organization)[] = ['name', 'registrationNumber', 'country', 'address', 'contactEmail', 'phone', 'industry', 'preferredLanguage'];
  const clean: Record<string, unknown> = {};
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  const before = await getOrganization(deps, orgId);
  await deps.store.update(orgPath(orgId), clean);
  await audit(deps, orgId, ctx.uid, 'ORGANIZATION_UPDATED', 'organization', orgId, 'Organization profile updated', pick(before, Object.keys(clean)), clean);
  return getOrganization(deps, orgId);
}

// ---------- Members & invitations ----------

export async function listMembers(deps: Deps, ctx: RequestContext): Promise<Member[]> {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  return deps.store.list<Member>(orgPath(orgId, 'members'));
}

export async function createInvite(deps: Deps, ctx: RequestContext, input: { email: string; role: Role; facilityIds: string[] }) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  const org = await getOrganization(deps, orgId);
  const members = await deps.store.list<Member>(orgPath(orgId, 'members'));
  if (members.filter((m) => m.status === 'ACTIVE').length >= PLANS[org.plan].maxUsers) {
    throw new AppError(429, 'QUOTA_EXCEEDED', `Your plan allows ${PLANS[org.plan].maxUsers} users`);
  }
  for (const f of input.facilityIds) {
    if (f !== '*' && !(await deps.store.get<Facility>(orgPath(orgId, 'facilities', f)))) throw badRequest(`Unknown facility ${f}`);
  }
  const token = randomBytes(24).toString('base64url');
  const id = sha256(token);
  const invite: Invite = {
    id,
    organizationId: orgId,
    organizationName: org.name,
    email: input.email.toLowerCase(),
    role: input.role,
    facilityIds: input.facilityIds,
    invitedBy: ctx.uid,
    createdAt: nowIso(deps),
    expiresAt: new Date(deps.clock.now().getTime() + 7 * 86400_000).toISOString(),
  };
  await deps.store.set(`invites/${id}`, invite);
  await audit(deps, orgId, ctx.uid, 'MEMBER_INVITED', 'invite', id, `Invited ${invite.email} as ${invite.role}`);
  return { inviteLink: `${deps.config.publicAppUrl}/invite/${token}`, expiresAt: invite.expiresAt, email: invite.email, role: invite.role };
}

export async function getInvite(deps: Deps, token: string) {
  const inv = await deps.store.get<Invite>(`invites/${sha256(token)}`);
  if (!inv) throw notFound('Invitation');
  return {
    organizationName: inv.organizationName,
    email: inv.email,
    role: inv.role,
    expired: new Date(inv.expiresAt) < deps.clock.now(),
    accepted: !!inv.acceptedBy,
  };
}

export async function acceptInvite(deps: Deps, ctx: RequestContext, token: string, displayName: string, language: Language) {
  if (ctx.organizationId) throw conflict('You already belong to an organization');
  const id = sha256(token);
  const inv = await deps.store.get<Invite>(`invites/${id}`);
  if (!inv) throw notFound('Invitation');
  if (inv.acceptedBy) throw conflict('Invitation already used');
  if (new Date(inv.expiresAt) < deps.clock.now()) throw new AppError(410, 'EXPIRED', 'Invitation has expired');
  if (inv.email !== ctx.email) throw forbidden('This invitation was sent to a different email address');
  const now = nowIso(deps);
  const member: Member = {
    uid: ctx.uid,
    email: ctx.email,
    displayName,
    role: inv.role,
    facilityIds: inv.facilityIds,
    status: 'ACTIVE',
    language,
    guidedMode: inv.role === 'WORKER',
    joinedAt: now,
  };
  await deps.store.transaction(async (tx) => {
    tx.create(orgPath(inv.organizationId, 'members', ctx.uid), member);
    tx.set(`users/${ctx.uid}`, { uid: ctx.uid, email: ctx.email, organizationId: inv.organizationId } satisfies UserIndex);
    tx.update(`invites/${id}`, { acceptedBy: ctx.uid, acceptedAt: now });
  });
  await audit(deps, inv.organizationId, ctx.uid, 'MEMBER_JOINED', 'member', ctx.uid, `${ctx.email} joined as ${inv.role}`);
  return member;
}

export async function updateMember(
  deps: Deps,
  ctx: RequestContext,
  uid: string,
  patch: { role?: Role; facilityIds?: string[]; status?: 'ACTIVE' | 'DISABLED' },
) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  const path = orgPath(orgId, 'members', uid);
  const m = await deps.store.get<Member>(path);
  if (!m) throw notFound('Member');
  if (m.role === 'OWNER' && (patch.role && patch.role !== 'OWNER' || patch.status === 'DISABLED')) {
    const owners = (await deps.store.list<Member>(orgPath(orgId, 'members'), [['role', '==', 'OWNER']])).filter((x) => x.status === 'ACTIVE');
    if (owners.length <= 1) throw conflict('An organization must keep at least one active owner');
  }
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await deps.store.update(path, clean);
  await audit(deps, orgId, ctx.uid, 'MEMBER_UPDATED', 'member', uid, `Member ${m.email} updated`, pick(m, Object.keys(clean)), clean);
  return { ...m, ...clean };
}

export async function updatePreferences(deps: Deps, ctx: RequestContext, p: { language?: Language; guidedMode?: boolean; displayName?: string }) {
  const orgId = requireOrg(ctx);
  const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
  await deps.store.update(orgPath(orgId, 'members', ctx.uid), clean);
  return deps.store.get<Member>(orgPath(orgId, 'members', ctx.uid));
}

// ---------- Facilities ----------

export interface FacilityInput {
  name: string;
  location: string;
  country: string;
  timeZone: string;
  industry: string;
  processes: string[];
  productCategories: string[];
  methodologies: string[];
  baselinePeriod?: string;
}

export async function createFacility(deps: Deps, ctx: RequestContext, input: FacilityInput): Promise<Facility> {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  const org = await getOrganization(deps, orgId);
  const existing = (await deps.store.list<Facility>(orgPath(orgId, 'facilities'))).filter((f) => f.status === 'ACTIVE');
  if (existing.length >= PLANS[org.plan].maxFacilities) {
    throw new AppError(429, 'QUOTA_EXCEEDED', `Your ${PLANS[org.plan].name} plan allows ${PLANS[org.plan].maxFacilities} facility(ies)`);
  }
  const f: Facility = { id: newId('fac'), organizationId: orgId, ...input, status: 'ACTIVE', createdAt: nowIso(deps) };
  await deps.store.create(orgPath(orgId, 'facilities', f.id), f);
  await audit(deps, orgId, ctx.uid, 'FACILITY_CREATED', 'facility', f.id, `Facility "${f.name}" created`);
  return f;
}

export async function listFacilities(deps: Deps, ctx: RequestContext): Promise<Facility[]> {
  const orgId = requireOrg(ctx);
  const all = await deps.store.list<Facility>(orgPath(orgId, 'facilities'));
  return all.filter((f) => canAccessFacility(ctx, f.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getFacility(deps: Deps, ctx: RequestContext, facilityId: string): Promise<Facility> {
  const orgId = requireOrg(ctx);
  requireFacility(ctx, facilityId);
  const f = await deps.store.get<Facility>(orgPath(orgId, 'facilities', facilityId));
  if (!f) throw notFound('Facility');
  return f;
}

export async function updateFacility(deps: Deps, ctx: RequestContext, facilityId: string, patch: Partial<FacilityInput> & { status?: 'ACTIVE' | 'ARCHIVED' }) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  const f = await getFacility(deps, ctx, facilityId);
  if (patch.status === 'ARCHIVED') {
    const periods = await deps.store.list<ReportingPeriod>(orgPath(orgId, 'periods'), [['facilityId', '==', facilityId]]);
    const open = periods.filter((p) => !['APPROVED', 'CLOSED', 'DRAFT'].includes(p.status));
    if (open.length) throw conflict(`Close or approve ${open.length} open reporting period(s) before archiving`);
  }
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await deps.store.update(orgPath(orgId, 'facilities', facilityId), clean);
  await audit(deps, orgId, ctx.uid, 'FACILITY_UPDATED', 'facility', facilityId, `Facility "${f.name}" updated`, pick(f, Object.keys(clean)), clean);
  return { ...f, ...clean };
}

// ---------- Reporting periods ----------

const DEFAULT_CATEGORIES: MeasurementType[] = ['ELECTRICITY', 'FUEL', 'PRODUCTION'];

export function periodIdFor(facilityId: string, key: string): string {
  return `per_${facilityId}_${key}`;
}

export async function createPeriod(
  deps: Deps,
  ctx: RequestContext,
  input: { facilityId: string; year: number; month: number; requiredCategories?: MeasurementType[] },
  actor = ctx.uid,
): Promise<ReportingPeriod> {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  await getFacility(deps, ctx, input.facilityId);
  return createPeriodInternal(deps, orgId, input, actor);
}

export async function createPeriodInternal(
  deps: Deps,
  orgId: string,
  input: { facilityId: string; year: number; month: number; requiredCategories?: MeasurementType[] },
  actor: string,
): Promise<ReportingPeriod> {
  const key = `${input.year}-${String(input.month).padStart(2, '0')}`;
  const now = nowIso(deps);
  const p: ReportingPeriod = {
    id: periodIdFor(input.facilityId, key),
    organizationId: orgId,
    facilityId: input.facilityId,
    year: input.year,
    month: input.month,
    key,
    status: 'COLLECTING_DATA',
    requiredCategories: input.requiredCategories?.length ? input.requiredCategories : DEFAULT_CATEGORIES,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await deps.store.create(orgPath(orgId, 'periods', p.id), p);
  } catch {
    throw conflict(`A reporting period for ${key} already exists for this facility`);
  }
  await audit(deps, orgId, actor, 'PERIOD_CREATED', 'period', p.id, `Reporting period ${key} opened`);
  return p;
}

export async function listPeriods(deps: Deps, ctx: RequestContext, facilityId?: string): Promise<ReportingPeriod[]> {
  const orgId = requireOrg(ctx);
  if (facilityId) requireFacility(ctx, facilityId);
  const all = await deps.store.list<ReportingPeriod>(orgPath(orgId, 'periods'), facilityId ? [['facilityId', '==', facilityId]] : []);
  return all.filter((p) => canAccessFacility(ctx, p.facilityId)).sort((a, b) => a.key.localeCompare(b.key));
}

export async function getPeriod(deps: Deps, ctx: RequestContext, periodId: string): Promise<ReportingPeriod> {
  const orgId = requireOrg(ctx);
  const p = await deps.store.get<ReportingPeriod>(orgPath(orgId, 'periods', periodId));
  if (!p) throw notFound('Reporting period');
  requireFacility(ctx, p.facilityId);
  return p;
}

/** Server-validated status transition. Used by workflows and by owners. */
export async function transitionPeriod(deps: Deps, orgId: string, periodId: string, to: PeriodStatus, actor: string, note?: string) {
  const path = orgPath(orgId, 'periods', periodId);
  const before = await deps.store.transaction(async (tx) => {
    const p = await tx.get<ReportingPeriod>(path);
    if (!p) throw notFound('Reporting period');
    if (!canTransitionPeriod(p.status, to)) throw conflict(`Cannot move a period from ${p.status} to ${to}`);
    tx.update(path, { status: to, updatedAt: nowIso(deps), ...(to === 'CLOSED' ? { closedAt: nowIso(deps) } : {}) });
    return p;
  });
  if (before.status !== to) {
    await audit(deps, orgId, actor, 'PERIOD_STATUS_CHANGED', 'period', periodId, `Period ${before.key}: ${before.status} -> ${to}${note ? ` (${note})` : ''}`, { status: before.status }, { status: to });
  }
}

export async function closePeriod(deps: Deps, ctx: RequestContext, periodId: string) {
  requireRole(ctx, 'OWNER');
  const p = await getPeriod(deps, ctx, periodId);
  await transitionPeriod(deps, p.organizationId, periodId, 'CLOSED', ctx.uid);
  return getPeriod(deps, ctx, periodId);
}

/** Controlled reopen: owner only, reason required, previous approved reports stay immutable. */
export async function reopenPeriod(deps: Deps, ctx: RequestContext, periodId: string, reason: string) {
  requireRole(ctx, 'OWNER');
  if (!reason || reason.trim().length < 10) throw badRequest('A reason of at least 10 characters is required to reopen a period');
  const p = await getPeriod(deps, ctx, periodId);
  if (p.status !== 'CLOSED' && p.status !== 'APPROVED') throw conflict('Only approved or closed periods can be reopened');
  const path = orgPath(p.organizationId, 'periods', periodId);
  await deps.store.update(path, { status: 'NEEDS_CORRECTION', updatedAt: nowIso(deps) });
  await audit(deps, p.organizationId, ctx.uid, 'PERIOD_REOPENED', 'period', periodId, `Period ${p.key} reopened: ${reason}`, { status: p.status }, { status: 'NEEDS_CORRECTION' });
  return getPeriod(deps, ctx, periodId);
}

function pick(o: object, keys: string[]): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of keys) r[k] = (o as Record<string, unknown>)[k];
  return r;
}
