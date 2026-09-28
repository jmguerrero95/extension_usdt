import type { ZodError } from 'zod';

export const formatZodError = (error: ZodError): Array<{
  path: string;
  message: string;
  code: string;
}> =>
  error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
