export class CryptoCurrencyApiTimeoutError extends Error {
  public constructor(message = 'Timeout al invocar CryptoCurrencyAPI.') {
    super(message);
    this.name = 'CryptoCurrencyApiTimeoutError';
  }
}

export class CryptoCurrencyApiBadResponseError extends Error {
  public readonly details: unknown;

  public constructor(message: string, details: unknown = null) {
    super(message);
    this.name = 'CryptoCurrencyApiBadResponseError';
    this.details = details;
  }
}
