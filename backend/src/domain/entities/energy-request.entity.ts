export interface EnergyRequest {
  id?: string;
  orderId: string;
  provider: 'itrx';
  mode: 'estimated' | 'fixed';
  energyContext: 'SELL_DEPOSIT' | 'BUY_SENDER';
  requestKind?: 'COLLECTION' | 'SMART_DELEGATE' | 'ONE_OFF' | 'AVAILABLE_BALANCE' | null;
  estimatedEnergyAmount: number | null;
  requestedEnergyAmount: number;
  safetyMultiplier: number;
  period: string | number;
  receiveAddress: string;
  callbackUrl: string | null;
  providerRequestRaw: Record<string, unknown> | null;
  providerResponseRaw: Record<string, unknown> | null;
  providerSerial: string | null;
  status: string;
  signatureValid: boolean | null;
  confirmedAt: Date | null;
  outcomeResolution?: 'CONFIRMED_EXECUTED' | 'CONFIRMED_NOT_EXECUTED' | 'RESOLVED_MANUALLY' | 'CANCELED_BY_PROVIDER' | null;
  outcomeResolvedAt?: Date | null;
  outcomeResolvedBy?: string | null;
  outcomeResolutionReason?: string | null;
  outcomeResolutionReference?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
