import Decimal from 'decimal.js';
import type { FactorSet, MeasurementType } from './types';

export class UnitError extends Error {}

/** Normalises unit spellings coming from documents and users. */
export function normaliseUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/\.$/, '');
  const map: Record<string, string> = {
    kwh: 'kWh', 'kw-h': 'kWh', 'kw·h': 'kWh', units: 'kWh', unit: 'kWh',
    mwh: 'MWh',
    l: 'L', ltr: 'L', ltrs: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L',
    kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
    t: 't', ton: 't', tons: 't', tonne: 't', tonnes: 't', mt: 't',
  };
  return map[u] ?? raw.trim();
}

/**
 * Converts a confirmed quantity into the canonical unit for its measurement type.
 * ELECTRICITY -> kWh, FUEL -> kg (via documented density for litres), PRODUCTION -> t.
 */
export function toCanonical(
  type: MeasurementType,
  quantity: number,
  rawUnit: string,
  factors: Pick<FactorSet, 'diesel'> | null,
): { quantity: number; unit: 'kWh' | 'kg' | 't' } {
  const unit = normaliseUnit(rawUnit);
  const q = new Decimal(quantity);
  if (!q.isFinite()) throw new UnitError('Quantity is not a finite number');
  switch (type) {
    case 'ELECTRICITY':
      if (unit === 'kWh') return { quantity: q.toNumber(), unit: 'kWh' };
      if (unit === 'MWh') return { quantity: q.mul(1000).toNumber(), unit: 'kWh' };
      throw new UnitError(`Electricity unit "${rawUnit}" is not supported (use kWh or MWh)`);
    case 'FUEL':
      if (unit === 'kg') return { quantity: q.toNumber(), unit: 'kg' };
      if (unit === 't') return { quantity: q.mul(1000).toNumber(), unit: 'kg' };
      if (unit === 'L') {
        if (!factors) throw new UnitError('A factor set with fuel density is required to convert litres');
        return { quantity: q.mul(factors.diesel.densityKgPerL).toNumber(), unit: 'kg' };
      }
      throw new UnitError(`Fuel unit "${rawUnit}" is not supported (use L, kg or t)`);
    case 'PRODUCTION':
      if (unit === 't') return { quantity: q.toNumber(), unit: 't' };
      if (unit === 'kg') return { quantity: q.div(1000).toNumber(), unit: 't' };
      throw new UnitError(`Production unit "${rawUnit}" is not supported (use t or kg)`);
  }
}

export function isSupportedUnit(type: MeasurementType, rawUnit: string | null): boolean {
  const unit = normaliseUnit(rawUnit);
  if (type === 'ELECTRICITY') return unit === 'kWh' || unit === 'MWh';
  if (type === 'FUEL') return unit === 'L' || unit === 'kg' || unit === 't';
  return unit === 't' || unit === 'kg';
}
