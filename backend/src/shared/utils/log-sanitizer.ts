const SENSITIVE_KEY_PATTERN = /(api[-_]?key|secret|private[-_]?key|signature|authorization)/i;

export const sanitizeForLogs = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLogs);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeForLogs(entryValue),
      ]),
    );
  }

  return value;
};
