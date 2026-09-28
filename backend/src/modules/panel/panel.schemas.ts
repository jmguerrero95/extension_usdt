import { z } from 'zod';

const datePresetSchema = z.enum(['today', 'week', 'month', 'year', 'custom']);

export const orderParamsSchema = z.object({
  orderId: z.string().min(1),
});

export const orderActionParamsSchema = z.object({
  orderId: z.string().min(1),
  action: z.enum([
    'reconcile',
    'retry-energy',
    'retry-buy-energy',
    'retry-forward',
    'retry-send',
    'mark-manual-review',
    'clear-manual-review',
    'cancel',
    'complete-manually',
    'resolve-outcome-unknown',
  ]),
});

export const orderActionBodySchema = z.object({
  reason: z.string().trim().min(5).max(500),
  reference: z.string().trim().max(200).optional(),
  confirmation: z.boolean().optional(),
  resolution: z.enum(['retry', 'complete', 'cancel']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const addOrderNoteBodySchema = z.object({
  note: z.string().trim().min(2).max(2000),
  escalation: z.boolean().optional(),
});

export const listOrdersQuerySchema = z.object({
  q: z.string().trim().optional(),
  type: z.enum(['BUY', 'SELL']).optional(),
  status: z.string().trim().optional(),
  terminalId: z.string().trim().optional(),
  provider: z.enum(['cryptocurrencyapi', 'itrx']).optional(),
  manualReviewRequired: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  skip: z.coerce.number().int().nonnegative().default(0),
});

export const listAuditLogsQuerySchema = z.object({
  category: z.enum(['auth', 'security', 'orders', 'settings', 'users', 'reports']).optional(),
  action: z.string().trim().optional(),
  actorUserId: z.string().trim().optional(),
  orderId: z.string().trim().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
  skip: z.coerce.number().int().nonnegative().default(0),
});

export const listProviderEventsQuerySchema = z.object({
  provider: z.enum(['cryptocurrencyapi', 'itrx']).optional(),
  processed: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
  orderId: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
  skip: z.coerce.number().int().nonnegative().default(0),
});

export const reportQuerySchema = z.object({
  preset: datePresetSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  timezoneOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
  type: z.enum(['BUY', 'SELL']).optional(),
  status: z.string().trim().optional(),
  terminalId: z.string().trim().optional(),
});

const settingItemSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
});

export const updateSettingsBodySchema = z.object({
  items: z.array(settingItemSchema).min(1),
});

export const testSettingsConnectionBodySchema = z.object({
  provider: z.enum(['cryptocurrencyapi', 'itrx']),
  items: z.array(settingItemSchema).optional(),
});
