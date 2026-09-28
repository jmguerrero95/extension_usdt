import { describe, expect, it } from 'vitest';

import { normalizeEstimatedEnergy, selectEnergyRequestAmount } from '../../domain/services/energy-selection.service';

describe('energy-selection.service', () => {
  it('aplica safety multiplier y clamps', () => {
    expect(normalizeEstimatedEnergy(50000, 1.2, 65000, 120000)).toBe(65000);
    expect(normalizeEstimatedEnergy(200000, 1.2, 65000, 120000)).toBe(120000);
    expect(normalizeEstimatedEnergy(70000, 1.2, 65000, 120000)).toBe(84000);
  });

  it('usa fallback fijo cuando falla estimated y esta habilitado', () => {
    const result = selectEnergyRequestAmount({
      mode: 'estimated',
      estimatedEnergyAmount: null,
      fixedAmount: 80000,
      safetyMultiplier: 1.2,
      minFloor: 65000,
      maxCap: 120000,
      allowFixedFallback: true,
    });

    expect(result.modeUsed).toBe('fixed');
    expect(result.usedFallback).toBe(true);
    expect(result.requestedEnergyAmount).toBe(80000);
  });

  it('permite operar BUY directamente en modo fixed', () => {
    const result = selectEnergyRequestAmount({
      mode: 'fixed',
      estimatedEnergyAmount: null,
      fixedAmount: 90000,
      safetyMultiplier: 1.2,
      minFloor: 65000,
      maxCap: 120000,
      allowFixedFallback: true,
    });

    expect(result.modeUsed).toBe('fixed');
    expect(result.requestedEnergyAmount).toBe(90000);
  });
});
