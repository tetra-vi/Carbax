// Documented, deterministic anomaly thresholds for the Carbon Intelligence dashboard.
// A flag means "worth investigating"; it never asserts equipment failure or poor practice.

export const ANOMALY_THRESHOLDS = {
  electricityIncreasePct: 25,
  dieselPerTonneIncreasePct: 20,
  intensityIncreasePct: 20,
  productionPerKWhDropPct: 15,
} as const;

export interface PeriodPoint {
  periodId: string;
  key: string;
  electricityKWh: number | null;
  dieselKg: number | null;
  productionT: number | null;
  intensity: number | null;
}

export interface Anomaly {
  periodKey: string;
  metric: string;
  changePct: number;
  threshold: number;
  message: string;
}

function pct(curr: number, prev: number): number {
  return ((curr - prev) / prev) * 100;
}

export function detectAnomalies(series: PeriodPoint[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (let i = 1; i < series.length; i++) {
    const c = series[i];
    const p = series[i - 1];
    if (c.electricityKWh && p.electricityKWh) {
      const ch = pct(c.electricityKWh, p.electricityKWh);
      if (ch > ANOMALY_THRESHOLDS.electricityIncreasePct)
        out.push({ periodKey: c.key, metric: 'Electricity consumption', changePct: round(ch), threshold: ANOMALY_THRESHOLDS.electricityIncreasePct, message: `Electricity use rose ${round(ch)}% versus ${p.key}.` });
    }
    if (c.dieselKg && p.dieselKg && c.productionT && p.productionT) {
      const ch = pct(c.dieselKg / c.productionT, p.dieselKg / p.productionT);
      if (ch > ANOMALY_THRESHOLDS.dieselPerTonneIncreasePct)
        out.push({ periodKey: c.key, metric: 'Diesel per tonne of output', changePct: round(ch), threshold: ANOMALY_THRESHOLDS.dieselPerTonneIncreasePct, message: `Diesel use per tonne rose ${round(ch)}% versus ${p.key}.` });
    }
    if (c.intensity && p.intensity) {
      const ch = pct(c.intensity, p.intensity);
      if (ch > ANOMALY_THRESHOLDS.intensityIncreasePct)
        out.push({ periodKey: c.key, metric: 'Emissions intensity', changePct: round(ch), threshold: ANOMALY_THRESHOLDS.intensityIncreasePct, message: `Emissions per tonne rose ${round(ch)}% versus ${p.key}.` });
    }
    if (c.productionT && p.productionT && c.electricityKWh && p.electricityKWh) {
      const ch = pct(c.productionT / c.electricityKWh, p.productionT / p.electricityKWh);
      if (ch < -ANOMALY_THRESHOLDS.productionPerKWhDropPct)
        out.push({ periodKey: c.key, metric: 'Output per kWh', changePct: round(ch), threshold: -ANOMALY_THRESHOLDS.productionPerKWhDropPct, message: `Output per kWh fell ${Math.abs(round(ch))}% versus ${p.key}.` });
    }
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
