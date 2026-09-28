import 'dotenv/config';

import { loadConfig } from '../app/config/env';
import { connectToDatabase, disconnectFromDatabase } from '../infrastructure/db/connection';
import { OrderModel } from '../infrastructure/db/models/order.model';
import { OutboxJobModel } from '../infrastructure/db/models/outbox-job.model';
import { ProviderEventModel } from '../infrastructure/db/models/provider-event.model';
import { EnergyRequestModel } from '../infrastructure/db/models/energy-request.model';
import { ForwardRequestModel } from '../infrastructure/db/models/forward-request.model';
import { SendRequestModel } from '../infrastructure/db/models/send-request.model';
import { OrderStateTransitionModel } from '../infrastructure/db/models/order-state-transition.model';
import { DistributedLockModel } from '../infrastructure/db/models/distributed-lock.model';

const collectionNames = [
  'orders',
  'outbox_jobs',
  'provider_events',
  'energy_requests',
  'forward_requests',
  'send_requests',
  'order_state_transitions',
  'distributed_locks',
] as const;

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const sevenDaysAgo = (): Date => new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);

interface DistributedLockAnalyzeFacet {
  totals?: Array<{
    total: number;
    active: number;
    released: number;
  }>;
  byPrefix?: Array<{
    _id: string;
    count: number;
    active: number;
    released: number;
  }>;
  oldLocks?: Array<Record<string, unknown>>;
}

const main = async (): Promise<void> => {
  const config = loadConfig();
  await connectToDatabase(config);

  const db = OutboxJobModel.db.db;
  if (!db) {
    throw new Error('MongoDB no esta conectado.');
  }

  console.log('Storage analyze (read-only)');
  console.log(`Database: ${config.mongodbDbName}`);

  for (const collectionName of collectionNames) {
    const stats = await db.command({ collStats: collectionName }).catch(() => null);
    if (!stats) {
      continue;
    }

    console.log(
      JSON.stringify({
        collection: collectionName,
        count: asNumber(stats['count']),
        sizeBytes: asNumber(stats['size']),
        storageSizeBytes: asNumber(stats['storageSize']),
        totalIndexSizeBytes: asNumber(stats['totalIndexSize']),
      }),
    );
  }

  console.log(
    JSON.stringify({
      outboxByTypeStatus: await OutboxJobModel.aggregate([
        { $group: { _id: { jobType: '$jobType', status: '$status' }, count: { $sum: 1 } } },
        { $sort: { '_id.jobType': 1, '_id.status': 1 } },
      ]),
    }),
  );

  console.log(
    JSON.stringify({
      outboxByDay: await OutboxJobModel.aggregate([
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    }),
  );

  console.log(
    JSON.stringify({
      ordersWithMostJobs: await OutboxJobModel.aggregate([
        { $match: { orderId: { $type: 'string' } } },
        { $group: { _id: '$orderId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
    }),
  );

  console.log(
    JSON.stringify({
      providerEventsByProviderStatusDay: await ProviderEventModel.aggregate([
        {
          $group: {
            _id: {
              provider: '$provider',
              processed: '$processed',
              day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.provider': 1, '_id.day': 1 } },
      ]),
    }),
  );

  console.log(
    JSON.stringify({
      operationRequestsByOrder: {
        energy: await EnergyRequestModel.aggregate([
          { $group: { _id: '$orderId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        forward: await ForwardRequestModel.aggregate([
          { $group: { _id: '$orderId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        send: await SendRequestModel.aggregate([
          { $group: { _id: '$orderId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
      },
    }),
  );

  console.log(
    JSON.stringify({
      repeatedStateCycles: await OrderStateTransitionModel.aggregate([
        { $group: { _id: { orderId: '$orderId', toStatus: '$toStatus' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
    }),
  );

  console.log(
    JSON.stringify({
      retentionCandidates: {
        completedOutboxWithoutPurgeAt: await OutboxJobModel.countDocuments({
          status: 'COMPLETED',
          purgeAt: null,
        }),
        processedProviderEventsWithoutPurgeAt: await ProviderEventModel.countDocuments({
          processed: true,
          error: null,
          purgeAt: null,
        }),
        terminalOrders: await OrderModel.countDocuments({
          status: { $in: ['COMPLETED', 'EXPIRED', 'CANCELED', 'LATE_DEPOSIT'] },
        }),
      },
    }),
  );

  const distributedLockIndexes = await DistributedLockModel.collection.indexes();
  const distributedLockCounts = await DistributedLockModel.aggregate<DistributedLockAnalyzeFacet>([
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$ownerId', null] },
                        { $gt: ['$expiresAt', '$$NOW'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              released: {
                $sum: {
                  $cond: [{ $eq: ['$ownerId', null] }, 1, 0],
                },
              },
            },
          },
        ],
        byPrefix: [
          {
            $project: {
              prefix: {
                $cond: [
                  { $gte: [{ $indexOfBytes: ['$lockKey', ':'] }, 0] },
                  {
                    $substrBytes: ['$lockKey', 0, { $indexOfBytes: ['$lockKey', ':'] }],
                  },
                  '$lockKey',
                ],
              },
              isActive: {
                $and: [
                  { $ne: ['$ownerId', null] },
                  { $gt: ['$expiresAt', '$$NOW'] },
                ],
              },
              isReleased: { $eq: ['$ownerId', null] },
            },
          },
          {
            $group: {
              _id: '$prefix',
              count: { $sum: 1 },
              active: { $sum: { $cond: ['$isActive', 1, 0] } },
              released: { $sum: { $cond: ['$isReleased', 1, 0] } },
            },
          },
          { $sort: { count: -1, _id: 1 } },
        ],
        oldLocks: [
          {
            $match: {
              $or: [
                { ownerId: null, createdAt: { $lt: sevenDaysAgo() } },
                { ownerId: null, releasedAt: { $lt: sevenDaysAgo() } },
                { ownerId: { $ne: null }, expiresAt: { $lt: new Date() } },
              ],
            },
          },
          {
            $project: {
              _id: 0,
              lockKey: 1,
              leaseId: 1,
              ownerId: 1,
              bootId: 1,
              fencingToken: 1,
              releasedAt: 1,
              expiresAt: 1,
              createdAt: 1,
            },
          },
          { $sort: { expiresAt: 1, releasedAt: 1, createdAt: 1 } },
          { $limit: 50 },
        ],
      },
    },
  ]);
  const distributedLockFacet = distributedLockCounts[0];

  console.log(
    JSON.stringify({
      distributedLocks: {
        summary: distributedLockFacet?.totals?.[0] ?? {
          total: 0,
          active: 0,
          released: 0,
        },
        byPrefix: distributedLockFacet?.byPrefix ?? [],
        oldLocks: distributedLockFacet?.oldLocks ?? [],
        indexes: distributedLockIndexes.map((index) => ({
          name: index.name,
          key: index.key,
          unique: index.unique ?? false,
          expireAfterSeconds: index.expireAfterSeconds ?? null,
        })),
      },
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
