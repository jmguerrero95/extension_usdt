import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { OutboxJobModel } from '../../infrastructure/db/models/outbox-job.model';
import { closeTestApp, clearDatabase, createTestApp } from '../test-helpers';

describe('storage maintenance integration', () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  const seedScheduledCleanupJobs = async () => {
    const staleDate = new Date(Date.now() - 12 * 24 * 60 * 60 * 1_000);
    const recentDate = new Date(Date.now() - 60 * 60 * 1_000);

    await OutboxJobModel.collection.insertMany([
      ...Array.from({ length: 5 }, (_, index) => ({
        jobType: 'RECONCILE_ORDER',
        orderId: `scheduled-old-${index}`,
        payload: { source: 'scheduled-old' },
        status: 'COMPLETED',
        runAt: staleDate,
        attempts: 1,
        maxAttempts: 5,
        lastError: null,
        lockedAt: null,
        createdAt: staleDate,
        updatedAt: staleDate,
      })),
      {
        jobType: 'RECONCILE_ORDER',
        orderId: 'scheduled-recent',
        payload: { source: 'scheduled-recent' },
        status: 'COMPLETED',
        runAt: recentDate,
        attempts: 1,
        maxAttempts: 5,
        lastError: null,
        lockedAt: null,
        createdAt: recentDate,
        updatedAt: recentDate,
      },
    ]);
  };

  beforeAll(async () => {
    testApp = await createTestApp({
      storageCleanup: {
        enabled: true,
        hour: 3,
        reconcileDays: 7,
        batchSize: 2,
        maxBatches: 2,
      },
    });
  });

  beforeEach(async () => {
    await clearDatabase();
    await testApp.services.panelAuthService.bootstrapAdminIfNeeded();
  });

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  it('analiza almacenamiento sin mutar datos', async () => {
    await seedScheduledCleanupJobs();

    const commandSpy = vi
      .spyOn(OutboxJobModel.db.db as NonNullable<typeof OutboxJobModel.db.db>, 'command')
      .mockResolvedValue({
        count: 6,
        size: 2048,
        storageSize: 4096,
        totalIndexSize: 1024,
      });

    const result = await testApp.services.storageMaintenanceService.analyzeStorage();

    expect(result.outboxJobs.total).toBe(6);
    expect(result.outboxJobs.byJobType['RECONCILE_ORDER']).toBe(6);
    expect(result.outboxJobs.byStatus['COMPLETED']).toBe(6);
    expect(result.outboxJobs.reconcileCompletedTotal).toBe(6);
    expect(result.outboxJobs.reconcileCompletedCandidates.olderThan7Days).toBe(5);
    expect(result.configuredCleanup.estimatedEligible).toBe(5);
    expect(result.configuredCleanup.estimatedRemaining).toBe(1);
    expect(result.outboxJobs.approximateSizes.totalIndexSizeBytes).toBe(1024);
    expect(await OutboxJobModel.countDocuments({ jobType: 'RECONCILE_ORDER' })).toBe(6);

    commandSpy.mockRestore();
  });

  it('soporta dry-run sin borrar historicos elegibles', async () => {
    await seedScheduledCleanupJobs();

    const result = await testApp.services.storageMaintenanceService.cleanupStorage({
      confirmation: false,
      dryRun: true,
      olderThanDays: 7,
      batchSize: 2,
      maxBatches: 1,
      collections: ['outbox_reconcile'],
    });

    expect(result.eligibleBefore).toBe(5);
    expect(result.deleted.outboxReconcile).toBe(0);
    expect(result.remaining.outboxReconcile).toBe(5);
    expect(result.hasMore).toBe(true);
    expect(await OutboxJobModel.countDocuments({ jobType: 'RECONCILE_ORDER' })).toBe(6);
  });

  it('usa el mismo servicio para la limpieza automatica', async () => {
    await seedScheduledCleanupJobs();

    const result = await testApp.services.storageMaintenanceService.runAutomaticCleanupNow();

    expect(result.skipped).toBe(false);
    expect(result.result?.eligibleBefore).toBe(5);
    expect(result.result?.deleted.outboxReconcile).toBe(4);
    expect(result.result?.remaining.outboxReconcile).toBe(1);
    expect(result.result?.hasMore).toBe(true);
    expect(result.result?.batchesProcessed).toBe(2);

    const secondRun = await testApp.services.storageMaintenanceService.runAutomaticCleanupNow();

    expect(secondRun.skipped).toBe(false);
    expect(secondRun.result?.eligibleBefore).toBe(1);
    expect(secondRun.result?.deleted.outboxReconcile).toBe(1);
    expect(secondRun.result?.remaining.outboxReconcile).toBe(0);
    expect(secondRun.result?.hasMore).toBe(false);

    const thirdRun = await testApp.services.storageMaintenanceService.runAutomaticCleanupNow();

    expect(thirdRun.skipped).toBe(false);
    expect(thirdRun.result?.eligibleBefore).toBe(0);
    expect(thirdRun.result?.deleted.outboxReconcile).toBe(0);
    expect(
      await OutboxJobModel.countDocuments({
        jobType: 'RECONCILE_ORDER',
        status: 'COMPLETED',
      }),
    ).toBe(1);
  });

  it('evita solapamientos en la limpieza automatica', async () => {
    (testApp.services.storageMaintenanceService as unknown as { cleanupInProgress: boolean }).cleanupInProgress =
      true;

    const result = await testApp.services.storageMaintenanceService.runAutomaticCleanupNow();

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_running');

    (testApp.services.storageMaintenanceService as unknown as { cleanupInProgress: boolean }).cleanupInProgress =
      false;
  });
});
