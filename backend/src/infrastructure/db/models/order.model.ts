import { Schema, model, models, type Model } from 'mongoose';

import { ORDER_STATUSES } from '../../../domain/enums/order-status';
import { ORDER_DEPOSIT_OBSERVED_TXID_INDEX } from '../indexes/order-deposit-observed-txid-index';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

export interface OrderDocument {
  orderId: string;
  externalRef: string | null;
  terminalId: string | null;
  type: 'SELL' | 'BUY';
  asset: 'USDT';
  network: 'TRON';
  fiatCurrency: 'COP';
  fiatAmount: number;
  cryptoAmountExpected: number | null;
  cryptoAmountReceived: number | null;
  cryptoAmountToSend: number | null;
  depositAddress: string | null;
  depositAddressPublicKey: string | null;
  depositAddressPrivateKeyStored: boolean;
  depositAddressPrivateKeyEncrypted?: string | null;
  customerDestinationAddress: string | null;
  buySenderAddress: string | null;
  providerUniqId: string;
  providerLabel: string;
  providerGiveRequestRaw: Record<string, unknown> | null;
  providerForwardRequestId: string | null;
  providerForwardTxid: string | null;
  providerSendRequestId: string | null;
  providerSendTxid: string | null;
  forwardTargetAddress: string | null;
  status: (typeof ORDER_STATUSES)[number];
  statusReason: string | null;
  expiresAt: Date;
  depositObservedAt?: Date | null;
  depositObservedAmount?: number | null;
  depositObservedTxid?: string | null;
  depositObservedConfirmations?: number | null;
  depositObservedSource?: 'webhook' | 'trongrid' | null;
  depositObservedLastCheckedAt?: Date | null;
  depositDetectedAt: Date | null;
  cashPayoutEligibleAt?: Date | null;
  cashPayoutConfirmedAt?: Date | null;
  cashPayoutCasTransactionId?: string | null;
  cashPayoutTerminalId?: string | null;
  energyEstimatedAt: Date | null;
  energyRequestedAt: Date | null;
  energyConfirmedAt: Date | null;
  forwardRequestedAt: Date | null;
  sweepConfirmedAt: Date | null;
  settlementCompletedAt?: Date | null;
  sendRequestedAt: Date | null;
  sendBroadcastedAt?: Date | null;
  sendConfirmedAt: Date | null;
  completedAt: Date | null;
  manualReviewRequired: boolean;
  manualReviewCode?: string | null;
  interruptedAt?: Date | null;
  interruptedByBootId?: string | null;
  statusBeforeManualReview?: (typeof ORDER_STATUSES)[number] | null;
  startupQuarantineGeneration?: string | null;
  resolvedManually?: boolean;
  manualResolutionType?: 'COMPLETED' | 'CANCELED' | null;
  manualResolutionReason?: string | null;
  manualResolutionReference?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  recoveryGeneration?: number;
  resumedAt?: Date | null;
  resumedBy?: string | null;
  authorizedBootId?: string | null;
  authorizedRecoveryGeneration?: number | null;
  authorizedAt?: Date | null;
  authorizedBy?: string | null;
  outcomeResolution?: 'CONFIRMED_EXECUTED' | 'CONFIRMED_NOT_EXECUTED' | 'RESOLVED_MANUALLY' | 'CANCELED_BY_PROVIDER' | null;
  outcomeResolvedAt?: Date | null;
  outcomeResolvedBy?: string | null;
  lastErrorCode: (typeof ERROR_CODES)[number] | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const orderSchema = new Schema<OrderDocument>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    externalRef: { type: String, default: null, index: true },
    terminalId: { type: String, default: null, index: true },
    type: { type: String, required: true, enum: ['SELL', 'BUY'] },
    asset: { type: String, required: true, enum: ['USDT'] },
    network: { type: String, required: true, enum: ['TRON'] },
    fiatCurrency: { type: String, required: true, enum: ['COP'] },
    fiatAmount: { type: Number, required: true },
    cryptoAmountExpected: { type: Number, default: null },
    cryptoAmountReceived: { type: Number, default: null },
    cryptoAmountToSend: { type: Number, default: null },
    depositAddress: { type: String, default: null, index: true },
    depositAddressPublicKey: { type: String, default: null },
    depositAddressPrivateKeyStored: { type: Boolean, required: true, default: false },
    depositAddressPrivateKeyEncrypted: { type: String, default: null, select: false },
    customerDestinationAddress: { type: String, default: null, index: true },
    buySenderAddress: { type: String, default: null, index: true },
    providerUniqId: { type: String, required: true, unique: true, index: true },
    providerLabel: { type: String, required: true },
    providerGiveRequestRaw: { type: Schema.Types.Mixed, default: null },
    providerForwardRequestId: { type: String, default: null },
    providerForwardTxid: { type: String, default: null },
    providerSendRequestId: { type: String, default: null, index: true },
    providerSendTxid: { type: String, default: null, index: true },
    forwardTargetAddress: { type: String, default: null },
    status: { type: String, required: true, enum: ORDER_STATUSES, index: true },
    statusReason: { type: String, default: null },
    expiresAt: { type: Date, required: true, index: true },
    depositObservedAt: { type: Date, default: null, index: true },
    depositObservedAmount: { type: Number, default: null },
    depositObservedTxid: { type: String, default: null },
    depositObservedConfirmations: { type: Number, default: null },
    depositObservedSource: { type: String, enum: ['webhook', 'trongrid', null], default: null },
    depositObservedLastCheckedAt: { type: Date, default: null },
    depositDetectedAt: { type: Date, default: null },
    cashPayoutEligibleAt: { type: Date, default: null, index: true },
    cashPayoutConfirmedAt: { type: Date, default: null, index: true },
    cashPayoutCasTransactionId: { type: String, default: null, index: true },
    cashPayoutTerminalId: { type: String, default: null, index: true },
    energyEstimatedAt: { type: Date, default: null },
    energyRequestedAt: { type: Date, default: null },
    energyConfirmedAt: { type: Date, default: null },
    forwardRequestedAt: { type: Date, default: null },
    sweepConfirmedAt: { type: Date, default: null },
    settlementCompletedAt: { type: Date, default: null, index: true },
    sendRequestedAt: { type: Date, default: null },
    sendBroadcastedAt: { type: Date, default: null },
    sendConfirmedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    manualReviewRequired: { type: Boolean, required: true, default: false },
    manualReviewCode: { type: String, default: null, index: true },
    interruptedAt: { type: Date, default: null },
    interruptedByBootId: { type: String, default: null },
    statusBeforeManualReview: { type: String, enum: ORDER_STATUSES, default: null },
    startupQuarantineGeneration: { type: String, default: null, index: true },
    resolvedManually: { type: Boolean, default: false, index: true },
    manualResolutionType: { type: String, enum: ['COMPLETED', 'CANCELED', null], default: null },
    manualResolutionReason: { type: String, default: null },
    manualResolutionReference: { type: String, default: null },
    resolvedBy: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    recoveryGeneration: { type: Number, default: 0 },
    resumedAt: { type: Date, default: null },
    resumedBy: { type: String, default: null },
    authorizedBootId: { type: String, default: null, index: true },
    authorizedRecoveryGeneration: { type: Number, default: null },
    authorizedAt: { type: Date, default: null },
    authorizedBy: { type: String, default: null },
    outcomeResolution: {
      type: String,
      enum: ['CONFIRMED_EXECUTED', 'CONFIRMED_NOT_EXECUTED', 'RESOLVED_MANUALLY', 'CANCELED_BY_PROVIDER', null],
      default: null,
    },
    outcomeResolvedAt: { type: Date, default: null },
    outcomeResolvedBy: { type: String, default: null },
    lastErrorCode: { type: String, enum: ERROR_CODES, default: null },
    lastErrorMessage: { type: String, default: null },
  },
  {
    collection: 'orders',
    timestamps: true,
    versionKey: false,
  },
);

orderSchema.index({ createdAt: 1 });
orderSchema.index(
  ORDER_DEPOSIT_OBSERVED_TXID_INDEX.key,
  {
    name: ORDER_DEPOSIT_OBSERVED_TXID_INDEX.name,
    unique: ORDER_DEPOSIT_OBSERVED_TXID_INDEX.unique,
    partialFilterExpression: ORDER_DEPOSIT_OBSERVED_TXID_INDEX.partialFilterExpression,
  },
);

export const OrderModel: Model<OrderDocument> =
  (models['Order'] as Model<OrderDocument> | undefined) ??
  model<OrderDocument>('Order', orderSchema);
