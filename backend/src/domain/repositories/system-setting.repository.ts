import type { SystemSetting } from '../entities/system-setting.entity';

export interface SystemSettingRepository {
  findByKey(key: string): Promise<SystemSetting | null>;
  list(): Promise<SystemSetting[]>;
  upsertByKey(
    key: string,
    patch: Omit<SystemSetting, 'id' | 'key' | 'createdAt' | 'updatedAt'>,
  ): Promise<SystemSetting>;
}
