import { DomainError } from '../errors/domain-error';

export interface EnergySelectionInput {
  mode: 'estimated' | 'fixed';
  estimatedEnergyAmount: number | null;
  fixedAmount: number;
  safetyMultiplier: number;
  minFloor: number;
  maxCap: number;
  allowFixedFallback: boolean;
}

export interface EnergySelectionResult {
  modeUsed: 'estimated' | 'fixed';
  estimatedEnergyAmount: number | null;
  requestedEnergyAmount: number;
  usedFallback: boolean;
}

export const normalizeEstimatedEnergy = (
  estimatedEnergyAmount: number,
  safetyMultiplier: number,
  minFloor: number,
  maxCap: number,
): number => {
  const adjusted = Math.ceil(estimatedEnergyAmount * safetyMultiplier);
  return Math.min(Math.max(adjusted, minFloor), maxCap);
};

export const selectEnergyRequestAmount = (
  input: EnergySelectionInput,
): EnergySelectionResult => {
  if (input.mode === 'fixed') {
    return {
      modeUsed: 'fixed',
      estimatedEnergyAmount: null,
      requestedEnergyAmount: input.fixedAmount,
      usedFallback: false,
    };
  }

  if (input.estimatedEnergyAmount !== null) {
    return {
      modeUsed: 'estimated',
      estimatedEnergyAmount: input.estimatedEnergyAmount,
      requestedEnergyAmount: normalizeEstimatedEnergy(
        input.estimatedEnergyAmount,
        input.safetyMultiplier,
        input.minFloor,
        input.maxCap,
      ),
      usedFallback: false,
    };
  }

  if (input.allowFixedFallback) {
    return {
      modeUsed: 'fixed',
      estimatedEnergyAmount: null,
      requestedEnergyAmount: input.fixedAmount,
      usedFallback: true,
    };
  }

  throw new DomainError(
    'ENERGY_REQUEST_FAILED',
    'No fue posible determinar la energía requerida para la orden.',
  );
};
