import { Schema, model, models, type Model } from 'mongoose';

export interface EnergyRequestDocument {
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

const energyRequestSchema = new Schema<EnergyRequestDocument>(
  {
    orderId: { type: String, required: true, index: true },
    provider: { type: String, required: true, enum: ['itrx'] },
    mode: { type: String, required: true, enum: ['estimated', 'fixed'] },
    energyContext: { type: String, required: true, enum: ['SELL_DEPOSIT', 'BUY_SENDER'] },
    requestKind: {
      type: String,
      enum: ['COLLECTION', 'SMART_DELEGATE', 'ONE_OFF', 'AVAILABLE_BALANCE', null],
      default: null,
      index: true,
    },
    estimatedEnergyAmount: { type: Number, default: null },
    requestedEnergyAmount: { type: Number, required: true },
    safetyMultiplier: { type: Number, required: true },
    period: { type: Schema.Types.Mixed, required: true },
    receiveAddress: { type: String, required: true, index: true },
    callbackUrl: { type: String, default: null },
    providerRequestRaw: { type: Schema.Types.Mixed, default: null },
    providerResponseRaw: { type: Schema.Types.Mixed, default: null },
    providerSerial: { type: String, default: null },
    status: { type: String, required: true, index: true },
    signatureValid: { type: Boolean, default: null },
    confirmedAt: { type: Date, default: null },
    outcomeResolution: {
      type: String,
      enum: ['CONFIRMED_EXECUTED', 'CONFIRMED_NOT_EXECUTED', 'RESOLVED_MANUALLY', 'CANCELED_BY_PROVIDER', null],
      default: null,
    },
    outcomeResolvedAt: { type: Date, default: null },
    outcomeResolvedBy: { type: String, default: null },
    outcomeResolutionReason: { type: String, default: null },
    outcomeResolutionReference: { type: String, default: null },
  },
  {
    collection: 'energy_requests',
    timestamps: true,
    versionKey: false,
  },
);

energyRequestSchema.index({ createdAt: -1 });
energyRequestSchema.index({ receiveAddress: 1, energyContext: 1, status: 1, confirmedAt: -1 });

export const EnergyRequestModel: Model<EnergyRequestDocument> =
  (models['EnergyRequest'] as Model<EnergyRequestDocument> | undefined) ??
  model<EnergyRequestDocument>('EnergyRequest', energyRequestSchema);
