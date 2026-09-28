import { randomUUID } from 'node:crypto';
import { MongoServerError } from 'mongodb';

import { DistributedLockModel } from '../db/models/distributed-lock.model';

export interface LeaderLock {
  lockKey: string;
  leaseId: string;
  ownerId: string;
  bootId: string;
  fencingToken: number;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
}

export interface DistributedLease {
  lockKey: string;
  leaseId: string;
  ownerId: string;
  bootId: string;
  fencingToken: number;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
}

export class MongoLockService {
  public constructor(private readonly ttlSec: number) {}

  public async acquire(lockKey: string, ownerId: string = randomUUID()): Promise<string | null> {
    const lease = await this.acquireLease(lockKey, ownerId);
    return lease?.ownerId ?? null;
  }

  public async acquireLease(
    lockKey: string,
    ownerId: string = randomUUID(),
  ): Promise<DistributedLease | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSec * 1_000);
    const leaseId = randomUUID();

    try {
      const document = await DistributedLockModel.create({
        lockKey,
        leaseId,
        ownerId,
        bootId: ownerId,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt,
        fencingToken: 1,
        createdAt: now,
      });

      return {
        lockKey,
        leaseId,
        ownerId,
        bootId: ownerId,
        fencingToken: document.fencingToken ?? 1,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt,
      };
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        return null;
      }

      const document = await DistributedLockModel.findOneAndUpdate(
        {
          lockKey,
          $or: [{ expiresAt: { $lte: now } }, { ownerId: null }],
        },
        {
          $set: {
            leaseId,
            ownerId,
            bootId: ownerId,
            acquiredAt: now,
            heartbeatAt: now,
            expiresAt,
          },
          $inc: {
            fencingToken: 1,
          },
        },
        {
          returnDocument: 'after',
        },
      ).exec();

      if (!document || document.ownerId !== ownerId || !document.leaseId) {
        return null;
      }

      return {
        lockKey: document.lockKey,
        leaseId: document.leaseId,
        ownerId,
        bootId: document.bootId ?? ownerId,
        fencingToken: document.fencingToken ?? 1,
        acquiredAt: document.acquiredAt ?? now,
        heartbeatAt: document.heartbeatAt ?? now,
        expiresAt: document.expiresAt,
      };
    }
  }

  public async release(lockKey: string, ownerId: string): Promise<void> {
    const lease = await DistributedLockModel.findOne({
      lockKey,
      ownerId,
      leaseId: { $type: 'string' },
    })
      .sort({ acquiredAt: -1, createdAt: -1 })
      .lean()
      .exec();

    if (!lease?.leaseId) {
      return;
    }

    await this.releaseLease({
      lockKey: lease.lockKey,
      leaseId: lease.leaseId,
      ownerId,
      bootId: lease.bootId ?? ownerId,
      fencingToken: lease.fencingToken ?? 1,
      acquiredAt: lease.acquiredAt ?? lease.createdAt,
      heartbeatAt: lease.heartbeatAt ?? lease.createdAt,
      expiresAt: lease.expiresAt,
    });
  }

  public async releaseLease(lease: DistributedLease): Promise<void> {
    const now = new Date();
    if (lease.lockKey === 'scheduler:leader') {
      await DistributedLockModel.updateOne(
        {
          lockKey: lease.lockKey,
          leaseId: lease.leaseId,
          ownerId: lease.ownerId,
          bootId: lease.bootId,
          fencingToken: lease.fencingToken,
        },
        {
          $set: {
            leaseId: null,
            ownerId: null,
            bootId: null,
            releasedAt: now,
            expiresAt: now,
            heartbeatAt: now,
          },
        },
      ).exec();
      return;
    }

    await DistributedLockModel.deleteOne({
      lockKey: lease.lockKey,
      leaseId: lease.leaseId,
      ownerId: lease.ownerId,
      bootId: lease.bootId,
      fencingToken: lease.fencingToken,
    }).exec();
  }

  public async releaseLeader(lease: LeaderLock): Promise<void> {
    const now = new Date();
    await DistributedLockModel.updateOne(
      {
        lockKey: lease.lockKey,
        leaseId: lease.leaseId,
        ownerId: lease.ownerId,
        bootId: lease.bootId,
        fencingToken: lease.fencingToken,
      },
      {
        $set: {
          leaseId: null,
          ownerId: null,
          bootId: null,
          releasedAt: now,
          expiresAt: now,
          heartbeatAt: now,
        },
      },
    ).exec();
  }

  public async acquireLeader(lockKey: string, bootId: string): Promise<LeaderLock | null> {
    const ownerId = bootId;
    const leaseId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSec * 1_000);

    try {
      const document = await DistributedLockModel.create({
        lockKey,
        leaseId,
        ownerId,
        bootId,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt,
        fencingToken: 1,
        createdAt: now,
      });

      return {
        lockKey,
        leaseId,
        ownerId,
        bootId,
        fencingToken: document.fencingToken ?? 1,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt,
      };
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        return null;
      }

      const document = await DistributedLockModel.findOneAndUpdate(
        {
          lockKey,
          $or: [{ expiresAt: { $lte: now } }, { ownerId: null }],
        },
        {
          $set: {
            leaseId,
            ownerId,
            bootId,
            acquiredAt: now,
            heartbeatAt: now,
            expiresAt,
          },
          $inc: {
            fencingToken: 1,
          },
        },
        { returnDocument: 'after' },
      ).exec();

      if (!document || document.ownerId !== ownerId) {
        return null;
      }

      return {
        lockKey,
        leaseId: document.leaseId ?? leaseId,
        ownerId,
        bootId,
        fencingToken: document.fencingToken ?? 1,
        acquiredAt: document.acquiredAt ?? now,
        heartbeatAt: document.heartbeatAt ?? now,
        expiresAt: document.expiresAt,
      };
    }
  }

  public async getLeader(lockKey: string): Promise<LeaderLock | null> {
    const document = await DistributedLockModel.findOne({
      lockKey,
      expiresAt: { $gt: new Date() },
    }).exec();

    if (!document || !document.ownerId) {
      return null;
    }

    return {
      ownerId: document.ownerId,
      lockKey: document.lockKey,
      leaseId: document.leaseId ?? '',
      bootId: document.bootId ?? document.ownerId,
      fencingToken: document.fencingToken ?? 1,
      acquiredAt: document.acquiredAt ?? document.createdAt,
      heartbeatAt: document.heartbeatAt ?? document.createdAt,
      expiresAt: document.expiresAt,
    };
  }

  public async renew(lockKey: string, ownerId: string): Promise<boolean> {
    const lease = await DistributedLockModel.findOne({
      lockKey,
      ownerId,
      leaseId: { $type: 'string' },
      expiresAt: { $gt: new Date() },
    })
      .sort({ acquiredAt: -1, createdAt: -1 })
      .lean()
      .exec();

    if (!lease?.leaseId) {
      return false;
    }

    const renewed = await this.renewLease({
      lockKey: lease.lockKey,
      leaseId: lease.leaseId,
      ownerId,
      bootId: lease.bootId ?? ownerId,
      fencingToken: lease.fencingToken ?? 1,
      acquiredAt: lease.acquiredAt ?? lease.createdAt,
      heartbeatAt: lease.heartbeatAt ?? lease.createdAt,
      expiresAt: lease.expiresAt,
    });

    return renewed !== null;
  }

  public async renewLease(lease: DistributedLease): Promise<DistributedLease | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSec * 1_000);
    const document = await DistributedLockModel.findOneAndUpdate(
      {
        lockKey: lease.lockKey,
        leaseId: lease.leaseId,
        ownerId: lease.ownerId,
        bootId: lease.bootId,
        fencingToken: lease.fencingToken,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          heartbeatAt: now,
          expiresAt,
        },
      },
      {
        returnDocument: 'after',
      },
    ).exec();

    if (!document || !document.ownerId || !document.leaseId || !document.bootId) {
      return null;
    }

    return {
      lockKey: document.lockKey,
      leaseId: document.leaseId,
      ownerId: document.ownerId,
      bootId: document.bootId,
      fencingToken: document.fencingToken ?? lease.fencingToken,
      acquiredAt: document.acquiredAt ?? lease.acquiredAt,
      heartbeatAt: document.heartbeatAt ?? now,
      expiresAt: document.expiresAt,
    };
  }

  public async renewLeader(lease: LeaderLock): Promise<LeaderLock | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSec * 1_000);
    const document = await DistributedLockModel.findOneAndUpdate(
      {
        lockKey: lease.lockKey,
        leaseId: lease.leaseId,
        ownerId: lease.ownerId,
        bootId: lease.bootId,
        fencingToken: lease.fencingToken,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          heartbeatAt: now,
          expiresAt,
        },
      },
      { returnDocument: 'after' },
    ).exec();

    if (!document || !document.ownerId || !document.leaseId || !document.bootId) {
      return null;
    }

    return {
      lockKey: document.lockKey,
      leaseId: document.leaseId,
      ownerId: document.ownerId,
      bootId: document.bootId,
      fencingToken: document.fencingToken ?? lease.fencingToken,
      acquiredAt: document.acquiredAt ?? lease.acquiredAt,
      heartbeatAt: document.heartbeatAt ?? now,
      expiresAt: document.expiresAt,
    };
  }
}
