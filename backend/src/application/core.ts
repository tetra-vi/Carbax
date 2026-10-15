import { randomBytes, createHash } from 'node:crypto';
import type {
  Clock,
  DocStore,
  FileStore,
  IdentityVerifier,
  InternalCallVerifier,
  JobQueue,
  LlmClient,
  OcrEngine,
  SpeechService,
  Translator,
} from '../ports';
import type { AuditEvent, Language, Role } from '../domain/types';

export interface AppConfig {
  env: 'production' | 'development' | 'test';
  projectId: string;
  publicAppUrl: string; // used to build invite and share links
  superAdminEmails: string[];
  maxUploadBytes: number;
  intensityChangeThresholdPct: number;
  activeFactorSetId: string;
  agentMaxSteps: number;
  shareLinkMaxDays: number;
}

export interface Deps {
  config: AppConfig;
  store: DocStore;
  files: FileStore;
  llm: LlmClient;
  ocr: OcrEngine;
  translator: Translator;
  speech: SpeechService;
  queue: JobQueue;
  identity: IdentityVerifier;
  internalAuth: InternalCallVerifier;
  clock: Clock;
}

/** The authenticated, authorised caller. Built server-side from the verified Firebase token. */
export interface RequestContext {
  uid: string;
  email: string;
  organizationId: string | null;
  role: Role | null;
  facilityIds: string[];
  language: Language;
  isSuperAdmin: boolean;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission for this action') => new AppError(403, 'FORBIDDEN', msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function nowIso(deps: Pick<Deps, 'clock'>): string {
  return deps.clock.now().toISOString();
}

export function orgPath(orgId: string, ...parts: string[]): string {
  return ['organizations', orgId, ...parts].join('/');
}

export function requireOrg(ctx: RequestContext): string {
  if (!ctx.organizationId) throw new AppError(403, 'NO_ORGANIZATION', 'Complete company onboarding first');
  return ctx.organizationId;
}

export function requireRole(ctx: RequestContext, ...roles: Role[]): void {
  if (!ctx.role || !roles.includes(ctx.role)) throw forbidden();
}

export function canAccessFacility(ctx: RequestContext, facilityId: string): boolean {
  return ctx.facilityIds.includes('*') || ctx.facilityIds.includes(facilityId);
}

export function requireFacility(ctx: RequestContext, facilityId: string): void {
  if (!canAccessFacility(ctx, facilityId)) throw forbidden('You are not assigned to this facility');
}

/** Records an audit event. Never pass document contents or secrets in before/after. */
export async function audit(
  deps: Deps,
  orgId: string,
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
): Promise<void> {
  const ev: AuditEvent = {
    id: newId('aud'),
    organizationId: orgId,
    actor,
    action,
    entityType,
    entityId,
    summary,
    before: before ?? null,
    after: after ?? null,
    occurredAt: nowIso(deps),
  };
  await deps.store.set(orgPath(orgId, 'audit', ev.id), ev);
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
