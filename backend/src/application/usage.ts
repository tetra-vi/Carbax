import { PLANS, type Feature } from '../domain/plans';
import type { Organization, UsageRecord } from '../domain/types';
import { AppError, monthKey, orgPath, type Deps } from './core';

type Counter = 'documentsProcessed' | 'aiCalls' | 'speechSeconds' | 'reportsGenerated';

export async function getOrganization(deps: Deps, orgId: string): Promise<Organization> {
  const org = await deps.store.get<Organization>(orgPath(orgId));
  if (!org) throw new AppError(404, 'NOT_FOUND', 'Organization not found');
  return org;
}

export async function currentUsage(deps: Deps, orgId: string): Promise<UsageRecord> {
  const month = monthKey(deps.clock.now());
  const rec = await deps.store.get<UsageRecord>(orgPath(orgId, 'usage', month));
  return rec ?? { month, documentsProcessed: 0, aiCalls: 0, speechSeconds: 0, reportsGenerated: 0 };
}

export async function incrementUsage(deps: Deps, orgId: string, counter: Counter, by = 1): Promise<void> {
  const month = monthKey(deps.clock.now());
  const path = orgPath(orgId, 'usage', month);
  await deps.store.transaction(async (tx) => {
    const cur = (await tx.get<UsageRecord>(path)) ?? { month, documentsProcessed: 0, aiCalls: 0, speechSeconds: 0, reportsGenerated: 0 };
    tx.set(path, { ...cur, [counter]: cur[counter] + by });
  });
}

/** Backend-enforced entitlement check. */
export async function assertFeature(deps: Deps, orgId: string, feature: Feature): Promise<void> {
  const org = await getOrganization(deps, orgId);
  assertActivePlan(deps, org);
  if (!PLANS[org.plan].features.includes(feature)) {
    throw new AppError(402, 'PLAN_UPGRADE_REQUIRED', `Your ${PLANS[org.plan].name} plan does not include ${feature}`);
  }
}

export async function assertQuota(deps: Deps, orgId: string, counter: Counter, needed = 1): Promise<void> {
  const org = await getOrganization(deps, orgId);
  assertActivePlan(deps, org);
  const plan = PLANS[org.plan];
  const usage = await currentUsage(deps, orgId);
  const limit =
    counter === 'documentsProcessed' ? plan.documentsPerMonth : counter === 'aiCalls' ? plan.aiCallsPerMonth : counter === 'speechSeconds' ? plan.speechSecondsPerMonth : Infinity;
  if (usage[counter] + needed > limit) {
    throw new AppError(429, 'QUOTA_EXCEEDED', `Monthly ${counter} limit (${limit}) reached for the ${plan.name} plan`);
  }
}

function assertActivePlan(deps: Deps, org: Organization): void {
  if (org.status !== 'ACTIVE') throw new AppError(403, 'ORGANIZATION_SUSPENDED', 'This organization is suspended');
  if (org.plan === 'TRIAL' && org.trialEndsAt && new Date(org.trialEndsAt) < deps.clock.now()) {
    throw new AppError(402, 'TRIAL_EXPIRED', 'The free trial has ended');
  }
}

/** Wraps an AI call with quota enforcement and usage metering. */
export async function meteredAi<T>(deps: Deps, orgId: string, fn: () => Promise<T>): Promise<T> {
  await assertQuota(deps, orgId, 'aiCalls');
  const r = await fn();
  await incrementUsage(deps, orgId, 'aiCalls');
  return r;
}
