import type { ErrorCode } from '../constants/error-codes';
import type { ErrorResponse, SuccessResponse } from '../types/api';

export const buildSuccessResponse = <T>(requestId: string, data: T): SuccessResponse<T> => ({
  success: true,
  data,
  meta: {
    requestId,
  },
});

export const buildErrorResponse = (
  requestId: string,
  code: ErrorCode,
  message: string,
  details: unknown = null,
): ErrorResponse => ({
  success: false,
  error: {
    code,
    message,
    details,
  },
  meta: {
    requestId,
  },
});
