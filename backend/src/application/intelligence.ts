import Decimal from 'decimal.js';
import { detectAnomalies, ANOMALY_THRESHOLDS, type PeriodPoint } from '../domain/anomalies';
import { applyScenario, calculate, round } from '../domain/calculator';
import type {
  CalculationRun,
  EvidenceIssue,
  ImprovementAction,
  Measurement,
  ReportingPeriod,
  Scenario,
  ScenarioInputs,
} from '../domain/types';
import {
  audit,
  badRequest,
  conflict,
  newId,
  notFound,
  nowIso,
  orgPath,
  requireFacility,
  requireOrg,
  requireRole,
  type Deps,
  type RequestContext,
} from './core';
import { confirmedForPeriod, latestCalculation } from './calculations';
import { getFactorSet } from './factors';
import { getFacility, getPeriod, listPeriods } from './organizations';
import { assertFeature, meteredAi } from './usage';

// ---------- Carbon Intelligence dashboard ----------

export async function getDashboard(deps: Deps, ctx: RequestContext, facilityId: string, periodId?: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  await assertFeature(deps, orgId, 'INTELLIGENCE');
  const facility = await getFacility(deps, ctx, facilityId);
  const periods = await listPeriods(deps, ctx, facilityId);
  const calcs = new Map<string, CalculationRun | null>();
  for (const p of periods) calcs.set(p.id, await latestCalculation(deps, orgId, p.id));
  const series: (PeriodPoint & { totalTCo2e: number | null; status: string; calcStatus: string | null })[] = periods.map((p) => {
    const c = calcs.get(p.id);
    return {
      periodId: p.id,
      key: p.key,
      status: p.status,
      calcStatus: c?.status ?? null,
      electricityKWh: c ? c.result.electricityKWh : null,
      dieselKg: c ? c.result.dieselKg : null,
      productionT: c ? c.result.productionT : null,
      intensity: c && c.status === 'COMPLETE' ? c.result.intensityTCo2ePerT : null,
      totalTCo2e: c ? c.result.totalTCo2e : null,
    };
  });
  const current = periodId ? periods.find((p) => p.id === periodId) : periods[periods.length - 1];
  if (periodId && !current) throw notFound('Reporting period');
  const currentCalc = current ? calcs.get(current.id) ?? null : null;
  const issues = current ? await deps.store.list<EvidenceIssue>(orgPath(orgId, 'issues'), [['periodId', '==', current.id], ['status', '==', 'OPEN']]) : [];
  const measurements = current ? await confirmedForPeriod(deps, orgId, current) : [];
  const actions = await deps.store.list<ImprovementAction>(orgPath(orgId, 'actions'), [['facilityId', '==', facilityId]]);
  const completeness = current
    ? Math.round((current.requiredCategories.filter((c) => measurements.some((m) => m.type === c)).length / current.requiredCategories.length) * 100)
    : 0;
  return {
    facility: { id: facility.id, name: facility.name },
    currentPeriod: current ? { id: current.id, key: current.key, status: current.status } : null,
    kpis: {
      totalTCo2e: currentCalc?.result.totalTCo2e ?? null,
      electricityKWh: currentCalc?.result.electricityKWh ?? null,
      dieselKg: currentCalc?.result.dieselKg ?? null,
      productionT: currentCalc?.result.productionT ?? null,
      intensityTCo2ePerT: currentCalc?.status === 'COMPLETE' ? currentCalc.result.intensityTCo2ePerT : null,
      evidenceCompletenessPct: completeness,
      openIssues: issues.length,
      activeActions: actions.filter((a) => a.status === 'PLANNED' || a.status === 'IN_PROGRESS').length,
      latestCalculationStatus: currentCalc?.status ?? 'NONE',
      latestCalculationId: currentCalc?.id ?? null,
    },
    series,
    anomalies: detectAnomalies(series),
    anomalyThresholds: ANOMALY_THRESHOLDS,
    actions: actions.map((a) => ({ id: a.id, title: a.title, status: a.status, metric: a.metric, baselineValue: a.baselineValue, targetValue: a.targetValue, latest: a.followUps[a.followUps.length - 1] ?? null })),
  };
}

