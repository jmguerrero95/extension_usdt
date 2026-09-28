export const PROVIDERS = {
  CRYPTOCURRENCY_API: 'cryptocurrencyapi',
  ITRX: 'itrx',
} as const;

export type ProviderName = (typeof PROVIDERS)[keyof typeof PROVIDERS];
