import type { ErrorCode } from '../../shared/constants/error-codes';

interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  statusCode: number;
  details?: unknown;
  cause?: Error;
}

export class AppError extends Error {
  public override readonly name = 'AppError';

  public readonly code: ErrorCode;

  public readonly statusCode: number;

  public readonly details: unknown;

  public override readonly cause?: Error;

  public constructor(options: AppErrorOptions) {
    super(options.message);
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details ?? null;
    this.cause = options.cause;
  }
}
