# ADMIN_PANEL_IMPLEMENTATION

## Objetivo

Se extendió el backend actual BUY/SELL sin rehacer su core para agregar un panel web interno de operaciones y administración, servido por la misma aplicación Fastify en `GET /panel`.

La decisión principal fue mantener una sola arquitectura:

- mismo backend Fastify
- mismas entidades de negocio BUY/SELL
- mismos servicios existentes para energía, forward, send y reconciliación
- frontend estático ligero servido por Fastify, sin introducir una segunda cadena de build

## Arquitectura aplicada

### Backend

Se agregaron servicios y rutas nuevas dentro de `src/modules/panel/`:

- `PanelAuthService`
- `PanelUsersService`
- `PanelSettingsService`
- `PanelConsoleService`
- `AdminAuditService`

El dominio BUY/SELL existente no se duplicó. El panel reusa:

- `OrdersService`
- `EnergyService`
- `ForwardsService`
- `ReconciliationService`
- `AuditService`

### Frontend

Se agregó una SPA interna ligera servida desde:

- `panel/index.html`
- `panel/styles.css`
- `panel/app.js`

Se publica con Fastify en:

- UI: `GET /panel`
- assets: `/panel/assets/*`
- API del panel: `/panel/api/*`

## Módulos creados

### Seguridad y acceso

- sesión web interna con cookie `HttpOnly`
- token CSRF por sesión
- 2FA TOTP obligatorio
- step-up auth para acciones sensibles
- lockout temporal ante intentos fallidos

### Operación

- dashboard operativo
- listado y detalle de órdenes
- notas internas por orden
- acciones manuales controladas
- auditoría operativa
- reportes con exportación CSV
- configuración operativa segura
- gestión de usuarios internos
- perfil y actividad de seguridad

## Roles y permisos

Roles soportados:

- `support`
- `operations`
- `supervisor`
- `admin`

Principio aplicado:

- el frontend solo oculta acciones
- el backend decide permisos reales por ruta y acción

Permisos relevantes:

- `dashboard:view`
- `orders:view`
- `orders:note`
- `orders:reconcile`
- `orders:retry-energy`
- `orders:retry-forward`
- `orders:retry-send`
- `orders:manual-review`
- `orders:clear-manual-review`
- `orders:cancel`
- `orders:complete-manually`
- `audit:view`
- `reports:view`
- `settings:view`
- `settings:manage`
- `users:view`
- `users:manage`
- `profile:manage`

## Endpoints agregados

### UI

- `GET /panel`

### Auth del panel

- `POST /panel/api/auth/login`
- `GET /panel/api/auth/me`
- `POST /panel/api/auth/logout`
- `POST /panel/api/auth/step-up`
- `POST /panel/api/auth/2fa/setup`
- `POST /panel/api/auth/2fa/confirm`
- `POST /panel/api/auth/password/change`
- `GET /panel/api/auth/sessions`
- `POST /panel/api/auth/sessions/close-others`

### Operación del panel

- `GET /panel/api/dashboard`
- `GET /panel/api/orders`
- `GET /panel/api/orders/:orderId`
- `POST /panel/api/orders/:orderId/notes`
- `POST /panel/api/orders/:orderId/actions/:action`
- `GET /panel/api/audit/logs`
- `GET /panel/api/provider-events`
- `GET /panel/api/reports/orders`
- `GET /panel/api/reports/orders/export.csv`
- `GET /panel/api/settings`
- `PUT /panel/api/settings`
- `GET /panel/api/users`
- `POST /panel/api/users`
- `PATCH /panel/api/users/:userId`
- `POST /panel/api/users/:userId/reset-password`
- `POST /panel/api/users/:userId/reset-2fa`
- `GET /panel/api/profile/activity`

## Colecciones agregadas

- `internal_users`
- `admin_sessions`
- `admin_audit_logs`
- `order_notes`
- `system_settings`

Estas colecciones conviven con las ya existentes:

- `orders`
- `provider_events`
- `energy_requests`
- `forward_requests`
- `send_requests`
- `order_state_transitions`
- `distributed_locks`
- `outbox_jobs`

## Decisiones de seguridad

### Sesiones

- la cookie del panel es `HttpOnly`
- `SameSite=Strict`
- el token real de sesión no se guarda en claro en Mongo; se guarda `sessionTokenHash`

### 2FA

- es obligatorio para liberar el panel
- en el primer login del bootstrap admin se fuerza setup antes de continuar
- los secretos TOTP se guardan cifrados

### Step-up auth

Se exige para:

- guardar configuración sensible
- crear o modificar usuarios
- resetear password de otro usuario
- resetear 2FA de otro usuario
- ciertas acciones manuales críticas sobre órdenes

### CSRF

- todas las rutas mutables del panel usan `x-csrf-token`

### Auditoría

Se auditan:

- login exitoso y fallido
- logout
- step-up auth
- configuración / confirmación 2FA
- cambio de contraseña
- cierre de otras sesiones
- altas y cambios de usuarios
- reset de password y 2FA
- notas operativas
- acciones manuales sobre órdenes
- cambios de settings

## Cómo funcionan las acciones manuales

El panel no duplica la lógica del dominio. Las acciones llaman directamente a los servicios ya existentes:

- reconciliar -> `ReconciliationService`
- reintentar energía -> `EnergyService`
- reintentar forward/send -> `ForwardsService`
- marcar revisión manual -> `OrdersService.markManualReview`
- quitar revisión manual -> transición controlada `ERROR_MANUAL_REVIEW -> ERROR_RETRYABLE`
- cancelar -> `OrdersService.cancelBuyOrder` / `cancelSellOrder`
- cierre manual -> solo BUY y solo con evidencia suficiente (`DELIVERY_CONFIRMED` o `READY_FOR_PAYOUT`)

Para SELL se mantuvo una política más restrictiva: no se agregó “cierre forzado” genérico.

## Cómo funcionan los reportes

El panel consulta Mongo y construye:

- resumen agregado
- filas de órdenes filtradas
- exportación CSV

PDF no se generó server-side para no introducir complejidad innecesaria. La UI deja explícito que el camino soportado es:

- exportar CSV
- imprimir / guardar como PDF desde el navegador

## Cómo se protegen credenciales y configuración

### Credenciales del panel

- password con `argon2id`
- secretos TOTP cifrados con `PANEL_ENCRYPTION_SECRET`

### Settings operativos

- los secretos guardados desde UI se cifran
- la UI solo muestra valores enmascarados
- los cambios quedan auditados
- los overrides se aplican en el siguiente reinicio de la aplicación

Esta decisión fue deliberadamente conservadora: evita hot-reload riesgoso de credenciales de proveedor y mantiene intacto el core actual.

## Bootstrap inicial

Para crear el primer admin:

- `PANEL_BOOTSTRAP_ADMIN_EMAIL`
- `PANEL_BOOTSTRAP_ADMIN_PASSWORD`
- `PANEL_BOOTSTRAP_ADMIN_NAME`

Si no existen usuarios internos, el bootstrap crea ese admin al arrancar.

## Pendientes o límites

- Los endpoints del panel quedaron funcionales, pero su documentación Swagger es más liviana que la del contrato CAS.
- Los overrides de `system_settings` aplican al siguiente reinicio, no en caliente.
- La SPA es deliberadamente simple y sin framework para evitar una segunda arquitectura de build; si el panel crece mucho, el siguiente paso natural sería migrar esa capa a un frontend compilado dedicado sin tocar el backend ya creado.
