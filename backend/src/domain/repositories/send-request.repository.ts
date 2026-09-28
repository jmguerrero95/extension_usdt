import type { SendRequest } from '../entities/send-request.entity';

export interface SendRequestRepository {
  create(request: SendRequest): Promise<SendRequest>;
  findLatestByOrderId(orderId: string): Promise<SendRequest | null>;
  findActiveByOrderId(orderId: string): Promise<SendRequest | null>;
  updateById(id: string, patch: Partial<SendRequest>): Promise<SendRequest | null>;
}
