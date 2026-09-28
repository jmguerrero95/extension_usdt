import type { Collection, Document, IndexDescriptionInfo } from 'mongodb';

export const ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME = 'uniq_orders_deposit_observed_txid';
export const ORDER_DEPOSIT_OBSERVED_TXID_INDEX = {
  key: {
    depositObservedTxid: 1,
  },
  name: ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME,
  unique: true,
  partialFilterExpression: {
    depositObservedTxid: {
      $type: 'string',
    },
  },
} as const;

const ORDER_DEPOSIT_OBSERVED_TXID_KEY = JSON.stringify(ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key);

const normalizeKey = (key: Record<string, unknown>): string => JSON.stringify(key);

const normalizeObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeObject(item));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((normalized, key) => {
      normalized[key] = normalizeObject((value as Record<string, unknown>)[key]);
      return normalized;
    }, {});
};

const isStructurallyEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(normalizeObject(left)) === JSON.stringify(normalizeObject(right));

const isDepositObservedTxidIndex = (index: IndexDescriptionInfo): boolean => {
  const key = index.key as Record<string, unknown> | undefined;
  return key !== undefined && normalizeKey(key) === ORDER_DEPOSIT_OBSERVED_TXID_KEY;
};

const isCompatibleDepositObservedTxidIndex = (index: IndexDescriptionInfo): boolean =>
  isDepositObservedTxidIndex(index) &&
  index.name === ORDER_DEPOSIT_OBSERVED_TXID_INDEX.name &&
  index.unique === ORDER_DEPOSIT_OBSERVED_TXID_INDEX.unique &&
  isStructurallyEqual(
    index.partialFilterExpression ?? null,
    ORDER_DEPOSIT_OBSERVED_TXID_INDEX.partialFilterExpression,
  );

export interface DepositObservedTxidDuplicate {
  txid: string;
  count: number;
  orderIds: string[];
}

export interface OrderDepositObservedTxidIndexPlan {
  indexesOnKey: Array<{
    name: string;
    key: Record<string, unknown>;
    unique: boolean;
    partialFilterExpression: Record<string, unknown> | null;
  }>;
  duplicates: DepositObservedTxidDuplicate[];
  hasCompatibleIndex: boolean;
  incompatibleIndexNames: string[];
  wouldDropIndexes: string[];
  wouldCreateIndex: boolean;
}

export const findDuplicateDepositObservedTxids = async (
  collection: Collection<Document>,
): Promise<DepositObservedTxidDuplicate[]> => {
  const duplicates = await collection
    .aggregate<DepositObservedTxidDuplicate>([
      {
        $match: {
          depositObservedTxid: {
            $type: 'string',
          },
        },
      },
      {
        $group: {
          _id: '$depositObservedTxid',
          count: { $sum: 1 },
          orderIds: { $push: '$orderId' },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          txid: '$_id',
          count: 1,
          orderIds: 1,
        },
      },
      {
        $sort: {
          count: -1,
          txid: 1,
        },
      },
    ])
    .toArray();

  return duplicates;
};

export const planOrderDepositObservedTxidIndexMigration = async (
  collection: Collection<Document>,
): Promise<OrderDepositObservedTxidIndexPlan> => {
  const indexes = await collection.indexes();
  const indexesOnKey = indexes.filter(isDepositObservedTxidIndex);
  const incompatibleIndexNames = indexesOnKey
    .filter((index) => !isCompatibleDepositObservedTxidIndex(index))
    .flatMap((index) => (typeof index.name === 'string' ? [index.name] : []));
  const duplicates = await findDuplicateDepositObservedTxids(collection);

  return {
    indexesOnKey: indexesOnKey.map((index) => ({
      name: typeof index.name === 'string' ? index.name : '(unnamed)',
      key: index.key as Record<string, unknown>,
      unique: index.unique === true,
      partialFilterExpression:
        typeof index.partialFilterExpression === 'object' && index.partialFilterExpression !== null
          ? (index.partialFilterExpression as Record<string, unknown>)
          : null,
    })),
    duplicates,
    hasCompatibleIndex: indexesOnKey.some(isCompatibleDepositObservedTxidIndex),
    incompatibleIndexNames,
    wouldDropIndexes: duplicates.length === 0 ? incompatibleIndexNames : [],
    wouldCreateIndex:
      duplicates.length === 0 &&
      !indexesOnKey.some(isCompatibleDepositObservedTxidIndex),
  };
};

export const applyOrderDepositObservedTxidIndexMigration = async (
  collection: Collection<Document>,
): Promise<{
  droppedIndexes: string[];
  createdIndex: string | null;
}> => {
  const plan = await planOrderDepositObservedTxidIndexMigration(collection);
  if (plan.duplicates.length > 0) {
    throw new Error(
      `No se puede crear ${ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME} porque existen depositObservedTxid duplicados.`,
    );
  }

  for (const indexName of plan.incompatibleIndexNames) {
    await collection.dropIndex(indexName);
  }

  if (!plan.hasCompatibleIndex) {
    await collection.createIndex(
      ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key,
      {
        name: ORDER_DEPOSIT_OBSERVED_TXID_INDEX.name,
        unique: ORDER_DEPOSIT_OBSERVED_TXID_INDEX.unique,
        partialFilterExpression: ORDER_DEPOSIT_OBSERVED_TXID_INDEX.partialFilterExpression,
      },
    );
  }

  return {
    droppedIndexes: plan.incompatibleIndexNames,
    createdIndex: plan.hasCompatibleIndex ? null : ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME,
  };
};
