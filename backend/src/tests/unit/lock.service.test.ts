import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { connectToDatabase, disconnectFromDatabase } from '../../infrastructure/db/connection';
import { DistributedLockModel } from '../../infrastructure/db/models/distributed-lock.model';
import { MongoLockService } from '../../infrastructure/locks/mongo-lock.service';
import { buildTestConfig } from '../test-helpers';

describe('MongoLockService', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await connectToDatabase(buildTestConfig(mongo.getUri()));
    await DistributedLockModel.init();
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await mongo.stop();
  });

  it('adquiere y libera un lock por orden', async () => {
    const service = new MongoLockService(30);
    const lease = await service.acquireLease('order:ord_1', 'owner-1');

    expect(lease?.ownerId).toBe('owner-1');
    expect(await service.acquire('order:ord_1', 'owner-2')).toBeNull();

    await service.releaseLease(lease as NonNullable<typeof lease>);
    expect(await service.acquire('order:ord_1', 'owner-2')).toBe('owner-2');
  });

  it('mantiene fencing token monotonico para liderazgo tras release y expiracion', async () => {
    const service = new MongoLockService(30);

    const first = await service.acquireLeader('scheduler:leader:test', 'boot-1');
    expect(first?.fencingToken).toBe(1);

    await service.releaseLeader(first as NonNullable<typeof first>);
    const second = await service.acquireLeader('scheduler:leader:test', 'boot-2');
    expect(second?.fencingToken).toBe(2);

    await DistributedLockModel.updateOne(
      { lockKey: 'scheduler:leader:test' },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    ).exec();

    const third = await service.acquireLeader('scheduler:leader:test', 'boot-3');
    expect(third?.fencingToken).toBe(3);
  });

  it('no permite que un release viejo elimine un lock efimero nuevo', async () => {
    const service = new MongoLockService(30);

    const first = await service.acquireLease('order:stale-release', 'owner-shared');
    expect(first).not.toBeNull();
    await service.releaseLease(first as NonNullable<typeof first>);

    const second = await service.acquireLease('order:stale-release', 'owner-shared');
    expect(second).not.toBeNull();

    await service.releaseLease(first as NonNullable<typeof first>);

    const persisted = await DistributedLockModel.findOne({ lockKey: 'order:stale-release' })
      .lean()
      .exec();

    expect(persisted?.leaseId).toBe(second?.leaseId);
    expect(persisted?.ownerId).toBe('owner-shared');
  });

  it('no permite que un renew viejo renueve un lease nuevo', async () => {
    const service = new MongoLockService(30);

    const first = await service.acquireLease('order:stale-renew', 'owner-shared');
    expect(first).not.toBeNull();
    await service.releaseLease(first as NonNullable<typeof first>);

    const second = await service.acquireLease('order:stale-renew', 'owner-shared');
    expect(second).not.toBeNull();

    const renewed = await service.renewLease(first as NonNullable<typeof first>);
    const persisted = await DistributedLockModel.findOne({ lockKey: 'order:stale-renew' })
      .lean()
      .exec();

    expect(renewed).toBeNull();
    expect(persisted?.leaseId).toBe(second?.leaseId);
    expect(persisted?.fencingToken).toBe(second?.fencingToken);
  });
});
