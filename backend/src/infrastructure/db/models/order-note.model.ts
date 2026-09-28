import { Schema, model, models, type Model } from 'mongoose';

import { ADMIN_ROLES } from '../../../shared/constants/admin-auth';

export interface OrderNoteDocument {
  orderId: string;
  authorUserId: string;
  authorDisplayName: string;
  authorRole: (typeof ADMIN_ROLES)[number];
  note: string;
  escalation: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const orderNoteSchema = new Schema<OrderNoteDocument>(
  {
    orderId: { type: String, required: true, index: true },
    authorUserId: { type: String, required: true, index: true },
    authorDisplayName: { type: String, required: true },
    authorRole: { type: String, required: true, enum: ADMIN_ROLES },
    note: { type: String, required: true },
    escalation: { type: Boolean, required: true, default: false },
  },
  {
    collection: 'order_notes',
    timestamps: true,
    versionKey: false,
  },
);

orderNoteSchema.index({ orderId: 1, createdAt: -1 });

export const OrderNoteModel: Model<OrderNoteDocument> =
  (models['OrderNote'] as Model<OrderNoteDocument> | undefined) ??
  model<OrderNoteDocument>('OrderNote', orderNoteSchema);
