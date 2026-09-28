import type { OrderNote } from '../entities/order-note.entity';

export interface OrderNoteRepository {
  create(note: OrderNote): Promise<OrderNote>;
  listByOrderId(orderId: string): Promise<OrderNote[]>;
}
