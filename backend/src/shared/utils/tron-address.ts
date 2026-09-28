const TRON_ADDRESS_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export const isValidTronAddress = (value: string): boolean => TRON_ADDRESS_REGEX.test(value);
