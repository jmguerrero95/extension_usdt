export const calculateExponentialBackoff = (
  attempts: number,
  baseDelayMs: number,
  capMs = 60_000,
): number => Math.min(baseDelayMs * 2 ** Math.max(attempts - 1, 0), capMs);
