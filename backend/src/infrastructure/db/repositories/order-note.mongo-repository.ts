import type { OrderNoteRepository } from '../../../domain/repositories/order-note.repository';
import type { OrderNote } from '../../../domain/entities/order-note.entity';
import { OrderNoteModel } from '../models/order-note.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoOrderNoteRepository implements OrderNoteRepository {
  public async create(note: OrderNote): Promise<OrderNote> {
    const document = await OrderNoteModel.create(note);
    return toDomainEntity<OrderNote>(document);
  }

  public async listByOrderId(orderId: string): Promise<OrderNote[]> {
    const documents = await OrderNoteModel.find({ orderId }).sort({ createdAt: -1 }).exec();
    return documents.map((document) => toDomainEntity<OrderNote>(document));
  }
}
