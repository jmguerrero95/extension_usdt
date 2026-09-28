import { Schema, model, models, type Model } from 'mongoose';

export interface OutboxJobDocument {
  jobType: string;
  orderId: string | null;
  providerEventId?: string | null;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED' | 'CANCELED';
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy?: string | null;
  leaderOwnerId?: string | null;
  leaderFencingToken?: number | null;
  recoveryGeneration?: number | null;
  createdBootId?: string | null;
  claimedBootId?: string | null;
  lastBootId?: string | null;
  interruptedAt?: Date | null;
  interruptedByBootId?: string | null;
  interruptionReason?: string | null;
  purgeAt?: Date | null;
  executionCount?: number;
  consecutiveFailureCount?: number;
  lastRunAt?: Date | null;
  lastSuccessAt?: Date | null;
  manualReviewAppliedAt?: Date | null;
  manualReviewOrderId?: string | null;
  quarantineStatus?: 'PENDING' | 'APPLIED' | 'FAILED' | null;
  quarantineLastError?: string | null;
  cancelRequestedAt?: Date | null;
  cancelReason?: string | null;
  cancelRequestedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const outboxJobSchema = new Schema<OutboxJobDocument>(
  {
    jobType: { type: String, required: true },
    orderId: { type: String, default: null },
    providerEventId: { type: String, default: null, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELED'],
      default: 'PENDING',
      index: true,
    },
    runAt: { type: Date, required: true, index: true },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 5 },
    lastError: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null, index: true },
    leaderOwnerId: { type: String, default: null, index: true },
    leaderFencingToken: { type: Number, default: null, index: true },
    recoveryGeneration: { type: Number, default: null, index: true },
    createdBootId: { type: String, default: null, index: true },
    claimedBootId: { type: String, default: null, index: true },
    lastBootId: { type: String, default: null, index: true },
    interruptedAt: { type: Date, default: null },
    interruptedByBootId: { type: String, default: null },
    interruptionReason: { type: String, default: null },
    purgeAt: { type: Date, default: null },
    executionCount: { type: Number, default: 0 },
    consecutiveFailureCount: { type: Number, default: 0 },
    lastRunAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    manualReviewAppliedAt: { type: Date, default: null },
    manualReviewOrderId: { type: String, default: null },
    quarantineStatus: {
      type: String,
      enum: ['PENDING', 'APPLIED', 'FAILED', null],
      default: null,
      index: true,
    },
    quarantineLastError: { type: String, default: null },
    cancelRequestedAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    cancelRequestedBy: { type: String, default: null },
  },
  {
    collection: 'outbox_jobs',
    timestamps: true,
    versionKey: false,
  },
);

outboxJobSchema.index({ status: 1, runAt: 1 });
outboxJobSchema.index({ jobType: 1, status: 1, updatedAt: 1, _id: 1 });
outboxJobSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
outboxJobSchema.index(
  { orderId: 1, jobType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderId: { $type: 'string' },
      status: { $in: ['PENDING', 'RUNNING'] },
    },
  },
);
outboxJobSchema.index(
  { providerEventId: 1, jobType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      providerEventId: { $type: 'string' },
      status: { $in: ['PENDING', 'RUNNING'] },
    },
  },
);

export const OutboxJobModel: Model<OutboxJobDocument> =
  (models['OutboxJob'] as Model<OutboxJobDocument> | undefined) ??
  model<OutboxJobDocument>('OutboxJob', outboxJobSchema);
