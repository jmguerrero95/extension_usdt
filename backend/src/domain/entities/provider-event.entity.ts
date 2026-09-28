import type { ProviderName } from '../../shared/constants/providers';

export interface ProviderEvent {
  id?: string;
  provider: ProviderName;
  eventType: string;
  eventKey: string;
  orderId: string | null;
  headers: Record<string, string | string[] | undefined>;
  payload: Record<string, unknown>;
  rawBody: string | null;
  signatureValid: boolean | null;
  processed: boolean;
  processedAt: Date | null;
  error: Record<string, unknown> | null;
  purgeAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
