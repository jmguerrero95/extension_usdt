import { describe, expect, it } from 'vitest';

import {
  buildItrxSignature,
  canonicalizeJsonForSignature,
  verifyItrxCallbackSignature,
} from '../../infrastructure/providers/itrx/itrx.signature';

describe('itrx.signature', () => {
  it('canonicaliza json en orden alfabetico', () => {
    expect(canonicalizeJsonForSignature({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('verifica firmas HMAC validas', () => {
    const body = { receive_address: 'TADDR', max_energy: 80000 };
    const timestamp = '1700000000';
    const signature = buildItrxSignature('secret', timestamp, body);

    const isValid = verifyItrxCallbackSignature(
      'secret',
      {
        timestamp,
        signature,
      },
      body,
    );

    expect(isValid).toBe(true);
  });
});
