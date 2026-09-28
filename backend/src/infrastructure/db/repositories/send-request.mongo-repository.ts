import type { SendRequestRepository } from '../../../domain/repositories/send-request.repository';
import type { SendRequest } from '../../../domain/entities/send-request.entity';
import { SendRequestModel } from '../models/send-request.model';
import { toDomainEntity } from './mongo-mappers';

const ACTIVE_STATUSES = ['REQUESTED', 'ACCEPTED', 'BROADCASTED', 'CONFIRMED', 'OUTCOME_UNKNOWN'];

export class MongoSendRequestRepository implements SendRequestRepository {
  public async create(request: SendRequest): Promise<SendRequest> {
    const document = await SendRequestModel.create(request);
    return toDomainEntity<SendRequest>(document);
  }

  public async findLatestByOrderId(orderId: string): Promise<SendRequest | null> {
    const document = await SendRequestModel.findOne({ orderId }).sort({ createdAt: -1 }).exec();
    return document ? toDomainEntity<SendRequest>(document) : null;
  }

  public async findActiveByOrderId(orderId: string): Promise<SendRequest | null> {
    const document = await SendRequestModel.findOne({
      orderId,
      status: { $in: ACTIVE_STATUSES },
    })
      .sort({ createdAt: -1 })
      .exec();

    return document ? toDomainEntity<SendRequest>(document) : null;
  }

  public async updateById(id: string, patch: Partial<SendRequest>): Promise<SendRequest | null> {
    const document = await SendRequestModel.findByIdAndUpdate(id, patch, {
      returnDocument: 'after',
    }).exec();

    return document ? toDomainEntity<SendRequest>(document) : null;
  }
}
