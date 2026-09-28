import type { ProviderEventRepository } from '../../../domain/repositories/provider-event.repository';
import type { ProviderEvent } from '../../../domain/entities/provider-event.entity';
import type { ProviderName } from '../../../shared/constants/providers';
import { ProviderEventModel } from '../models/provider-event.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoProviderEventRepository implements ProviderEventRepository {
  public async create(event: ProviderEvent): Promise<ProviderEvent> {
    const document = await ProviderEventModel.create(event);
    return toDomainEntity<ProviderEvent>(document);
  }

  public async findByEventKey(eventKey: string): Promise<ProviderEvent | null> {
    const document = await ProviderEventModel.findOne({ eventKey }).exec();
    return document ? toDomainEntity<ProviderEvent>(document) : null;
  }

  public async findById(id: string): Promise<ProviderEvent | null> {
    const document = await ProviderEventModel.findOne({ _id: id }).exec();
    return document ? toDomainEntity<ProviderEvent>(document) : null;
  }

  public async listByOrderId(orderId: string): Promise<ProviderEvent[]> {
    const documents = await ProviderEventModel.find({ orderId }).sort({ createdAt: 1 }).exec();
    return documents.map((document) => toDomainEntity<ProviderEvent>(document));
  }

  public async markProcessed(
    eventKey: string,
    patch: Pick<ProviderEvent, 'processed' | 'processedAt' | 'error' | 'orderId'> & {
      purgeAt?: Date | null;
    },
  ): Promise<ProviderEvent | null> {
    const document = await ProviderEventModel.findOneAndUpdate(
      { eventKey },
      {
        processed: patch.processed,
        processedAt: patch.processedAt,
        error: patch.error,
        orderId: patch.orderId,
        purgeAt: patch.purgeAt ?? null,
      },
      { returnDocument: 'after' },
    ).exec();

    return document ? toDomainEntity<ProviderEvent>(document) : null;
  }

  public async listFailed(provider?: ProviderName): Promise<ProviderEvent[]> {
    const documents = await ProviderEventModel.find({
      processed: false,
      ...(provider ? { provider } : {}),
    })
      .sort({ createdAt: 1 })
      .exec();

    return documents.map((document) => toDomainEntity<ProviderEvent>(document));
  }
}
