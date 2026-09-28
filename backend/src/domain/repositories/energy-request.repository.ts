import type { EnergyRequest } from '../entities/energy-request.entity';

export interface EnergyRequestRepository {
  create(request: EnergyRequest): Promise<EnergyRequest>;
  findLatestByOrderId(orderId: string): Promise<EnergyRequest | null>;
  findActiveByOrderId(orderId: string): Promise<EnergyRequest | null>;
  findReusableConfirmedByAddress(
    receiveAddress: string,
    energyContext: EnergyRequest['energyContext'],
    since: Date,
  ): Promise<EnergyRequest | null>;
  updateById(id: string, patch: Partial<EnergyRequest>): Promise<EnergyRequest | null>;
}
