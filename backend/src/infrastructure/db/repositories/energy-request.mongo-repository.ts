import type { EnergyRequestRepository } from '../../../domain/repositories/energy-request.repository';
import type { EnergyRequest } from '../../../domain/entities/energy-request.entity';
import { EnergyRequestModel } from '../models/energy-request.model';
import { toDomainEntity } from './mongo-mappers';

const ACTIVE_STATUSES = ['PENDING', 'REQUESTED', 'CONFIRMED', 'OUTCOME_UNKNOWN'];

export class MongoEnergyRequestRepository implements EnergyRequestRepository {
  public async create(request: EnergyRequest): Promise<EnergyRequest> {
    const document = await EnergyRequestModel.create(request);
    return toDomainEntity<EnergyRequest>(document);
  }

  public async findLatestByOrderId(orderId: string): Promise<EnergyRequest | null> {
    const document = await EnergyRequestModel.findOne({ orderId }).sort({ createdAt: -1 }).exec();
    return document ? toDomainEntity<EnergyRequest>(document) : null;
  }

  public async findActiveByOrderId(orderId: string): Promise<EnergyRequest | null> {
    const document = await EnergyRequestModel.findOne({
      orderId,
      status: { $in: ACTIVE_STATUSES },
    })
      .sort({ createdAt: -1 })
      .exec();

    return document ? toDomainEntity<EnergyRequest>(document) : null;
  }

  public async findReusableConfirmedByAddress(
    receiveAddress: string,
    energyContext: EnergyRequest['energyContext'],
    since: Date,
  ): Promise<EnergyRequest | null> {
    const document = await EnergyRequestModel.findOne({
      receiveAddress,
      energyContext,
      status: 'CONFIRMED',
      confirmedAt: { $gte: since },
    })
      .sort({ confirmedAt: -1, createdAt: -1 })
      .exec();

    return document ? toDomainEntity<EnergyRequest>(document) : null;
  }

  public async updateById(id: string, patch: Partial<EnergyRequest>): Promise<EnergyRequest | null> {
    const document = await EnergyRequestModel.findByIdAndUpdate(id, patch, {
      returnDocument: 'after',
    }).exec();

    return document ? toDomainEntity<EnergyRequest>(document) : null;
  }
}
