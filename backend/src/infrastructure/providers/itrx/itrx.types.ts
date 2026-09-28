export interface ItrxEstimatedPriceResult {
  period: string;
  energyAmount: number;
  totalPriceSun: number;
  raw: Record<string, unknown>;
}

export interface ItrxAutoDelegateParams {
  period: number;
  receive_address: string;
  max_energy: number;
  callback_url: string;
  out_trade_no: string;
}

export interface ItrxCollectionManualParams {
  scene: number;
  receive_address: string;
  to_address: string;
  callback_url: string;
  out_trade_no: string;
}

export interface ItrxOneOffOrderParams {
  energy_amount: number;
  period: string;
  receive_address: string;
  active: number;
  exclusive: number;
  callback_url: string;
  out_trade_no: string;
}

export interface ItrxAutoDelegateResult {
  errno: number;
  message: string;
  balance: number | null;
  raw: Record<string, unknown>;
}

export interface ItrxCollectionManualResult {
  errno: number;
  message: string;
  serial: string | null;
  scene: number | null;
  amount: number | null;
  balance: number | null;
  raw: Record<string, unknown>;
}

export interface ItrxOneOffOrderResult {
  errno: number;
  message: string;
  serial: string;
  amount: number;
  balance: number;
  raw: Record<string, unknown>;
}

export interface ItrxSmartDelegatePolicyItem {
  id: number | null;
  receiveAddress: string | null;
  status: number | null;
  lastStep: number | null;
  mainDelegated: boolean | null;
  statusDisplay: string | null;
  lastStepDisplay: string | null;
  autoType: number | null;
  autoTypeDisplay: string | null;
  nextDelegateTime: string | null;
  maxEnergy: number | null;
  period: number | null;
  raw: Record<string, unknown>;
}

export interface ItrxSmartDelegatePolicyQueryResult {
  code: number;
  count: number | null;
  results: ItrxSmartDelegatePolicyItem[];
  raw: Record<string, unknown>;
}

export interface ItrxOrderQueryResult {
  errno: number;
  status: number | null;
  serial: string | null;
  receiveAddress: string | null;
  outTradeNo: string | null;
  energyAmount: number | null;
  payAmount: number | null;
  refundAmount: number | null;
  raw: Record<string, unknown>;
}

export interface ItrxCallbackPayload {
  energyAmount: number | null;
  payAmount: number | null;
  serial: string | null;
  txid: string | null;
  status: number | null;
  type: string | null;
  receiveAddress: string | null;
  outTradeNo: string | null;
  source: string | null;
  rawPayload: Record<string, unknown>;
}
