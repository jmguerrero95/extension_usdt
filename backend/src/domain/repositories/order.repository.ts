import type { Order } from '../entities/order.entity';
import type { OrderStatus } from '../enums/order-status';

export interface OrderRepository {
  create(order: Order): Promise<Order>;
  findByOrderId(orderId: string): Promise<Order | null>;
  findByCorrelation(params: {
    providerUniqId?: string | null;
    providerLabel?: string | null;
    depositAddress?: string | null;
    providerRequestId?: string | null;
  }): Promise<Order | null>;
  update(orderId: string, patch: Partial<Order>): Promise<Order | null>;
  updateStatus(
    orderId: string,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    patch?: Partial<Order>,
  ): Promise<Order | null>;
  list(filters?: {
    status?: string;
    terminalId?: string;
    externalRef?: string;
    limit?: number;
    skip?: number;
  }): Promise<Order[]>;
  findExpirable(referenceDate: Date): Promise<Order[]>;
  findExpirableCreatedSince(referenceDate: Date, createdSince: Date): Promise<Order[]>;
  findOpenOrders(limit?: number): Promise<Order[]>;
  findLegacyOpenOrders(params: {
    referenceDate: Date;
    afterId?: string | null;
    limit?: number;
  }): Promise<Order[]>;
}