export async function explainDashboard(deps: Deps, ctx: RequestContext, facilityId: string) {
  const orgId = requireOrg(ctx);
  const dash = await getDashboard(deps, ctx, facilityId);
  if (!dash.anomalies.length) return { explanation: 'No anomalies exceeded the documented thresholds.', aiGenerated: false };
  const text = await meteredAi(deps, orgId, () =>
    deps.llm.generateText({
      system:
        'You explain carbon dashboard flags to a small factory owner in simple words. Use only the numbers given. ' +
        'Flags are prompts to investigate, never proof of equipment failure, waste or poor practice. Suggest 2-3 things to check. Max 120 words.' +
        (ctx.language !== 'en' ? ` Answer in the language with ISO code "${ctx.language}".` : ''),
      parts: [{ text: JSON.stringify({ anomalies: dash.anomalies, series: dash.series.map((s) => ({ month: s.key, kWh: s.electricityKWh, dieselKg: s.dieselKg, tonnes: s.productionT, intensity: s.intensity })) }) }],
    }),
  );
  return { explanation: text, aiGenerated: true };
}

// ---------- CarbonTwin Lite ----------

export async function createScenario(deps: Deps, ctx: RequestContext, input: { periodId: string; inputs: ScenarioInputs; explain?: boolean }) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  await assertFeature(deps, orgId, 'CARBONTWIN');
  const period = await getPeriod(deps, ctx, input.periodId);
  const base = await latestCalculation(deps, orgId, period.id);
  if (!base || base.status !== 'COMPLETE') throw conflict('Run a complete calculation for this period before simulating scenarios');
  const factorSet = await getFactorSet(deps, base.factorSetId);
  const measurements = await confirmedForPeriod(deps, orgId, period);
  const i = input.inputs;
  for (const v of [i.electricityChangePct, i.dieselChangePct, i.productionChangePct]) {
    if (v < -100 || v > 200) throw badRequest('Changes must be between -100% and +200%');
  }
  const baseline = calculate({ measurements, factorSet });
  const projected = calculate({ measurements: applyScenario(measurements, i), factorSet });
  let costChange: number | null = null;
  const assumptions = [
    'Hypothetical scenario: recorded measurements are unchanged; a copy was adjusted and recalculated with the same factor set.',
    `Factor set ${factorSet.id} v${factorSet.version}; formula ${base.formulaVersion}.`,
    'Results are illustrative and are not a forecast or a guaranteed saving.',
  ];
  if (i.dieselPricePerL || i.electricityPricePerKWh) {
    const dieselLDelta = new Decimal(projected.dieselKg - baseline.dieselKg).div(factorSet.diesel.densityKgPerL);
    const kWhDelta = new Decimal(projected.electricityKWh - baseline.electricityKWh);
    costChange = round(dieselLDelta.mul(i.dieselPricePerL ?? 0).plus(kWhDelta.mul(i.electricityPricePerKWh ?? 0)), 2);
    assumptions.push(`Cost effect uses user-entered prices only (diesel: ${i.dieselPricePerL ? i.dieselPricePerL + ' per litre' : 'not provided'}; electricity: ${i.electricityPricePerKWh ? i.electricityPricePerKWh + ' per kWh' : 'not provided'}${i.currency ? '; currency ' + i.currency : ''}); taxes and tariffs are not modelled.`);
  }
  const scenario: Scenario = {
    id: newId('scn'),
    organizationId: orgId,
    facilityId: period.facilityId,
    periodId: period.id,
    baseCalculationId: base.id,
    inputs: i,
    baseline,
    projected,
    delta: {
      totalTCo2e: round(new Decimal(projected.totalTCo2e).minus(baseline.totalTCo2e), 4),
      intensityTCo2ePerT:
        projected.intensityTCo2ePerT !== null && baseline.intensityTCo2ePerT !== null ? round(new Decimal(projected.intensityTCo2ePerT).minus(baseline.intensityTCo2ePerT), 4) : null,
      costChange,
    },
    assumptions,
    explanation: null,
    explanationIsAiGenerated: false,
    status: 'HYPOTHETICAL',
    createdBy: ctx.uid,
    createdAt: nowIso(deps),
  };
  if (input.explain !== false) {
    try {
      scenario.explanation = await meteredAi(deps, orgId, () =>
        deps.llm.generateText({
          system:
            'Explain a hypothetical carbon scenario to a factory manager in at most 100 simple words. Use ONLY the numbers provided; do not calculate new numbers. ' +
            'State clearly that it is hypothetical and suggest one practical investigation step.' +
            (ctx.language !== 'en' ? ` Answer in the language with ISO code "${ctx.language}".` : ''),
          parts: [{ text: JSON.stringify({ month: period.key, inputs: i, baseline: { totalTCo2e: baseline.totalTCo2e, intensity: baseline.intensityTCo2ePerT }, projected: { totalTCo2e: projected.totalTCo2e, intensity: projected.intensityTCo2ePerT }, delta: scenario.delta }) }],
        }),
      );
      scenario.explanationIsAiGenerated = true;
    } catch {
      scenario.explanation = null; // explanation is optional; numbers never depend on it
    }
  }
  await deps.store.set(orgPath(orgId, 'scenarios', scenario.id), scenario);
  await audit(deps, orgId, ctx.uid, 'SCENARIO_RUN', 'scenario', scenario.id, `Scenario for ${period.key}: delta ${scenario.delta.totalTCo2e} t CO2e`);
  return scenario;
}

