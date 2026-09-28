import 'dotenv/config';

import { loadConfig } from '../app/config/env';
import { connectToDatabase, disconnectFromDatabase } from '../infrastructure/db/connection';
import { DistributedLockModel } from '../infrastructure/db/models/distributed-lock.model';

const hasFlag = (name: string): boolean => process.argv.includes(name);

const normalizeKey = (key: Record<string, unknown>): string => JSON.stringify(key);

const main = async (): Promise<void> => {
  const config = loadConfig();
  const apply = hasFlag('--apply');
  const dryRun = !apply || hasFlag('--dry-run');

  await connectToDatabase(config);

  const collection = DistributedLockModel.collection;
  const indexes = await collection.indexes();
  const ttlIndexes = indexes.filter(
    (index) =>
      typeof index.name === 'string' &&
      normalizeKey(index.key as Record<string, unknown>) === JSON.stringify({ expiresAt: 1 }) &&
      typeof index.expireAfterSeconds === 'number',
  );
  const hasNormalExpiresAtIndex = indexes.some(
    (index) =>
      normalizeKey(index.key as Record<string, unknown>) === JSON.stringify({ expiresAt: 1 }) &&
      typeof index.expireAfterSeconds !== 'number',
  );
  const hasUniqueLockKeyIndex = indexes.some(
    (index) =>
      normalizeKey(index.key as Record<string, unknown>) === JSON.stringify({ lockKey: 1 }) &&
      index.unique === true,
  );
  const ttlIndexNames = ttlIndexes.flatMap((index) =>
    typeof index.name === 'string' ? [index.name] : [],
  );

  const leaderBefore = await DistributedLockModel.findOne({ lockKey: 'scheduler:leader' })
    .lean()
    .exec();

  const plan = {
    mode: dryRun ? 'dry-run' : 'apply',
    ttlIndexesFound: ttlIndexes.map((index) => ({
      name: index.name,
      key: index.key,
      expireAfterSeconds: index.expireAfterSeconds,
    })),
    wouldDropIndexes: ttlIndexNames,
    wouldCreate: {
      expiresAtIndex: !hasNormalExpiresAtIndex,
      uniqueLockKeyIndex: !hasUniqueLockKeyIndex,
    },
    leaderBefore: leaderBefore
      ? {
          lockKey: leaderBefore.lockKey,
          leaseId: leaderBefore.leaseId ?? null,
          ownerId: leaderBefore.ownerId ?? null,
          bootId: leaderBefore.bootId ?? null,
          fencingToken: leaderBefore.fencingToken ?? null,
          expiresAt: leaderBefore.expiresAt,
        }
      : null,
  };

  console.log(JSON.stringify(plan, null, 2));

  if (dryRun) {
    return;
  }

  for (const ttlIndexName of ttlIndexNames) {
    await collection.dropIndex(ttlIndexName);
  }

  if (!hasNormalExpiresAtIndex) {
    await collection.createIndex({ expiresAt: 1 }, { name: 'expiresAt_1' });
  }

  if (!hasUniqueLockKeyIndex) {
    await collection.createIndex({ lockKey: 1 }, { name: 'lockKey_1', unique: true });
  }

  const leaderAfter = await DistributedLockModel.findOne({ lockKey: 'scheduler:leader' })
    .lean()
    .exec();
  const indexesAfter = await collection.indexes();

  console.log(
    JSON.stringify(
      {
        droppedIndexes: ttlIndexNames,
        createdIndexes: [
          ...(!hasNormalExpiresAtIndex ? ['expiresAt_1'] : []),
          ...(!hasUniqueLockKeyIndex ? ['lockKey_1'] : []),
        ],
        leaderAfter: leaderAfter
          ? {
              lockKey: leaderAfter.lockKey,
              leaseId: leaderAfter.leaseId ?? null,
              ownerId: leaderAfter.ownerId ?? null,
              bootId: leaderAfter.bootId ?? null,
              fencingToken: leaderAfter.fencingToken ?? null,
              expiresAt: leaderAfter.expiresAt,
            }
          : null,
        indexesAfter: indexesAfter.map((index) => ({
          name: index.name,
          key: index.key,
          unique: index.unique ?? false,
          expireAfterSeconds: index.expireAfterSeconds ?? null,
        })),
      },
      null,
      2,
    ),
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
