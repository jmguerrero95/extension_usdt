import { z } from 'zod';

import { ADMIN_ROLES } from '../../shared/constants/admin-auth';
import { isStrongPassword, STRONG_PASSWORD_MESSAGE } from '../../shared/utils/password-policy';

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  otpCode: z.string().trim().min(6).max(8).optional(),
});

export const stepUpBodySchema = z.object({
  password: z.string().min(1),
  otpCode: z.string().trim().min(6).max(8),
});

export const confirmTwoFactorBodySchema = z.object({
  otpCode: z.string().trim().min(6).max(8),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).refine(isStrongPassword, STRONG_PASSWORD_MESSAGE),
  revokeOtherSessions: z.boolean().optional(),
});

export const createUserBodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(2).max(80),
  role: z.enum(ADMIN_ROLES),
  password: z.string().min(12).refine(isStrongPassword, STRONG_PASSWORD_MESSAGE),
});

export const updateUserBodySchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ADMIN_ROLES).optional(),
  active: z.boolean().optional(),
});

export const resetUserPasswordBodySchema = z.object({
  newPassword: z.string().min(12).refine(isStrongPassword, STRONG_PASSWORD_MESSAGE),
});

export const userParamsSchema = z.object({
  userId: z.string().min(1),
});
