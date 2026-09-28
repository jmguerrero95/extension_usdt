import type { IncomingHttpHeaders } from 'node:http';

import { canonicalizeJson } from '../../../shared/utils/canonicalize-json';
import { hmacSha256, safeEqual } from '../../../shared/utils/hash';

export const canonicalizeJsonForSignature = (value: unknown): string => canonicalizeJson(value);

export const buildItrxSignature = (
  secret: string,
  timestamp: string,
  body: Record<string, unknown>,
): string => hmacSha256(secret, `${timestamp}&${canonicalizeJsonForSignature(body)}`);

export const buildItrxSignatureFromCanonicalJson = (
  secret: string,
  timestamp: string,
  canonicalJsonBody: string,
): string => hmacSha256(secret, `${timestamp}&${canonicalJsonBody}`);

export const verifyItrxCallbackSignature = (
  secret: string,
  headers: IncomingHttpHeaders,
  body: Record<string, unknown>,
): boolean => {
  const timestampHeader = headers['timestamp'];
  const signatureHeader = headers['signature'];

  if (typeof timestampHeader !== 'string' || typeof signatureHeader !== 'string') {
    return false;
  }

  const expectedSignature = buildItrxSignature(secret, timestampHeader, body);
  return safeEqual(signatureHeader, expectedSignature);
};
