import { Schema, model, models, type Model } from 'mongoose';

export interface ProviderEventDocument {
  provider: 'cryptocurrencyapi' | 'itrx';
  eventType: string;
  eventKey: string;
  orderId: string | null;
  headers: Record<string, string | string[] | undefined>;
  payload: Record<string, unknown>;
  rawBody: string | null;
  signatureValid: boolean | null;
  processed: boolean;
  processedAt: Date | null;
  error: Record<string, unknown> | null;
  purgeAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const providerEventSchema = new Schema<ProviderEventDocument>(
  {
    provider: { type: String, required: true, enum: ['cryptocurrencyapi', 'itrx'] },
    eventType: { type: String, required: true },
    eventKey: { type: String, required: true, unique: true, index: true },
    orderId: { type: String, default: null, index: true },
    headers: { type: Schema.Types.Mixed, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    rawBody: { type: String, default: null },
    signatureValid: { type: Boolean, default: null },
    processed: { type: Boolean, required: true, default: false },
    processedAt: { type: Date, default: null },
    error: { type: Schema.Types.Mixed, default: null },
    purgeAt: { type: Date, default: null },
  },
  {
    collection: 'provider_events',
    timestamps: true,
    versionKey: false,
  },
);

providerEventSchema.index({ provider: 1, createdAt: -1 });
providerEventSchema.index({ orderId: 1, provider: 1 });
providerEventSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const ProviderEventModel: Model<ProviderEventDocument> =
  (models['ProviderEvent'] as Model<ProviderEventDocument> | undefined) ??
  model<ProviderEventDocument>('ProviderEvent', providerEventSchema);