export async function getScenario(deps: Deps, ctx: RequestContext, id: string) {
  const orgId = requireOrg(ctx);
  const s = await deps.store.get<Scenario>(orgPath(orgId, 'scenarios', id));
  if (!s) throw notFound('Scenario');
  requireFacility(ctx, s.facilityId);
  return s;
}

export async function listScenarios(deps: Deps, ctx: RequestContext, periodId: string) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER', 'REVIEWER');
  await getPeriod(deps, ctx, periodId);
  const list = await deps.store.list<Scenario>(orgPath(orgId, 'scenarios'), [['periodId', '==', periodId]]);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Improvement actions ----------

function metricValue(metric: ImprovementAction['metric'], c: CalculationRun, densityKgPerL: number): number {
  if (metric === 'DIESEL_L') return round(new Decimal(c.result.dieselKg).div(densityKgPerL), 2);
  if (metric === 'ELECTRICITY_KWH') return c.result.electricityKWh;
  return c.result.intensityTCo2ePerT ?? 0;
}

export async function createAction(
  deps: Deps,
  ctx: RequestContext,
  input: { title: string; description: string; metric: ImprovementAction['metric']; baselinePeriodId: string; targetChangePct: number; scenarioId?: string; issueId?: string; assigneeUid?: string; startDate: string; dueDate: string },
) {
  const orgId = requireOrg(ctx);
  requireRole(ctx, 'OWNER');
  const period = await getPeriod(deps, ctx, input.baselinePeriodId);
  const calc = await latestCalculation(deps, orgId, period.id);
  if (!calc || calc.status !== 'COMPLETE') throw conflict('The baseline period needs a complete calculation');
  const f = await getFactorSet(deps, calc.factorSetId);
  const baselineValue = metricValue(input.metric, calc, f.diesel.densityKgPerL);
  if (input.assigneeUid) {
    const m = await deps.store.get<{ status: string }>(orgPath(orgId, 'members', input.assigneeUid));
    if (!m || m.status !== 'ACTIVE') throw badRequest('Unknown assignee');
  }
  const now = nowIso(deps);
  const action: ImprovementAction = {
    id: newId('act'),
    organizationId: orgId,
    facilityId: period.facilityId,
    title: input.title,
    description: input.description,
    metric: input.metric,
    scenarioId: input.scenarioId ?? null,
    issueId: input.issueId ?? null,
    assigneeUid: input.assigneeUid ?? null,
    startDate: input.startDate,
    dueDate: input.dueDate,
    baselinePeriodId: period.id,
    baselineValue,
    targetValue: round(new Decimal(baselineValue).mul(new Decimal(1).plus(new Decimal(input.targetChangePct).div(100))), 4),
    status: 'PLANNED',
    completionEvidence: null,
    followUps: [],
    createdBy: ctx.uid,
    createdAt: now,
    updatedAt: now,
  };
  await deps.store.set(orgPath(orgId, 'actions', action.id), action);
  await audit(deps, orgId, ctx.uid, 'ACTION_CREATED', 'action', action.id, `Improvement action "${action.title}" created`);
  return action;
}

