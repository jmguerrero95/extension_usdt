import type { ForwardRequest } from '../entities/forward-request.entity';

export interface ForwardRequestRepository {
  create(request: ForwardRequest): Promise<ForwardRequest>;
  findLatestByOrderId(orderId: string): Promise<ForwardRequest | null>;
  findActiveByOrderId(orderId: string): Promise<ForwardRequest | null>;
  updateById(id: string, patch: Partial<ForwardRequest>): Promise<ForwardRequest | null>;
}
