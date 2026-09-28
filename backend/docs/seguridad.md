# Seguridad

## Autenticacion

- `X-API-Key` separada para CAS e internos
- comparacion contra secretos de entorno
- webhooks sin API key
- panel web con sesión `HttpOnly`, CSRF, 2FA TOTP obligatorio y bloqueo temporal por intentos fallidos

## Webhooks y firmas

### CryptoCurrencyAPI

- usa `rawBody`
- puede usar allowlist opcional por IP
- idempotencia por `eventKey`
- nunca usa el payload crudo como estado interno; primero pasa por un normalizador

### iTRX

- firma HMAC SHA256
- string firmado: `timestamp + "&" + canonical_json_body`
- `canonical_json_body` ordena claves alfabeticamente y serializa sin espacios extra
- validacion de antiguedad con `ITRX_CALLBACK_MAX_AGE_SEC`
- si firma o timestamp fallan:
  - se persiste `provider_events`
  - no se procesa negocio
  - se responde `401`

## Locks

- `lockKey = order:{orderId}`
- TTL configurable por `LOCK_TTL_SEC`
- evita:
  - doble energy request SELL
  - doble energy request BUY
  - doble forward SELL
  - doble send BUY
- si no se adquiere el lock:
  - se responde o reencola con `LOCK_NOT_ACQUIRED`

## Rate limit y headers

- `@fastify/rate-limit` global configurable
- `Helmet` activo
- `CORS` configurable por entorno
- `X-Request-Id` se propaga si llega; si no, se genera

## Manejo de secretos

- todo secreto vive en `.env`
- private keys nunca se loggean
- private keys nunca se guardan en texto plano
- si `STORE_ENCRYPTED_PRIVATE_KEYS=true`, se cifran con AES-256-GCM
- los secretos del panel (`PANEL_ENCRYPTION_SECRET`) cifran:
  - secretos TOTP
  - overrides sensibles guardados desde UI
- el panel nunca reexpone el secreto completo; solo muestra valores enmascarados

## Panel interno

- el frontend nunca decide permisos; todas las rutas del panel validan rol en backend
- las rutas mutables exigen `x-csrf-token`
- operaciones críticas exigen step-up auth reciente
- cambios de usuarios, settings, 2FA, password y acciones sobre órdenes generan `admin_audit_logs`
- reset de password o 2FA invalida sesiones activas del usuario afectado

## Logs

- Pino JSON
- redaccion de headers y secretos sensibles
- contexto operativo posible:
  - `requestId`
  - `orderId`
  - `externalRef`
  - `terminalId`
  - `provider`
  - `providerRequestId`
  - `txid`
  - `jobId`

## Riesgos conocidos

- la semantica exacta de algunos payloads externos puede variar; por eso se usa normalizacion tolerante
- la reutilizacion de energia BUY se basa en confirmaciones vigentes observadas por la aplicacion, no en una lectura on-chain en tiempo real
- si un proveedor cambia el contrato sin versionado, el normalizador debe ajustarse
- la extension GENERAL BYTES reporta un balance sintetico porque el backend actual no expone un endpoint de balance compatible con las expectativas de CAS; no debe interpretarse como saldo on-chain real
- la extension se endurecio para una sola configuracion segura por instancia CAS, porque la API publica no expone un punto equivalente a `findSellWallet()` para resolver multiples wallets SELL de forma fiable
