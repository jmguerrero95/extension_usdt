import { describe, expect, it } from 'vitest';

import { classifyExternalOperationError } from '../../domain/services/external-operation-outcome.service';

describe('external-operation-outcome.service', () => {
  it('clasifica validacion local previa al request como NOT_SENT', () => {
    expect(classifyExternalOperationError(new Error('missing local secret'), 'PREPARING')).toBe(
      'NOT_SENT',
    );
  });

  it('mantiene timeout/reset/pipe como OUTCOME_UNKNOWN despues de iniciar request', () => {
    for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT']) {
      const error = new Error(code) as Error & { code: string };
      error.code = code;
      expect(classifyExternalOperationError(error, 'REQUEST_SENT')).toBe('OUTCOME_UNKNOWN');
    }
  });

  it('mantiene 5xx y errores desconocidos como OUTCOME_UNKNOWN por defecto', () => {
    const httpError = new Error('provider 500') as Error & { details: unknown };
    httpError.details = { status: 500 };

    expect(classifyExternalOperationError(httpError, 'RESPONSE_RECEIVED')).toBe('OUTCOME_UNKNOWN');
    expect(classifyExternalOperationError(new Error('strange failure'), 'REQUEST_SENT')).toBe(
      'OUTCOME_UNKNOWN',
    );
  });

  it('solo usa rechazo definitivo con codigo explicito de respuesta recibida', () => {
    const error = new Error('provider rejected') as Error & { details: unknown };
    error.details = { errno: 41 };

    expect(classifyExternalOperationError(error, 'RESPONSE_RECEIVED')).toBe(
      'DEFINITIVE_REJECTION',
    );
  });
});
