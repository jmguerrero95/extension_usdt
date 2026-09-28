import { Schema, model, models, type Model } from 'mongoose';

export interface DistributedLockDocument {
  lockKey: string;
  leaseId?: string | null;
  ownerId: string | null;
  bootId?: string | null;
  acquiredAt?: Date | null;
  heartbeatAt?: Date | null;
  releasedAt?: Date | null;
  expiresAt: Date;
  fencingToken?: number;
  createdAt: Date;
}

const distributedLockSchema = new Schema<DistributedLockDocument>(
  {
    lockKey: { type: String, required: true, unique: true, index: true },
    leaseId: { type: String, default: null, index: true },
    ownerId: { type: String, default: null },
    bootId: { type: String, default: null },
    acquiredAt: { type: Date, default: null },
    heartbeatAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    fencingToken: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now },
  },
  {
    collection: 'distributed_locks',
    versionKey: false,
  },
);

distributedLockSchema.index({ expiresAt: 1 });

export const DistributedLockModel: Model<DistributedLockDocument> =
  (models['DistributedLock'] as Model<DistributedLockDocument> | undefined) ??
  model<DistributedLockDocument>('DistributedLock', distributedLockSchema);
