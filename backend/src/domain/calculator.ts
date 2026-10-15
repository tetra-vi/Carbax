import Decimal from 'decimal.js';
import type { CalculationLine, CalculationResult, FactorSet, Measurement } from './types';

// Deterministic carbon calculation engine. No AI is involved in any number produced here.
export const FORMULA_VERSION = 'energy-scope-v1.0';

export const METHODOLOGY_BOUNDARY =
  'Energy-related emissions estimate for one facility and one reporting month: ' +
  'grid electricity consumed (indirect) and diesel combusted on site (direct CO2). ' +
  'Precursor emissions (e.g. purchased unwrought aluminium), process emissions and ' +
  'other fuels are NOT included. This is not a complete CBAM embedded-emissions figure.';

export const ALLOCATION_METHOD =
  'All facility energy in the period is allocated to the single declared product line (100% allocation).';

export const COVERAGE_CHECKLIST = [
  { element: 'Grid electricity (indirect emissions)', included: true, note: 'From confirmed electricity bills.' },
  { element: 'Diesel combustion (direct CO2)', included: true, note: 'From confirmed fuel receipts; CO2 only.' },
  { element: 'Other fuels (LPG, natural gas, coal)', included: false, note: 'Not supported in this version.' },
  { element: 'Process emissions (e.g. anode consumption, PFCs)', included: false, note: 'Requires process data and expert method review.' },
  { element: 'Precursor embedded emissions', included: false, note: 'Requires supplier emissions data for input materials.' },
  { element: 'Product-level allocation across multiple products', included: false, note: 'Single-product allocation assumed.' },
  { element: 'Independent verification', included: false, note: 'Must be performed by an accredited verifier.' },
];

export interface CalculationInput {
  measurements: Measurement[]; // CONFIRMED measurements for the period
  factorSet: FactorSet;
}

export function dieselKgPerUnitCo2(f: FactorSet): Decimal {
  // kg CO2 per kg diesel = (NCV TJ/Gg / 1e6 kg per Gg) * (kg CO2 / TJ)
  return new Decimal(f.diesel.ncvTJPerGg).div(1_000_000).mul(f.diesel.co2KgPerTJ);
}

/** Pure function: same inputs always produce the same result. */
export function calculate(input: CalculationInput): CalculationResult {
  const { factorSet: f } = input;
  const confirmed = input.measurements.filter((m) => m.reviewState === 'CONFIRMED');
  const elec = confirmed.filter((m) => m.type === 'ELECTRICITY');
  const fuel = confirmed.filter((m) => m.type === 'FUEL');
  const prod = confirmed.filter((m) => m.type === 'PRODUCTION');

  const sum = (ms: Measurement[]) => ms.reduce((acc, m) => acc.plus(m.canonicalQuantity), new Decimal(0));
  const kWh = sum(elec);
  const dieselKg = sum(fuel);
  const tonnes = sum(prod);

  if (f.electricity.kgCo2ePerKWh === null) throw new Error('Grid electricity emission factor is not configured');
  const elecT = kWh.mul(f.electricity.kgCo2ePerKWh).div(1000);
  const perKg = dieselKgPerUnitCo2(f);
  const fuelT = dieselKg.mul(perKg).div(1000);
  const total = elecT.plus(fuelT);
  const intensity = tonnes.gt(0) ? total.div(tonnes) : null;

  const lines: CalculationLine[] = [
    {
      label: 'Grid electricity',
      measurementType: 'ELECTRICITY',
      input: round(kWh, 3),
      inputUnit: 'kWh',
      factor: f.electricity.kgCo2ePerKWh,
      factorUnit: 'kg CO2e/kWh',
      formula: `${round(kWh, 3)} kWh x ${f.electricity.kgCo2ePerKWh} kg CO2e/kWh / 1000`,
      resultTCo2e: round(elecT, 4),
      measurementIds: elec.map((m) => m.id),
      sourceDocumentIds: unique(elec.map((m) => m.sourceDocumentId)),
    },
    {
      label: 'Diesel combustion',
      measurementType: 'FUEL',
      input: round(dieselKg, 3),
      inputUnit: 'kg',
      factor: round(perKg, 6),
      factorUnit: 'kg CO2/kg diesel',
      formula:
        `${round(dieselKg, 3)} kg x (${f.diesel.ncvTJPerGg} TJ/Gg / 1e6 x ${f.diesel.co2KgPerTJ} kg CO2/TJ) / 1000`,
      resultTCo2e: round(fuelT, 4),
      measurementIds: fuel.map((m) => m.id),
      sourceDocumentIds: unique(fuel.map((m) => m.sourceDocumentId)),
    },
    {
      label: 'Production output',
      measurementType: 'PRODUCTION',
      input: round(tonnes, 3),
      inputUnit: 't',
      factor: null,
      factorUnit: null,
      formula: intensity ? `${round(total, 4)} t CO2e / ${round(tonnes, 3)} t product` : 'No production output confirmed',
      resultTCo2e: null,
      measurementIds: prod.map((m) => m.id),
      sourceDocumentIds: unique(prod.map((m) => m.sourceDocumentId)),
    },
  ];

  return {
    electricityKWh: round(kWh, 3),
    dieselKg: round(dieselKg, 3),
    productionT: round(tonnes, 3),
    electricityTCo2e: round(elecT, 4),
    fuelTCo2e: round(fuelT, 4),
    totalTCo2e: round(total, 4),
    intensityTCo2ePerT: intensity ? round(intensity, 4) : null,
    lines,
  };
}

export function factorAssumptions(f: FactorSet): string[] {
  return [
    `Factor set ${f.name} (${f.id} v${f.version}).`,
    `Grid electricity factor ${f.electricity.kgCo2ePerKWh} kg CO2e/kWh for ${f.electricity.country} (${f.electricity.year}); source: ${f.electricity.source}.`,
    `Diesel: ${f.diesel.co2KgPerTJ} kg CO2/TJ, NCV ${f.diesel.ncvTJPerGg} TJ/Gg, density ${f.diesel.densityKgPerL} kg/L; source: ${f.diesel.source}.`,
    ALLOCATION_METHOD,
  ];
}

export interface ScenarioAdjustments {
  electricityChangePct: number;
  dieselChangePct: number;
  productionChangePct: number;
}

/** Applies percentage changes to a copy of the confirmed measurements; originals are never modified. */
export function applyScenario(measurements: Measurement[], adj: ScenarioAdjustments): Measurement[] {
  const factor = (pct: number) => new Decimal(1).plus(new Decimal(pct).div(100));
  return measurements.map((m) => {
    const pct =
      m.type === 'ELECTRICITY' ? adj.electricityChangePct : m.type === 'FUEL' ? adj.dieselChangePct : adj.productionChangePct;
    const k = factor(pct);
    return {
      ...m,
      quantity: new Decimal(m.quantity).mul(k).toNumber(),
      canonicalQuantity: new Decimal(m.canonicalQuantity).mul(k).toNumber(),
    };
  });
}

export function round(d: Decimal, dp: number): number {
  return d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toNumber();
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
