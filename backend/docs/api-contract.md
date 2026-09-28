# API Contract

## Formato global de respuesta

Todos los endpoints propios, salvo `/health`, `/live` y `/ready`, usan:

### Exito

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mensaje legible",
    "details": null
  },
  "meta": {
    "requestId": "..."
  }
}
```

## Autenticacion

- `X-API-Key: {CAS_API_KEY}` para `/api/v1/cas/*`
- `X-API-Key: {INTERNAL_API_KEY}` para `/api/v1/internal/*`
- Los webhooks no usan API key
- El panel usa sesión HTTP + cookie `HttpOnly` + token CSRF + 2FA TOTP obligatorio

## Endpoints

### Salud

- `GET /health`
- `GET /ready`
- `GET /live`

### CAS SELL

#### `POST /api/v1/cas/sell-orders`

```json
{
  "asset": "USDT",
  "network": "TRON",
  "fiatCurrency": "COP",
  "fiatAmount": 100000,
  "cryptoAmountExpected": 24.12,
  "externalRef": "cas-tx-123",
  "terminalId": "batm-001"
}
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "orderId": "ord_01h...",
    "status": "WAITING_DEPOSIT",
    "depositAddress": "T...",
    "qrPayload": "tron:T...?token=USDT&amount=24.12",
    "expiresAt": "2026-03-25T18:20:00.000Z"
  },
  "meta": {
    "requestId": "..."
  }
}
```

#### `GET /api/v1/cas/sell-orders/:orderId`

- Devuelve estado resumido SELL.

#### `GET /api/v1/cas/sell-orders/:orderId/timeline`

- Devuelve transiciones y eventos resumidos.

#### `POST /api/v1/cas/sell-orders/:orderId/cancel`

- Solo permite cancelar en `CREATED`, `ADDRESS_ASSIGNED` o `WAITING_DEPOSIT`.

#### `POST /api/v1/cas/sell-orders/:orderId/complete-payout`

Confirma desde CAS que el efectivo del SELL ya fue entregado y cierra la orden en `COMPLETED`.

Request:

```json
{
  "casTransactionId": "cas-tx-123",
  "terminalId": "batm-001"
}
```

Reglas:

- solo aplica a ordenes `SELL`
- solo permite cierre desde `READY_FOR_PAYOUT`
- valida correlacion contra `externalRef` y, si existe en la orden, contra `terminalId`
- es idempotente: si la orden ya esta `COMPLETED`, devuelve el mismo estado final
- deja traza en `order_state_transitions` con metadata de CAS

Response `200`:

```json
{
  "success": true,
  "data": {
    "orderId": "ord_01h...",
    "status": "COMPLETED",
    "updatedAt": "2026-03-25T18:30:00.000Z"
  },
  "meta": {
    "requestId": "..."
  }
}
```

### CAS BUY

#### `POST /api/v1/cas/buy-orders`

```json
{
  "asset": "USDT",
  "network": "TRON",
  "fiatCurrency": "COP",
  "fiatAmount": 100000,
  "cryptoAmountToSend": 24.12,
  "customerDestinationAddress": "TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ",
  "externalRef": "cas-tx-buy-123",
  "terminalId": "batm-001"
}
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "orderId": "ord_01h...",
    "type": "BUY",
    "status": "CREATED",
    "customerDestinationAddress": "TQHnYhYFQhKqfUSzN5Lw1fL6P7H3v1k2YQ",
    "cryptoAmountToSend": 24.12,
    "fiatAmount": 100000,
    "updatedAt": "2026-03-25T18:20:00.000Z"
  },
  "meta": {
    "requestId": "..."
  }
}
```

#### `GET /api/v1/cas/buy-orders/:orderId`

- Devuelve estado resumido BUY con `providerRequestId` y `sendTxid` si existen.

#### `GET /api/v1/cas/buy-orders/:orderId/timeline`

- Devuelve transiciones y eventos resumidos.

#### `POST /api/v1/cas/buy-orders/:orderId/cancel`

- Solo permite cancelar antes de `SEND_REQUESTED`.

### Webhooks

#### `POST /api/v1/webhooks/cryptocurrencyapi`

- Persiste `provider_events`
- Conserva `rawBody`
- Idempotente por `eventKey`
- Correlaciona por `uniqID`, `label`, `depositAddress` o `providerRequestId`
- URL a configurar en `statusURL` de CryptoCurrencyAPI:
  - `POST {API_BASE_URL}/api/v1/webhooks/cryptocurrencyapi`
- Puede procesar:
  - deposito SELL
  - confirmacion de forward SELL
  - confirmacion de send BUY

#### `POST /api/v1/webhooks/itrx`

- Persiste `provider_events`
- Verifica firma HMAC y timestamp
- Correlaciona por `out_trade_no` y `receive_address`
- URL a configurar en `callback_url` de iTRX:
  - `POST {API_BASE_URL}/api/v1/webhooks/itrx`
- Puede confirmar energia para:
  - `SELL_DEPOSIT`
  - `BUY_SENDER`

### Internos

- `POST /api/v1/internal/orders/:orderId/request-energy`
- `POST /api/v1/internal/orders/:orderId/request-buy-energy`
- `POST /api/v1/internal/orders/:orderId/forward`
- `POST /api/v1/internal/orders/:orderId/send-buy`
- `POST /api/v1/internal/orders/:orderId/reconcile`
- `POST /api/v1/internal/orders/:orderId/mark-manual-review`
- `POST /api/v1/internal/provider-events/:eventId/reprocess`
- `GET /api/v1/internal/orders`
- `GET /api/v1/internal/orders/:orderId`

### Panel interno

- `GET /panel`
- `POST /panel/api/auth/login`
- `GET /panel/api/auth/me`
- `POST /panel/api/auth/logout`
- `POST /panel/api/auth/step-up`
- `POST /panel/api/auth/2fa/setup`
- `POST /panel/api/auth/2fa/confirm`
- `POST /panel/api/auth/password/change`
- `GET /panel/api/auth/sessions`
- `POST /panel/api/auth/sessions/close-others`
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

Acciones sensibles del panel:

- requieren sesión válida
- requieren `x-csrf-token`
- para operaciones críticas requieren step-up auth reciente
- quedan auditadas en `admin_audit_logs`

`POST /api/v1/internal/orders/:orderId/reconcile` tambien ejecuta una consulta activa al proveedor cuando la orden esta esperando una confirmacion asincrona:

- SELL energia pendiente: `iTRX GET /api/v1/frontend/order/query`
- SELL forward pendiente: `CryptoCurrencyAPI GET /api/trx/.status`
- BUY energia pendiente: `iTRX GET /api/v1/frontend/order/query`
- BUY send pendiente: `CryptoCurrencyAPI GET /api/trx/.status`

## Codigos HTTP usados

- `200`: lecturas exitosas y webhooks aceptados
- `201`: creacion de orden
- `202`: acciones internas aceptadas
- `400`: validacion
- `401`: API key o firma invalida
- `403`: IP prohibida
- `404`: recurso no encontrado
- `409`: conflicto de estado o duplicado logico
- `422`: regla de negocio invalida
- `429`: rate limit
- `500`: error interno
- `502` / `503`: errores temporales o payload invalido de proveedor

## Codigos de error soportados

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `ORDER_NOT_FOUND`
- `ORDER_ALREADY_EXISTS`
- `INVALID_STATE_TRANSITION`
- `PROVIDER_TIMEOUT`
- `PROVIDER_BAD_RESPONSE`
- `PROVIDER_EVENT_DUPLICATE`
- `WEBHOOK_SIGNATURE_INVALID`
- `WEBHOOK_TIMESTAMP_EXPIRED`
- `ENERGY_NOT_CONFIRMED`
- `ENERGY_REQUEST_FAILED`
- `FORWARD_REQUEST_FAILED`
- `SEND_REQUEST_FAILED`
- `MANUAL_REVIEW_REQUIRED`
- `ORDER_EXPIRED`
- `LATE_DEPOSIT_DETECTED`
- `LOCK_NOT_ACQUIRED`
- `INTERNAL_ERROR`

## Swagger

- UI: `/docs`
- JSON: `/docs/json`

Swagger documenta SELL y BUY en un solo contrato OpenAPI 3.1:

- auth
- params
- body
- responses
- ejemplos
- schemas principales
