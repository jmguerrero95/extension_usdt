import { Schema, model, models, type Model } from 'mongoose';

export interface ForwardRequestDocument {
  orderId: string;
  provider: 'cryptocurrencyapi';
  fromAddress: string;
  toAddress: string;
  token: string;
  amount: number;
  providerRequestId: string | null;
  providerResponseRaw: Record<string, unknown> | null;
  txid: string | null;
  status: string;
  requestedAt: Date;
  confirmedAt: Date | null;
  outcomeResolution?: 'CONFIRMED_EXECUTED' | 'CONFIRMED_NOT_EXECUTED' | 'RESOLVED_MANUALLY' | 'CANCELED_BY_PROVIDER' | null;
  outcomeResolvedAt?: Date | null;
  outcomeResolvedBy?: string | null;
  outcomeResolutionReason?: string | null;
  outcomeResolutionReference?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const forwardRequestSchema = new Schema<ForwardRequestDocument>(
  {
    orderId: { type: String, required: true, index: true },
    provider: { type: String, required: true, enum: ['cryptocurrencyapi'] },
    fromAddress: { type: String, required: true },
    toAddress: { type: String, required: true },
    token: { type: String, required: true },
    amount: { type: Number, required: true },
    providerRequestId: { type: String, default: null, index: true },
    providerResponseRaw: { type: Schema.Types.Mixed, default: null },
    txid: { type: String, default: null, index: true },
    status: { type: String, required: true, index: true },
    requestedAt: { type: Date, required: true },
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
    collection: 'forward_requests',
    timestamps: true,
    versionKey: false,
  },
);

forwardRequestSchema.index(
  { orderId: 1, providerRequestId: 1 },
  { unique: true, partialFilterExpression: { providerRequestId: { $type: 'string' } } },
);

forwardRequestSchema.index({ createdAt: -1 });

export const ForwardRequestModel: Model<ForwardRequestDocument> =
  (models['ForwardRequest'] as Model<ForwardRequestDocument> | undefined) ??
  model<ForwardRequestDocument>('ForwardRequest', forwardRequestSchema);