export async function listActions(deps: Deps, ctx: RequestContext, facilityId: string) {
  const orgId = requireOrg(ctx);
  requireFacility(ctx, facilityId);
  const list = await deps.store.list<ImprovementAction>(orgPath(orgId, 'actions'), [['facilityId', '==', facilityId]]);
  const visible = ctx.role === 'WORKER' ? list.filter((a) => a.assigneeUid === ctx.uid) : list;
  return visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateAction(deps: Deps, ctx: RequestContext, id: string, patch: { status?: ImprovementAction['status']; assigneeUid?: string | null; completionEvidence?: string; dueDate?: string }) {
  const orgId = requireOrg(ctx);
  const path = orgPath(orgId, 'actions', id);
  const a = await deps.store.get<ImprovementAction>(path);
  if (!a) throw notFound('Action');
  requireFacility(ctx, a.facilityId);
  if (ctx.role === 'WORKER' && (a.assigneeUid !== ctx.uid || patch.assigneeUid !== undefined)) throw notFound('Action');
  if (ctx.role === 'REVIEWER' || ctx.role === 'BUYER') requireRole(ctx, 'OWNER');
  const clean = { ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), updatedAt: nowIso(deps) };
  await deps.store.update(path, clean);
  await audit(deps, orgId, ctx.uid, 'ACTION_UPDATED', 'action', id, `Action "${a.title}" updated`, { status: a.status }, clean);
  return evaluateAction(deps, ctx, id);
}

/** Compares measured results in later periods with the action's baseline. Never claims unmeasured savings. */
export async function evaluateAction(deps: Deps, ctx: RequestContext, id: string) {
  const orgId = requireOrg(ctx);
  const path = orgPath(orgId, 'actions', id);
  const a = await deps.store.get<ImprovementAction>(path);
  if (!a) throw notFound('Action');
  requireFacility(ctx, a.facilityId);
  const base = await deps.store.get<ReportingPeriod>(orgPath(orgId, 'periods', a.baselinePeriodId));
  const periods = (await deps.store.list<ReportingPeriod>(orgPath(orgId, 'periods'), [['facilityId', '==', a.facilityId]])).filter((p) => base && p.key > base.key).sort((x, y) => x.key.localeCompare(y.key));
  const followUps: ImprovementAction['followUps'] = [];
  for (const p of periods) {
    const c = await latestCalculation(deps, orgId, p.id);
    if (!c || c.status !== 'COMPLETE') continue;
    const f = await getFactorSet(deps, c.factorSetId);
    const actual = metricValue(a.metric, c, f.diesel.densityKgPerL);
    followUps.push({ periodId: p.id, periodKey: p.key, actualValue: actual, changePct: a.baselineValue ? round(new Decimal(actual).minus(a.baselineValue).div(a.baselineValue).mul(100), 2) : 0, evaluatedAt: nowIso(deps) });
  }
  await deps.store.update(path, { followUps });
  return { ...a, followUps };
}

export type { Measurement };
