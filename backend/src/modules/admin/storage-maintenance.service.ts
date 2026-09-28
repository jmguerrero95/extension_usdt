import { AppError } from '../../app/errors/app-error';
import type { AppConfig } from '../../app/config/env';
import { OutboxJobModel } from '../../infrastructure/db/models/outbox-job.model';
import { JOB_TYPES } from '../../shared/constants/job-types';

export const STORAGE_MAINTENANCE_COLLECTIONS = ['outbox_reconcile'] as const;

export type StorageMaintenanceCollection = (typeof STORAGE_MAINTENANCE_COLLECTIONS)[number];

export interface StorageCleanupInput {
  confirmation: boolean;
  dryRun: boolean;
  olderThanDays: number;
  batchSize: number;
  maxBatches: number;
  collections: StorageMaintenanceCollection[];
}

export interface StorageCleanupResult {
  dryRun: boolean;
  cutoff: string;
  eligibleBefore: number;
  deleted: {
    outboxReconcile: number;
  };
  remaining: {
    outboxReconcile: number;
  };
  hasMore: boolean;
  batchesProcessed: number;
  durationMs: number;
}

export interface StorageAnalyzeResult {
  outboxJobs: {
    total: number;
    byJobType: Record<string, number>;
    byStatus: Record<string, number>;
    reconcileCompletedTotal: number;
    reconcileCompletedCandidates: {
      olderThan1Days: number;
      olderThan7Days: number;
      olderThan30Days: number;
      olderThan90Days: number;
    };
    approximateSizes: {
      count: number | null;
      sizeBytes: number | null;
      storageSizeBytes: number | null;
      totalIndexSizeBytes: number | null;
    };
  };
  configuredCleanup: {
    enabled: boolean;
    hour: number;
    olderThanDays: number;
    batchSize: number;
    maxBatches: number;
    estimatedEligible: number;
    estimatedRemaining: number;
  };
}

interface AutomaticCleanupResult {
  skipped: boolean;
  reason?: 'disabled' | 'already_running';
  result?: StorageCleanupResult;
}

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

export class StorageMaintenanceService {
  private automaticCleanupTimer: NodeJS.Timeout | null = null;
  private cleanupInProgress = false;

  public constructor(private readonly config: AppConfig) {}

