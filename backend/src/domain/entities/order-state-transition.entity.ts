import type { OrderStatus } from '../enums/order-status';

export interface OrderStateTransition {
  id?: string;
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  reason: string;
  actorType: string;
  actorId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
