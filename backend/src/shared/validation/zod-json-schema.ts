import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const toOpenApiSchema = (
  schema: ZodTypeAny,
  options?: {
    description?: string;
    examples?: unknown[];
  },
): Record<string, unknown> => {
  const baseSchema = (
    zodToJsonSchema as unknown as (
      input: unknown,
      options: Record<string, unknown>,
    ) => Record<string, unknown>
  )(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  });

  return {
    ...baseSchema,
    ...(options?.description ? { description: options.description } : {}),
    ...(options?.examples ? { examples: options.examples } : {}),
  };
};
