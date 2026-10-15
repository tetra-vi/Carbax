import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FactorSet } from '../domain/types';
import { AppError, type Deps } from './core';

/** Emission factor sets are global, versioned configuration (factorSets/{id}). Gemini never supplies factors. */
export async function getFactorSet(deps: Deps, id: string): Promise<FactorSet> {
  const f = await deps.store.get<FactorSet>(`factorSets/${id}`);
  if (!f) throw new AppError(500, 'FACTOR_SET_MISSING', `Emission factor set "${id}" is not installed`);
  return f;
}

export async function getActiveFactorSet(deps: Deps): Promise<FactorSet> {
  return getFactorSet(deps, deps.config.activeFactorSetId);
}

export function assertFactorSetUsable(f: FactorSet): void {
  if (f.status === 'RETIRED') throw new AppError(409, 'FACTOR_SET_RETIRED', `Factor set ${f.id} is retired`);
  if (f.electricity.kgCo2ePerKWh === null || !f.electricity.source || f.electricity.year === null) {
    throw new AppError(
      409,
      'FACTOR_NOT_CONFIGURED',
      `The grid electricity emission factor in "${f.id}" is not configured. Add an official, cited value to factor-sets/${f.id}.json and re-run the seed.`,
    );
  }
}

/**
 * Installs factor sets shipped in /factor-sets. A configured set is never overwritten (publish a new
 * id/version instead); an unconfigured set (grid factor still null) is replaced once it is filled in.
 */
export async function installFactorSets(deps: Deps, dir = join(__dirname, '..', '..', 'factor-sets')): Promise<string[]> {
  const installed: string[] = [];
  if (!existsSync(dir)) return installed;
  const { readdirSync } = await import('node:fs');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const f = JSON.parse(readFileSync(join(dir, file), 'utf8')) as FactorSet;
    const existing = await deps.store.get<FactorSet>(`factorSets/${f.id}`);
    if (!existing || (existing.electricity.kgCo2ePerKWh === null && f.electricity.kgCo2ePerKWh !== null)) {
      await deps.store.set(`factorSets/${f.id}`, f);
      installed.push(f.id);
    }
  }
  return installed;
}
