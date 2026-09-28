import 'dotenv/config';

import { loadConfig } from '../app/config/env';
import { connectToDatabase, disconnectFromDatabase } from '../infrastructure/db/connection';
import { OutboxJobModel } from '../infrastructure/db/models/outbox-job.model';
import { ProviderEventModel } from '../infrastructure/db/models/provider-event.model';

const getArgValue = (name: string): string | null => {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
};

const hasFlag = (name: string): boolean => process.argv.includes(name);

const parsePositiveInt = (value: string | null, fallback: number): number => {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const apply = hasFlag('--apply');
  const dryRun = !apply || hasFlag('--dry-run');
  const olderThanDays = parsePositiveInt(getArgValue('--older-than'), 30);
  const batchSize = parsePositiveInt(getArgValue('--batch-size'), 500);
  const now = new Date();
  const olderThan = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1_000);

  await connectToDatabase(config);

  const outboxFilter = {
    status: 'COMPLETED',
    purgeAt: null,
    updatedAt: { $lt: olderThan },
  };
  const providerEventFilter = {
    processed: true,
    error: null,
    purgeAt: null,
    updatedAt: { $lt: olderThan },
  };

  const [outboxCount, providerEventCount, outboxByStatus, eventByProvider] = await Promise.all([
    OutboxJobModel.countDocuments(outboxFilter),
    ProviderEventModel.countDocuments(providerEventFilter),
    OutboxJobModel.aggregate([
      { $match: outboxFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ProviderEventModel.aggregate([
      { $match: providerEventFilter },
      { $group: { _id: '$provider', count: { $sum: 1 } } },
    ]),
  ]);

  const outboxPurgeAt = new Date(
    now.getTime() + config.retention.outboxCompletedRetentionDays * 24 * 60 * 60 * 1_000,
  );
  const eventPurgeAt = new Date(
    now.getTime() + config.retention.providerEventSuccessRetentionDays * 24 * 60 * 60 * 1_000,
  );

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? 'dry-run' : 'apply',
        olderThan: olderThan.toISOString(),
        batchSize,
        candidates: {
          outbox_jobs: outboxCount,
          provider_events: providerEventCount,
        },
        countsByState: {
          outbox_jobs: outboxByStatus,
          provider_events: eventByProvider,
        },
        wouldSetPurgeAt: {
          outbox_jobs: outboxPurgeAt.toISOString(),
          provider_events: eventPurgeAt.toISOString(),
        },
        directDeletes: 0,
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    return;
  }

  const [outboxIds, providerEventIds] = await Promise.all([
    OutboxJobModel.find(outboxFilter).select({ _id: 1 }).limit(batchSize).lean().exec(),
    ProviderEventModel.find(providerEventFilter).select({ _id: 1 }).limit(batchSize).lean().exec(),
  ]);

  const [outboxResult, providerEventResult] = await Promise.all([
    OutboxJobModel.updateMany(
      { _id: { $in: outboxIds.map((document) => document._id) } },
      { $set: { purgeAt: outboxPurgeAt } },
    ),
    ProviderEventModel.updateMany(
      { _id: { $in: providerEventIds.map((document) => document._id) } },
      { $set: { purgeAt: eventPurgeAt } },
    ),
  ]);

  console.log(
    JSON.stringify({
      modified: {
        outbox_jobs: outboxResult.modifiedCount,
        provider_events: providerEventResult.modifiedCount,
      },
      directDeletes: 0,
    }),
  );
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectFromDatabase();
  });
