const USDT_DECIMALS = 1_000_000;

export const normalizeUsdtAmount = (value: number): number =>
  Math.round(value * USDT_DECIMALS) / USDT_DECIMALS;
