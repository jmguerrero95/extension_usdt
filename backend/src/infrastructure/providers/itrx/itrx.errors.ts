export class ItrxTimeoutError extends Error {
  public constructor(message = 'Timeout al invocar iTRX.') {
    super(message);
    this.name = 'ItrxTimeoutError';
  }
}

export class ItrxBadResponseError extends Error {
  public readonly details: unknown;

  public constructor(message: string, details: unknown = null) {
    super(message);
    this.name = 'ItrxBadResponseError';
    this.details = details;
  }
}
