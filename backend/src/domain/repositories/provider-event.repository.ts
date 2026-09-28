import type { ProviderEvent } from '../entities/provider-event.entity';
import type { ProviderName } from '../../shared/constants/providers';

export interface ProviderEventRepository {
  create(event: ProviderEvent): Promise<ProviderEvent>;
  findByEventKey(eventKey: string): Promise<ProviderEvent | null>;
  findById(id: string): Promise<ProviderEvent | null>;
  listByOrderId(orderId: string): Promise<ProviderEvent[]>;
  markProcessed(
    eventKey: string,
    patch: Pick<ProviderEvent, 'processed' | 'processedAt' | 'error' | 'orderId'> & {
      purgeAt?: Date | null;
    },
  ): Promise<ProviderEvent | null>;
  listFailed(provider?: ProviderName): Promise<ProviderEvent[]>;
}
