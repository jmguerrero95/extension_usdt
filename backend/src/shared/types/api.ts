import type { ErrorCode } from '../constants/error-codes';

export interface ApiMeta {
  requestId: string;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details: unknown;
  };
  meta: ApiMeta;
}
