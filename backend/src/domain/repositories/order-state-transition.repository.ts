import type { OrderStateTransition } from '../entities/order-state-transition.entity';

export interface OrderStateTransitionRepository {
  create(transition: OrderStateTransition): Promise<OrderStateTransition>;
  listByOrderId(orderId: string): Promise<OrderStateTransition[]>;
}
