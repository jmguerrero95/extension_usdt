import type { SystemSettingRepository } from '../../../domain/repositories/system-setting.repository';
import type { SystemSetting } from '../../../domain/entities/system-setting.entity';
import { SystemSettingModel } from '../models/system-setting.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoSystemSettingRepository implements SystemSettingRepository {
  public async findByKey(key: string): Promise<SystemSetting | null> {
    const document = await SystemSettingModel.findOne({ key }).select('+valueEncrypted').exec();
    return document ? toDomainEntity<SystemSetting>(document) : null;
  }

  public async list(): Promise<SystemSetting[]> {
    const documents = await SystemSettingModel.find({}).sort({ category: 1, key: 1 }).select('+valueEncrypted').exec();
    return documents.map((document) => toDomainEntity<SystemSetting>(document));
  }

  public async upsertByKey(
    key: string,
    patch: Omit<SystemSetting, 'id' | 'key' | 'createdAt' | 'updatedAt'>,
  ): Promise<SystemSetting> {
    const document = await SystemSettingModel.findOneAndUpdate(
      { key },
      {
        ...patch,
        key,
      },
      {
        upsert: true,
        returnDocument: 'after',
      },
    )
      .select('+valueEncrypted')
      .exec();

    return toDomainEntity<SystemSetting>(document);
  }
}
