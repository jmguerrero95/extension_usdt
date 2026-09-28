import type { ForwardRequestRepository } from '../../../domain/repositories/forward-request.repository';
import type { ForwardRequest } from '../../../domain/entities/forward-request.entity';
import { ForwardRequestModel } from '../models/forward-request.model';
import { toDomainEntity } from './mongo-mappers';

const ACTIVE_STATUSES = ['REQUESTED', 'ACCEPTED', 'CONFIRMED', 'OUTCOME_UNKNOWN'];

export class MongoForwardRequestRepository implements ForwardRequestRepository {
  public async create(request: ForwardRequest): Promise<ForwardRequest> {
    const document = await ForwardRequestModel.create(request);
    return toDomainEntity<ForwardRequest>(document);
  }

  public async findLatestByOrderId(orderId: string): Promise<ForwardRequest | null> {
    const document = await ForwardRequestModel.findOne({ orderId }).sort({ createdAt: -1 }).exec();
    return document ? toDomainEntity<ForwardRequest>(document) : null;
  }

  public async findActiveByOrderId(orderId: string): Promise<ForwardRequest | null> {
    const document = await ForwardRequestModel.findOne({
      orderId,
      status: { $in: ACTIVE_STATUSES },
    })
      .sort({ createdAt: -1 })
      .exec();

    return document ? toDomainEntity<ForwardRequest>(document) : null;
  }

  public async updateById(
    id: string,
    patch: Partial<ForwardRequest>,
  ): Promise<ForwardRequest | null> {
    const document = await ForwardRequestModel.findByIdAndUpdate(id, patch, {
      returnDocument: 'after',
    }).exec();

    return document ? toDomainEntity<ForwardRequest>(document) : null;
  }
}
