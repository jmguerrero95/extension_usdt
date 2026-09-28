import type { ErrorCode } from '../../shared/constants/error-codes';

export class DomainError extends Error {
  public readonly code: ErrorCode;

  public readonly statusCode: number;

  public readonly details: unknown;

  public constructor(
    code: ErrorCode,
    message: string,
    statusCode = 422,
    details: unknown = null,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
