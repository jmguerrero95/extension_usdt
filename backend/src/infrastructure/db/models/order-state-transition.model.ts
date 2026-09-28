import { Schema, model, models, type Model } from 'mongoose';

import { ORDER_STATUSES } from '../../../domain/enums/order-status';

export interface OrderStateTransitionDocument {
  orderId: string;
  fromStatus: (typeof ORDER_STATUSES)[number];
  toStatus: (typeof ORDER_STATUSES)[number];
  reason: string;
  actorType: string;
  actorId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

const orderStateTransitionSchema = new Schema<OrderStateTransitionDocument>(
  {
    orderId: { type: String, required: true, index: true },
    fromStatus: { type: String, required: true, enum: ORDER_STATUSES },
    toStatus: { type: String, required: true, enum: ORDER_STATUSES },
    reason: { type: String, required: true },
    actorType: { type: String, required: true },
    actorId: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  {
    collection: 'order_state_transitions',
    versionKey: false,
  },
);

orderStateTransitionSchema.index({ orderId: 1, createdAt: 1 });

export const OrderStateTransitionModel: Model<OrderStateTransitionDocument> =
  (models['OrderStateTransition'] as Model<OrderStateTransitionDocument> | undefined) ??
  model<OrderStateTransitionDocument>('OrderStateTransition', orderStateTransitionSchema);
