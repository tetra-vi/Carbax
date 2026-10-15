import {
  ALLOCATION_METHOD,
  COVERAGE_CHECKLIST,
  FORMULA_VERSION,
  METHODOLOGY_BOUNDARY,
  calculate,
  factorAssumptions,
} from '../domain/calculator';
import type { CalculationRun, Measurement, ReportingPeriod } from '../domain/types';
import { audit, newId, notFound, nowIso, orgPath, requireOrg, requireRole, type Deps, type RequestContext } from './core';
import { assertFactorSetUsable, getActiveFactorSet } from './factors';
import { getPeriod } from './organizations';

export async function confirmedForPeriod(deps: Deps, orgId: string, period: ReportingPeriod): Promise<Measurement[]> {
  const all = await deps.store.list<Measurement>(orgPath(orgId, 'measurements'), [['periodId', '==', period.id], ['reviewState', '==', 'CONFIRMED']]);
  return all.filter((m) => m.reportingMonth === period.key);
}

/** Runs the deterministic engine on the period's confirmed evidence and stores a versioned, traceable result. */
export async function runCalculationInternal(deps: Deps, orgId: string, periodId: string, actor: string): Promise<CalculationRun> {
  const period = await deps.store.get<ReportingPeriod>(orgPath(orgId, 'periods', periodId));
  if (!period) throw notFound('Reporting period');
  const factorSet = await getActiveFactorSet(deps);
  assertFactorSetUsable(factorSet);
  const measurements = await confirmedForPeriod(deps, orgId, period);
  const result = calculate({ measurements, factorSet });
  const reasons: string[] = [];
  for (const cat of period.requiredCategories) {
    if (!measurements.some((m) => m.type === cat)) reasons.push(`No confirmed ${cat.toLowerCase()} evidence for ${period.key}.`);
  }
  if (result.productionT <= 0) reasons.push('Production output is zero or missing, so intensity cannot be calculated.');
  const run: CalculationRun = {
    id: newId('calc'),
    organizationId: orgId,
    facilityId: period.facilityId,
    periodId,
    periodKey: period.key,
    factorSetId: factorSet.id,
    factorSetVersion: factorSet.version,
    formulaVersion: FORMULA_VERSION,
    boundary: METHODOLOGY_BOUNDARY,
    allocationMethod: ALLOCATION_METHOD,
    assumptions: factorAssumptions(factorSet),
    coverage: COVERAGE_CHECKLIST,
    result,
    status: reasons.length ? 'INCOMPLETE' : 'COMPLETE',
    incompleteReasons: reasons,
    createdBy: actor,
    createdAt: nowIso(deps),
  };
  await deps.store.set(orgPath(orgId, 'calculations', run.id), run);
  await deps.store.update(orgPath(orgId, 'periods', periodId), { latestCalculationId: run.id, updatedAt: run.createdAt });
  await audit(deps, orgId, actor, 'CALCULATION_RUN', 'calculation', run.id, `Calculated ${result.totalTCo2e} t CO2e for ${period.key} (${run.status})`);
  return run;
}

export async function runCalculation(deps: Deps, ctx: RequestContext, periodId: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  await getPeriod(deps, ctx, periodId);
  return runCalculationInternal(deps, orgId, periodId, ctx.uid);
}

export async function getCalculation(deps: Deps, ctx: RequestContext, calculationId: string): Promise<CalculationRun> {
  const orgId = requireOrg(ctx);
  const c = await deps.store.get<CalculationRun>(orgPath(orgId, 'calculations', calculationId));
  if (!c) throw notFound('Calculation');
  await getPeriod(deps, ctx, c.periodId);
  return c;
}

export async function latestCalculation(deps: Deps, orgId: string, periodId: string): Promise<CalculationRun | null> {
  const p = await deps.store.get<ReportingPeriod>(orgPath(orgId, 'periods', periodId));
  if (!p?.latestCalculationId) return null;
  return deps.store.get<CalculationRun>(orgPath(orgId, 'calculations', p.latestCalculationId));
}

export function previousKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function nextKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
