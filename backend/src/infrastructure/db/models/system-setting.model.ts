import { Schema, model, models, type Model } from 'mongoose';

export interface SystemSettingDocument {
  key: string;
  category: string;
  description: string;
  isSecret: boolean;
  valueEncrypted: string | null;
  valuePlain: string | null;
  updatedByUserId: string | null;
  updatedByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const systemSettingSchema = new Schema<SystemSettingDocument>(
  {
    key: { type: String, required: true, unique: true, index: true },
    category: { type: String, required: true, index: true },
    description: { type: String, required: true },
    isSecret: { type: Boolean, required: true, default: false },
    valueEncrypted: { type: String, default: null, select: false },
    valuePlain: { type: String, default: null },
    updatedByUserId: { type: String, default: null },
    updatedByEmail: { type: String, default: null },
  },
  {
    collection: 'system_settings',
    timestamps: true,
    versionKey: false,
  },
);

export const SystemSettingModel: Model<SystemSettingDocument> =
  (models['SystemSetting'] as Model<SystemSettingDocument> | undefined) ??
  model<SystemSettingDocument>('SystemSetting', systemSettingSchema);
