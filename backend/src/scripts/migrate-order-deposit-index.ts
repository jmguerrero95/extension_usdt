import 'dotenv/config';

import { loadConfig } from '../app/config/env';
import { connectToDatabase, disconnectFromDatabase } from '../infrastructure/db/connection';
import { OrderModel } from '../infrastructure/db/models/order.model';
import {
  ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME,
  applyOrderDepositObservedTxidIndexMigration,
  planOrderDepositObservedTxidIndexMigration,
} from '../infrastructure/db/indexes/order-deposit-observed-txid-index';

const readNpmOriginalArgs = (): string[] => {
  const raw = process.env['npm_config_argv'];
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as { original?: unknown };
    return Array.isArray(parsed.original)
      ? parsed.original.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
};

const cliArgs = [...process.argv.slice(2), ...readNpmOriginalArgs()];

const hasFlag = (name: string): boolean =>
  cliArgs.includes(name) || process.env[`npm_config_${name.replace(/^--/, '')}`] === 'true';

export const main = async (): Promise<void> => {
  const config = loadConfig();
  const apply = hasFlag('--apply');
  const dryRun = !apply || hasFlag('--dry-run');

  await connectToDatabase(config);

  const collection = OrderModel.collection;
  const plan = await planOrderDepositObservedTxidIndexMigration(collection);

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? 'dry-run' : 'apply',
        collection: collection.collectionName,
        indexName: ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME,
        indexesOnKey: plan.indexesOnKey,
        duplicates: plan.duplicates,
        wouldDropIndexes: plan.wouldDropIndexes,
        wouldCreateIndex: plan.wouldCreateIndex,
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    return;
  }

  if (plan.duplicates.length > 0) {
    throw new Error(
      `Se detectaron depositObservedTxid duplicados. Corrige los conflictos antes de crear ${ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME}.`,
    );
  }

  const result = await applyOrderDepositObservedTxidIndexMigration(collection);
  const indexesAfter = await collection.indexes();

  console.log(
    JSON.stringify(
      {
        mode: 'apply',
        droppedIndexes: result.droppedIndexes,
        createdIndex: result.createdIndex,
        indexesAfter: indexesAfter.map((index) => ({
          name: index.name,
          key: index.key,
          unique: index.unique ?? false,
          partialFilterExpression: index.partialFilterExpression ?? null,
        })),
      },
      null,
      2,
    ),
  );
};

const isDirectExecution = (process.argv[1] ?? '').includes('migrate-order-deposit-index');

if (isDirectExecution) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => {
      void disconnectFromDatabase();
    });
}
