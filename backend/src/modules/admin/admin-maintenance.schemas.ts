import { z } from 'zod';

export const storageMaintenanceCollectionSchema = z.enum(['outbox_reconcile']);

export const storageCleanupBodySchema = z
  .object({
    confirmation: z.boolean(),
    dryRun: z.boolean(),
    olderThanDays: z.coerce.number().int().min(1).max(3650),
    batchSize: z.coerce.number().int().min(100).max(2000),
    maxBatches: z.coerce.number().int().min(1).max(100),
    collections: z.array(storageMaintenanceCollectionSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (!value.dryRun && value.confirmation !== true) {
      ctx.addIssue({
        code: 'custom',
        message: 'La confirmacion explicita es obligatoria para aplicar la limpieza.',
        path: ['confirmation'],
      });
    }
  });
