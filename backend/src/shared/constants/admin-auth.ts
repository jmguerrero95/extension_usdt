export const ADMIN_ROLES = ['support', 'operations', 'supervisor', 'admin'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  'dashboard:view',
  'orders:view',
  'orders:note',
  'orders:reconcile',
  'orders:retry-energy',
  'orders:retry-forward',
  'orders:retry-send',
  'orders:manual-review',
  'orders:clear-manual-review',
  'orders:cancel',
  'orders:complete-manually',
  'audit:view',
  'reports:view',
  'settings:view',
  'settings:manage',
  'maintenance:storage',
  'users:view',
  'users:manage',
  'profile:manage',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const PERMISSIONS_BY_ROLE: Record<AdminRole, AdminPermission[]> = {
  support: [
    'dashboard:view',
    'orders:view',
    'orders:note',
    'audit:view',
    'reports:view',
    'profile:manage',
  ],
  operations: [
    'dashboard:view',
    'orders:view',
    'orders:note',
    'orders:reconcile',
    'orders:retry-energy',
    'orders:retry-forward',
    'orders:retry-send',
    'orders:manual-review',
    'audit:view',
    'reports:view',
    'profile:manage',
  ],
  supervisor: [
    'dashboard:view',
    'orders:view',
    'orders:note',
    'orders:reconcile',
    'orders:retry-energy',
    'orders:retry-forward',
    'orders:retry-send',
    'orders:manual-review',
    'orders:clear-manual-review',
    'orders:cancel',
    'orders:complete-manually',
    'audit:view',
    'reports:view',
    'settings:view',
    'users:view',
    'profile:manage',
  ],
  admin: [...ADMIN_PERMISSIONS],
};

export const roleHasPermission = (
  role: AdminRole,
  permission: AdminPermission,
): boolean => PERMISSIONS_BY_ROLE[role].includes(permission);
