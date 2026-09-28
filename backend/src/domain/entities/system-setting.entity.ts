export interface SystemSetting {
  id?: string;
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
