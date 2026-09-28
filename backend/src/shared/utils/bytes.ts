export const parseByteSize = (value: string): number => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+)(b|kb|mb|gb)?$/);

  if (!match) {
    return 1_048_576;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'b';
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
  };

  return amount * (multipliers[unit] ?? 1);
};
