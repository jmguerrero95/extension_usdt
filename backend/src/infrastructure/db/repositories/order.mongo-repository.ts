import type { OrderRepository } from '../../../domain/repositories/order.repository';
import type { Order } from '../../../domain/entities/order.entity';
import type { OrderStatus } from '../../../domain/enums/order-status';
import { OrderModel } from '../models/order.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoOrderRepository implements OrderRepository {
  public async create(order: Order): Promise<Order> {
    const document = await OrderModel.create(order);
    return toDomainEntity<Order>(document);
  }

  public async findByOrderId(orderId: string): Promise<Order | null> {
    const document = await OrderModel.findOne({ orderId }).exec();
    return document ? toDomainEntity<Order>(document) : null;
  }

  public async findByCorrelation(params: {
    providerUniqId?: string | null;
    providerLabel?: string | null;
    depositAddress?: string | null;
    providerRequestId?: string | null;
  }): Promise<Order | null> {
    const queries: Array<Record<string, string>> = [];
    if (params.providerUniqId) {
      queries.push({ providerUniqId: params.providerUniqId });
    }
    if (params.providerLabel) {
      queries.push({ providerLabel: params.providerLabel });
    }
    if (params.depositAddress) {
      queries.push({ depositAddress: params.depositAddress });
      queries.push({ buySenderAddress: params.depositAddress });
    }
    if (params.providerRequestId) {
      queries.push({ providerForwardRequestId: params.providerRequestId });
      queries.push({ providerSendRequestId: params.providerRequestId });
    }

    for (const query of queries) {
      const document = await OrderModel.findOne(query).exec();
      if (document) {
        return toDomainEntity<Order>(document);
      }
    }

    return null;
  }

  public async update(orderId: string, patch: Partial<Order>): Promise<Order | null> {
    const document = await OrderModel.findOneAndUpdate({ orderId }, patch, {
      returnDocument: 'after',
    }).exec();

    return document ? toDomainEntity<Order>(document) : null;
  }

  public async updateStatus(
    orderId: string,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    patch: Partial<Order> = {},
  ): Promise<Order | null> {
    const document = await OrderModel.findOneAndUpdate(
      { orderId, status: fromStatus },
      {
        ...patch,
        status: toStatus,
      },
      { returnDocument: 'after' },
    ).exec();

    return document ? toDomainEntity<Order>(document) : null;
  }

  public async list(filters?: {
    status?: string;
    terminalId?: string;
    externalRef?: string;
    limit?: number;
    skip?: number;
  }): Promise<Order[]> {
    const query = OrderModel.find({
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.terminalId ? { terminalId: filters.terminalId } : {}),
      ...(filters?.externalRef ? { externalRef: filters.externalRef } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(filters?.limit ?? 50)
      .skip(filters?.skip ?? 0);

    const documents = await query.exec();
    return documents.map((document) => toDomainEntity<Order>(document));
  }

  public async findExpirable(referenceDate: Date): Promise<Order[]> {
    const documents = await OrderModel.find({
      status: { $in: ['CREATED', 'ADDRESS_ASSIGNED', 'WAITING_DEPOSIT'] },
      expiresAt: { $lte: referenceDate },
      depositObservedAt: null,
    }).exec();

    return documents.map((document) => toDomainEntity<Order>(document));
  }

  public async findExpirableCreatedSince(referenceDate: Date, createdSince: Date): Promise<Order[]> {
    const documents = await OrderModel.find({
      status: { $in: ['CREATED', 'ADDRESS_ASSIGNED', 'WAITING_DEPOSIT'] },
      expiresAt: { $lte: referenceDate },
      createdAt: { $gte: createdSince },
      depositObservedAt: null,
      manualReviewRequired: { $ne: true },
    }).exec();

    return documents.map((document) => toDomainEntity<Order>(document));
  }

  public async findOpenOrders(limit = 500): Promise<Order[]> {
    const documents = await OrderModel.find({
      status: {
        $nin: ['COMPLETED', 'EXPIRED', 'CANCELED', 'LATE_DEPOSIT', 'ERROR_MANUAL_REVIEW'],
      },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return documents.map((document) => toDomainEntity<Order>(document));
  }

  public async findLegacyOpenOrders(params: {
    referenceDate: Date;
    afterId?: string | null;
    limit?: number;
  }): Promise<Order[]> {
    const documents = await OrderModel.find({
      createdAt: { $lt: params.referenceDate },
      ...(params.afterId ? { _id: { $gt: params.afterId } } : {}),
      status: {
        $nin: ['COMPLETED', 'EXPIRED', 'CANCELED', 'LATE_DEPOSIT', 'ERROR_MANUAL_REVIEW'],
      },
    })
      .sort({ _id: 1 })
      .limit(params.limit ?? 500)
      .exec();

    return documents.map((document) => toDomainEntity<Order>(document));
  }
}