  public async analyzeStorage(): Promise<StorageAnalyzeResult> {
    const now = new Date();
    const defaultCutoff = this.buildCutoff(now, this.config.storageCleanup.reconcileDays);
    const db = OutboxJobModel.db.db;

    if (!db) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        statusCode: 500,
        message: 'MongoDB no esta conectado.',
      });
    }

    const [
      total,
      byJobTypeRows,
      byStatusRows,
      reconcileCompletedTotal,
      olderThan1Days,
      olderThan7Days,
      olderThan30Days,
      olderThan90Days,
      defaultEligible,
      stats,
    ] = await Promise.all([
      OutboxJobModel.countDocuments({}),
      OutboxJobModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$jobType', count: { $sum: 1 } } },
      ]),
      OutboxJobModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      OutboxJobModel.countDocuments({
        jobType: JOB_TYPES.RECONCILE_ORDER,
        status: 'COMPLETED',
      }),
      OutboxJobModel.countDocuments(this.buildReconcileCleanupFilter(this.buildCutoff(now, 1))),
      OutboxJobModel.countDocuments(this.buildReconcileCleanupFilter(this.buildCutoff(now, 7))),
      OutboxJobModel.countDocuments(this.buildReconcileCleanupFilter(this.buildCutoff(now, 30))),
      OutboxJobModel.countDocuments(this.buildReconcileCleanupFilter(this.buildCutoff(now, 90))),
      OutboxJobModel.countDocuments(this.buildReconcileCleanupFilter(defaultCutoff)),
      db.command({ collStats: 'outbox_jobs' }).catch(() => null),
    ]);

    return {
      outboxJobs: {
        total,
        byJobType: this.toCountRecord(byJobTypeRows),
        byStatus: this.toCountRecord(byStatusRows),
        reconcileCompletedTotal,
        reconcileCompletedCandidates: {
          olderThan1Days,
          olderThan7Days,
          olderThan30Days,
          olderThan90Days,
        },
        approximateSizes: {
          count: stats ? asNumber(stats['count']) : null,
          sizeBytes: stats ? asNumber(stats['size']) : null,
          storageSizeBytes: stats ? asNumber(stats['storageSize']) : null,
          totalIndexSizeBytes: stats ? asNumber(stats['totalIndexSize']) : null,
        },
      },
      configuredCleanup: {
        enabled: this.config.storageCleanup.enabled,
        hour: this.config.storageCleanup.hour,
        olderThanDays: this.config.storageCleanup.reconcileDays,
        batchSize: this.config.storageCleanup.batchSize,
        maxBatches: this.config.storageCleanup.maxBatches,
        estimatedEligible: defaultEligible,
        estimatedRemaining: Math.max(reconcileCompletedTotal - defaultEligible, 0),
      },
    };
  }

  public async cleanupStorage(input: StorageCleanupInput): Promise<StorageCleanupResult> {
    if (!input.dryRun && input.confirmation !== true) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'La confirmacion explicita es obligatoria para aplicar la limpieza.',
      });
    }

    return this.executeCleanup(input, { conflictOnOverlap: true });
  }

  public startAutomaticCleanup(): void {
    if (!this.config.storageCleanup.enabled || this.automaticCleanupTimer) {
      return;
    }

    this.scheduleNextAutomaticCleanup();
  }

  public stopAutomaticCleanup(): void {
    if (this.automaticCleanupTimer) {
      clearTimeout(this.automaticCleanupTimer);
      this.automaticCleanupTimer = null;
    }
  }

  public async runAutomaticCleanupNow(): Promise<AutomaticCleanupResult> {
    if (!this.config.storageCleanup.enabled) {
      return {
        skipped: true,
        reason: 'disabled',
      };
    }

    if (this.cleanupInProgress) {
      return {
        skipped: true,
        reason: 'already_running',
      };
    }

    const result = await this.executeCleanup(
      {
        confirmation: true,
        dryRun: false,
        olderThanDays: this.config.storageCleanup.reconcileDays,
        batchSize: this.config.storageCleanup.batchSize,
        maxBatches: this.config.storageCleanup.maxBatches,
        collections: ['outbox_reconcile'],
      },
      { conflictOnOverlap: false },
    );

    return {
      skipped: false,
      result,
    };
  }

  private async executeCleanup(
    input: StorageCleanupInput,
    options: { conflictOnOverlap: boolean },
  ): Promise<StorageCleanupResult> {
    if (this.cleanupInProgress) {
      if (options.conflictOnOverlap) {
        throw new AppError({
          code: 'LOCK_NOT_ACQUIRED',
          statusCode: 409,
          message: 'Ya hay una limpieza de almacenamiento en ejecucion.',
        });
      }

      throw new AppError({
        code: 'INTERNAL_ERROR',
        statusCode: 500,
        message: 'La limpieza ya se encuentra en ejecucion.',
      });
    }

    this.cleanupInProgress = true;
    const startedAt = Date.now();
    const cutoff = this.buildCutoff(new Date(), input.olderThanDays);
    const includesOutboxReconcile = input.collections.includes('outbox_reconcile');

    try {
      const outboxFilter = this.buildReconcileCleanupFilter(cutoff);
      const eligibleBefore = includesOutboxReconcile
        ? await OutboxJobModel.countDocuments(outboxFilter)
        : 0;

      let deletedOutboxReconcile = 0;
      let batchesProcessed = 0;

      if (!input.dryRun && includesOutboxReconcile) {
        for (let batchIndex = 0; batchIndex < input.maxBatches; batchIndex += 1) {
          const batch = await OutboxJobModel.find(outboxFilter)
            .sort({ _id: 1 })
            .limit(input.batchSize)
            .select({ _id: 1 })
            .lean()
            .exec();

          if (batch.length === 0) {
            break;
          }

          const ids = batch.map((document) => document._id);
          const deleteResult = await OutboxJobModel.deleteMany({
            _id: { $in: ids },
            jobType: JOB_TYPES.RECONCILE_ORDER,
            status: 'COMPLETED',
            updatedAt: { $lt: cutoff },
          }).exec();

          deletedOutboxReconcile += deleteResult.deletedCount ?? 0;
          batchesProcessed += 1;

          if (batch.length < input.batchSize) {
            break;
          }
        }
      }

      const remainingOutboxReconcile = includesOutboxReconcile
        ? await OutboxJobModel.countDocuments(outboxFilter)
        : 0;

      return {
        dryRun: input.dryRun,
        cutoff: cutoff.toISOString(),
        eligibleBefore,
        deleted: {
          outboxReconcile: deletedOutboxReconcile,
        },
        remaining: {
          outboxReconcile: remainingOutboxReconcile,
        },
        hasMore: remainingOutboxReconcile > 0,
        batchesProcessed,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.cleanupInProgress = false;
    }
  }

  private scheduleNextAutomaticCleanup(): void {
    const nextRunAt = this.buildNextRunAt(new Date());
    const delayMs = Math.max(nextRunAt.getTime() - Date.now(), 1_000);

    this.automaticCleanupTimer = setTimeout(() => {
      this.automaticCleanupTimer = null;
      void this.runAutomaticCleanupNow().finally(() => {
        if (this.config.storageCleanup.enabled) {
          this.scheduleNextAutomaticCleanup();
        }
      });
    }, delayMs);
  }

  private buildNextRunAt(now: Date): Date {
    const nextRunAt = new Date(now);
    nextRunAt.setMinutes(0, 0, 0);
    nextRunAt.setHours(this.config.storageCleanup.hour);

    if (nextRunAt.getTime() <= now.getTime()) {
      nextRunAt.setDate(nextRunAt.getDate() + 1);
    }

    return nextRunAt;
  }

  private buildCutoff(now: Date, olderThanDays: number): Date {
    return new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1_000);
  }

  private buildReconcileCleanupFilter(cutoff: Date) {
    return {
      jobType: JOB_TYPES.RECONCILE_ORDER,
      status: 'COMPLETED' as const,
      updatedAt: { $lt: cutoff },
    };
  }

  private toCountRecord(rows: Array<{ _id: string; count: number }>): Record<string, number> {
    return rows.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row._id] = row.count;
      return accumulator;
    }, {});
  }
}
