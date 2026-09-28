import type { OrderStateTransitionRepository } from '../../../domain/repositories/order-state-transition.repository';
import type { OrderStateTransition } from '../../../domain/entities/order-state-transition.entity';
import { OrderStateTransitionModel } from '../models/order-state-transition.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoOrderStateTransitionRepository implements OrderStateTransitionRepository {
  public async create(transition: OrderStateTransition): Promise<OrderStateTransition> {
    const document = await OrderStateTransitionModel.create(transition);
    return toDomainEntity<OrderStateTransition>(document);
  }

  public async listByOrderId(orderId: string): Promise<OrderStateTransition[]> {
    const documents = await OrderStateTransitionModel.find({ orderId }).sort({ createdAt: 1 }).exec();
    return documents.map((document) => toDomainEntity<OrderStateTransition>(document));
  }
}
