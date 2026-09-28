# Variables de entorno

## Aplicacion

- `NODE_ENV`: `development`, `test` o `production`
- `PORT`: puerto HTTP
- `LOG_LEVEL`: nivel de Pino
- `API_BASE_URL`: URL publica base usada para construir `statusURL` y callbacks
- `MONGODB_URI`: URI de conexion Mongo
- `MONGODB_DB_NAME`: nombre de base

## API keys propias

- `CAS_API_KEY`: protege `/api/v1/cas/*`
- `INTERNAL_API_KEY`: protege `/api/v1/internal/*`

## CryptoCurrencyAPI

- `CRYPTOCURRENCY_API_BASE_URL`: base URL del proveedor
- `CRYPTOCURRENCY_API_KEY`: key del proveedor
- `CRYPTOCURRENCY_API_TIMEOUT_MS`: timeout HTTP
- `CRYPTOCURRENCY_API_IP_ALLOWLIST`: lista CSV opcional

## iTRX

- `ITRX_API_BASE_URL`: base URL real del API de iTRX. Para produccion usar `https://itrx.io` (el dominio `develop.itrx.io` corresponde a la documentacion).
- `ITRX_API_KEY`: API key iTRX
- `ITRX_API_SECRET`: secreto para firma HMAC
- `ITRX_API_TIMEOUT_MS`: timeout HTTP
- `ITRX_CALLBACK_MAX_AGE_SEC`: antiguedad maxima aceptada del callback
- `ITRX_IP_ALLOWLIST`: lista CSV opcional

## TRON / negocio

- `TRON_FORWARD_TARGET_ADDRESS`: wallet central destino del forward SELL
- `TRON_BUY_SENDER_ADDRESS`: hot wallet emisora para BUY
- `TRON_USDT_TOKEN_SYMBOL`: simbolo del token; por defecto `USDT`

## Ordenes

- `ORDER_DEFAULT_WAIT_PERIOD_MIN`: ventana primaria de espera al crear `.give`
- `ORDER_DEFAULT_PERIOD_MIN`: periodo total de negocio usado por la app
- `ORDER_EXPIRATION_GRACE_SEC`: margen adicional antes de expirar por scheduler
- `MIN_CONFIRMATIONS_USDT_TRC20`: confirmaciones minimas para deposito SELL valido
- `MIN_OPERATIONAL_USDT`: monto minimo operativo SELL
- `MIN_OPERATIONAL_USDT_BUY`: monto minimo operativo BUY
- `ALLOW_PARTIAL_DEPOSITS`: habilita o no depositos parciales SELL
- `AMOUNT_TOLERANCE_PERCENT`: tolerancia alrededor del monto esperado SELL

## Energia SELL

- `ENERGY_MODE`: `estimated` o `fixed`
- `ENERGY_FIXED_AMOUNT`: energia fija si el modo es `fixed`
- `ENERGY_SAFETY_MULTIPLIER`: multiplicador sobre la estimacion
- `ENERGY_MIN_FLOOR`: piso minimo si estimated queda bajo
- `ENERGY_MAX_CAP`: tope maximo si estimated queda alto
- `ALLOW_FIXED_ENERGY_FALLBACK`: usa monto fijo si estimated falla

## Energia BUY

- `ENERGY_MODE_BUY`: `estimated` o `fixed`; si no se define, la app usa la estrategia general como fallback
- `ENERGY_FIXED_AMOUNT_BUY`: monto fijo BUY; si no se define, cae al valor general
- `ENERGY_SAFETY_MULTIPLIER_BUY`: multiplicador BUY; si no se define, cae al valor general
- `ENERGY_MIN_FLOOR_BUY`: piso minimo BUY; si no se define, cae al valor general
- `ENERGY_MAX_CAP_BUY`: tope BUY; si no se define, cae al valor general
- `ALLOW_FIXED_ENERGY_FALLBACK_BUY`: fallback BUY a monto fijo; debe habilitarse explicitamente

## Parametros comunes de energia

- `ENERGY_RENTAL_PERIOD`: periodo enviado a `order/price`
- `ENERGY_SMART_DELEGATE_DAYS`: compatibilidad historica para reconciliar Smart Delegate antiguo
- `ENERGY_MAX_RETRY_COUNT`: maximo de reintentos del job de energia

## Forward y send

- `FORWARD_MAX_RETRY_COUNT`: maximo de reintentos del flujo SELL
- `FORWARD_RETRY_BACKOFF_MS`: backoff base del scheduler para SELL
- `BUY_MAX_RETRY_COUNT`: maximo de reintentos del flujo BUY
- `BUY_RETRY_BACKOFF_MS`: backoff base del scheduler para BUY
- `BUY_SEND_AMOUNT_TOLERANCE`: tolerancia absoluta admitida al validar el monto on-chain del send BUY por `txid`
- `BUY_SEND_REQUIRE_EXACT_SENDER_MATCH`: si `true`, exige que el `from` on-chain coincida exactamente con la wallet emisora BUY
- `BUY_SEND_MIN_CONFIRMATIONS`: confirmaciones minimas requeridas para cerrar el send BUY desde blockchain
- `BUY_SEND_BROADCASTED_TIMEOUT_MINUTES`: tiempo maximo que una BUY puede permanecer en `SEND_BROADCASTED` antes de pasar a revision manual

## Scheduler y locks

- `LOCK_TTL_SEC`: TTL del lock por orden
- `SCHEDULER_ENABLED`: habilita polling de `outbox_jobs`
- `SCHEDULER_POLL_MS`: intervalo de polling

## Seguridad HTTP

- `RATE_LIMIT_MAX`: maximo de requests por ventana
- `RATE_LIMIT_WINDOW_MS`: ventana del rate limit
- `WEBHOOK_REQUIRE_IP_ALLOWLIST`: obliga allowlist para webhooks
- `WEBHOOK_RAW_BODY_LIMIT`: limite de body para webhooks
- `CORS_ORIGINS`: lista CSV de origins permitidos

## Private keys

- `STORE_ENCRYPTED_PRIVATE_KEYS`: si `true`, cifra private keys devueltas por `.give`
- `PRIVATE_KEY_ENCRYPTION_SECRET`: secreto usado para AES-256-GCM

## Panel interno

- `PANEL_SESSION_TTL_HOURS`: duración máxima de la sesión web interna
- `PANEL_STEP_UP_TTL_MIN`: ventana de validez para reautenticación fuerte
- `PANEL_LOGIN_MAX_ATTEMPTS`: número de intentos fallidos antes de bloquear la cuenta
- `PANEL_LOCKOUT_MINUTES`: duración del bloqueo temporal por fuerza bruta
- `PANEL_ENCRYPTION_SECRET`: secreto AES-256-GCM para TOTP y overrides sensibles del panel
- `PANEL_TOTP_ISSUER`: issuer mostrado por Google Authenticator / Authy / Microsoft Authenticator
- `PANEL_BOOTSTRAP_ADMIN_EMAIL`: correo del primer admin que el sistema creará al arrancar si no existen usuarios internos
- `PANEL_BOOTSTRAP_ADMIN_PASSWORD`: contraseña inicial del primer admin
- `PANEL_BOOTSTRAP_ADMIN_NAME`: nombre visible del primer admin
