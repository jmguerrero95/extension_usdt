export type ExternalCallOutcome =
  | 'DEFINITIVE_REJECTION'
  | 'NOT_SENT'
  | 'ACCEPTED'
  | 'OUTCOME_UNKNOWN';

export type ExternalOperationPhase =
  | 'PREPARING'
  | 'BEFORE_REQUEST'
  | 'CONNECTING'
  | 'REQUEST_WRITING'
  | 'REQUEST_SENT'
  | 'RESPONSE_RECEIVED'
  | 'PERSISTING_ACCEPTED_RESULT'
  | 'TRANSITIONING_ORDER'
  | 'ENQUEUING_NEXT_JOB'
  | 'energy_request'
  | 'forward_request'
  | 'send_request'
  | 'status_query'
  | 'deposit_address';

const AMBIGUOUS_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ERR_SOCKET_CLOSED',
]);

const getObjectDetails = (error: Error): Record<string, unknown> | null => {
  const details = (error as { details?: unknown }).details;
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : null;
};

export const classifyExternalOperationError = (
  error: unknown,
  phase?: ExternalOperationPhase,
): ExternalCallOutcome => {
  if (!(error instanceof Error)) {
    return 'OUTCOME_UNKNOWN';
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && AMBIGUOUS_ERROR_CODES.has(code)) {
    return 'OUTCOME_UNKNOWN';
  }

  const details = getObjectDetails(error);
  const httpStatus = typeof details?.['status'] === 'number' ? details['status'] : null;
  const errno = typeof details?.['errno'] === 'number' ? details['errno'] : null;
  const providerCode = typeof details?.['code'] === 'number' ? details['code'] : null;

  if (httpStatus !== null && httpStatus >= 500) {
    return 'OUTCOME_UNKNOWN';
  }

  if (errno !== null && errno !== 0 && phase === 'RESPONSE_RECEIVED') {
    return 'DEFINITIVE_REJECTION';
  }

  if (providerCode !== null && providerCode !== 0 && phase === 'status_query') {
    return 'DEFINITIVE_REJECTION';
  }

  if (
    error.name.includes('Timeout') ||
    /timeout|socket|parse|malformed|5\d\d/i.test(error.message)
  ) {
    return 'OUTCOME_UNKNOWN';
  }

  if (error.name.includes('BadResponse')) {
    return phase === 'deposit_address' ? 'NOT_SENT' : 'OUTCOME_UNKNOWN';
  }

  if (phase === 'PREPARING' || phase === 'BEFORE_REQUEST') {
    return 'NOT_SENT';
  }

  return 'OUTCOME_UNKNOWN';
};

export const isOutcomeUnknownError = (
  error: unknown,
  phase?: ExternalOperationPhase,
): boolean => classifyExternalOperationError(error, phase) === 'OUTCOME_UNKNOWN';
