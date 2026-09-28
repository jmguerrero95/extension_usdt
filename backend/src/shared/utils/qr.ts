export const buildTronUsdtQrPayload = (
  depositAddress: string,
  cryptoAmountExpected: number | null,
): string =>
  cryptoAmountExpected !== null
    ? `tron:${depositAddress}?token=USDT&amount=${cryptoAmountExpected}`
    : `tron:${depositAddress}?token=USDT`;
