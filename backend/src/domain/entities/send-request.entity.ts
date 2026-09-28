export interface SendRequest {
  id?: string;
  orderId: string;
  provider: 'cryptocurrencyapi';
  fromAddress: string;
  toAddress: string;
  token: string;
  amount: number;
  providerRequestId: string | null;
  providerResponseRaw: Record<string, unknown> | null;
  txid: string | null;
  status: string;
  requestedAt: Date;
  confirmedAt: Date | null;
  outcomeResolution?: 'CONFIRMED_EXECUTED' | 'CONFIRMED_NOT_EXECUTED' | 'RESOLVED_MANUALLY' | 'CANCELED_BY_PROVIDER' | null;
  outcomeResolvedAt?: Date | null;
  outcomeResolvedBy?: string | null;
  outcomeResolutionReason?: string | null;
  outcomeResolutionReference?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
