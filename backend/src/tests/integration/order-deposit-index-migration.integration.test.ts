import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectToDatabase, disconnectFromDatabase } from '../../infrastructure/db/connection';
import {
  ORDER_DEPOSIT_OBSERVED_TXID_INDEX,
  ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME,
  applyOrderDepositObservedTxidIndexMigration,
  planOrderDepositObservedTxidIndexMigration,
} from '../../infrastructure/db/indexes/order-deposit-observed-txid-index';
import { OrderModel, orderSchema } from '../../infrastructure/db/models/order.model';
import { buildTestConfig } from '../test-helpers';

const LEGACY_PARTIAL_FILTER_EXPRESSION = {
  depositObservedTxid: {
    $exists: true,
    $type: 'string',
  },
} as const;

const buildOrderDocument = (orderId: string, depositObservedTxid?: string) => ({
  orderId,
  type: 'SELL',
  asset: 'USDT',
  network: 'TRON',
  fiatCurrency: 'COP',
  fiatAmount: 1,
  providerUniqId: `sell_${orderId}`,
  providerLabel: orderId,
  status: 'WAITING_DEPOSIT',
  manualReviewRequired: false,
  depositObservedTxid: depositObservedTxid ?? null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('order deposit observed txid index migration', () => {
  let mongo: MongoMemoryServer;
  let config: ReturnType<typeof buildTestConfig>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    config = buildTestConfig(mongo.getUri());
    await connectToDatabase(config);
    await OrderModel.init();
  });

  beforeEach(async () => {
    await OrderModel.deleteMany({}).exec();
    const indexes = await OrderModel.collection.indexes();
    for (const index of indexes) {
      if (index.name && index.name !== '_id_') {
        await OrderModel.collection.dropIndex(index.name);
      }
    }
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await mongoose.disconnect().catch(() => undefined);
    await mongo.stop();
  });

  it('declara en el modelo exactamente el indice canonico sin $exists', () => {
    const schemaIndexes = orderSchema.indexes();
    const depositIndex = schemaIndexes.find(
      ([key]) =>
        JSON.stringify(key) === JSON.stringify(ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key),
    );

    expect(depositIndex).toBeDefined();
    expect(depositIndex?.[1]).toMatchObject({
      name: ORDER_DEPOSIT_OBSERVED_TXID_INDEX.name,
      unique: true,
      partialFilterExpression: ORDER_DEPOSIT_OBSERVED_TXID_INDEX.partialFilterExpression,
    });
    expect(depositIndex?.[1]?.partialFilterExpression).toEqual({
      depositObservedTxid: {
        $type: 'string',
      },
    });
    expect(JSON.stringify(depositIndex?.[1]?.partialFilterExpression ?? {})).not.toContain(
      '$exists',
    );
  });

  it('dry-run detecta un indice antiguo normal incompatible sin tocar otros indices', async () => {
    await OrderModel.collection.createIndex({ externalRef: 1 }, { name: 'externalRef_custom' });
    await OrderModel.collection.createIndex(
      ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key,
      { name: 'depositObservedTxid_1' },
    );

    const plan = await planOrderDepositObservedTxidIndexMigration(OrderModel.collection);

    expect(plan.incompatibleIndexNames).toContain('depositObservedTxid_1');
    expect(plan.wouldDropIndexes).toEqual(['depositObservedTxid_1']);
    expect(plan.wouldCreateIndex).toBe(true);
    expect(plan.indexesOnKey).toHaveLength(1);

    const indexesAfterPlan = await OrderModel.collection.indexes();
    expect(indexesAfterPlan.some((index) => index.name === 'externalRef_custom')).toBe(true);
  });

  it('dry-run identifica el indice parcial antiguo con $exists como incompatible', async () => {
    await OrderModel.collection.createIndex(
      ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key,
      {
        name: 'depositObservedTxid_legacy_exists',
        unique: true,
        partialFilterExpression: LEGACY_PARTIAL_FILTER_EXPRESSION,
      },
    );

    const plan = await planOrderDepositObservedTxidIndexMigration(OrderModel.collection);

    expect(plan.incompatibleIndexNames).toEqual(['depositObservedTxid_legacy_exists']);
    expect(plan.wouldDropIndexes).toEqual(['depositObservedTxid_legacy_exists']);
    expect(plan.wouldCreateIndex).toBe(true);
    expect(plan.indexesOnKey[0]?.partialFilterExpression).toEqual(
      LEGACY_PARTIAL_FILTER_EXPRESSION,
    );
  });

  it('apply reemplaza el indice parcial antiguo con $exists, deja intactos los demas y converge de forma idempotente', async () => {
    await OrderModel.collection.createIndex({ externalRef: 1 }, { name: 'externalRef_custom' });
    await OrderModel.collection.createIndex(
      ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key,
      {
        name: 'depositObservedTxid_legacy_exists',
        unique: true,
        partialFilterExpression: LEGACY_PARTIAL_FILTER_EXPRESSION,
      },
    );

    const firstApply = await applyOrderDepositObservedTxidIndexMigration(OrderModel.collection);
    expect(firstApply.droppedIndexes).toEqual(['depositObservedTxid_legacy_exists']);
    expect(firstApply.createdIndex).toBe(ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME);

    const indexesAfterFirstApply = await OrderModel.collection.indexes();
    const finalIndex = indexesAfterFirstApply.find(
      (index) => index.name === ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME,
    );
    expect(finalIndex?.unique).toBe(true);
    expect(finalIndex?.partialFilterExpression).toEqual(
      ORDER_DEPOSIT_OBSERVED_TXID_INDEX.partialFilterExpression,
    );
    expect(indexesAfterFirstApply.some((index) => index.name === 'externalRef_custom')).toBe(true);

    const secondApply = await applyOrderDepositObservedTxidIndexMigration(OrderModel.collection);
    expect(secondApply.droppedIndexes).toEqual([]);
    expect(secondApply.createdIndex).toBeNull();

    const finalPlan = await planOrderDepositObservedTxidIndexMigration(OrderModel.collection);
    expect(finalPlan.wouldDropIndexes).toEqual([]);
    expect(finalPlan.wouldCreateIndex).toBe(false);
    expect(finalPlan.incompatibleIndexNames).toEqual([]);
  });

  it('completa el ciclo migracion apply -> OrderModel.init() sin IndexOptionsConflict', async () => {
    await OrderModel.collection.createIndex(
      ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key,
      {
        name: 'depositObservedTxid_legacy_exists',
        unique: true,
        partialFilterExpression: LEGACY_PARTIAL_FILTER_EXPRESSION,
      },
    );

    await applyOrderDepositObservedTxidIndexMigration(OrderModel.collection);

    const freshConnection = await mongoose.createConnection(config.mongodbUri, {
      dbName: config.mongodbDbName,
    }).asPromise();

    try {
      const FreshOrderModel = freshConnection.model('OrderCycle', orderSchema, 'orders');

      await expect(FreshOrderModel.init()).resolves.toBeUndefined();
      await expect(FreshOrderModel.init()).resolves.toBeUndefined();
    } finally {
      await freshConnection.close();
    }
  });

  it('impide la migracion si encuentra depositObservedTxid duplicados sin modificar documentos ni indices', async () => {
    await OrderModel.collection.insertMany([
      buildOrderDocument('ord_dup_1', 'dup-txid-1'),
      buildOrderDocument('ord_dup_2', 'dup-txid-1'),
    ]);

    await OrderModel.collection.createIndex(
      ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key,
      { name: 'depositObservedTxid_1' },
    );

    const countBeforeApply = await OrderModel.countDocuments({
      depositObservedTxid: 'dup-txid-1',
    }).exec();
    const plan = await planOrderDepositObservedTxidIndexMigration(OrderModel.collection);

    expect(plan.duplicates).toHaveLength(1);
    expect(plan.duplicates[0]?.txid).toBe('dup-txid-1');
    expect(plan.wouldDropIndexes).toEqual([]);
    expect(plan.wouldCreateIndex).toBe(false);

    await expect(
      applyOrderDepositObservedTxidIndexMigration(OrderModel.collection),
    ).rejects.toThrowError(/depositObservedTxid duplicados/i);

    const indexesAfterFailure = await OrderModel.collection.indexes();
    const countAfterApply = await OrderModel.countDocuments({
      depositObservedTxid: 'dup-txid-1',
    }).exec();

    expect(indexesAfterFailure.some((index) => index.name === 'depositObservedTxid_1')).toBe(true);
    expect(
      indexesAfterFailure.some((index) => index.name === ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME),
    ).toBe(false);
    expect(countAfterApply).toBe(countBeforeApply);
  });
});
