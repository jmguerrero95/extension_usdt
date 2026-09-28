# Arquitectura

## Objetivo

La API implementa los flujos SELL y BUY de USDT TRC20 por COP y expone un contrato REST estable para una futura extension GENERAL BYTES CAS. El proyecto sigue un enfoque modular monolith con separacion clara entre app, modulos, dominio e infraestructura.

## Capas

### `src/app`

- Construccion del servidor Fastify.
- Carga de configuracion.
- Plugins de seguridad.
- Swagger/OpenAPI.
- Middleware de request id.
- Manejo global de errores.

### `src/modules`

- `health`: health checks y readiness.
- `auth`: validacion de `X-API-Key`.
- `panel`: autenticacion interna, sesiones, 2FA, RBAC, dashboard, auditoria operativa, usuarios, configuracion y reportes.
- `cas`: endpoints publicos/estables para CAS.
- `orders`: lectura, cancelacion, transiciones y mutacion de ordenes BUY/SELL.
- `webhooks`: recepcion HTTP de CryptoCurrencyAPI e iTRX.
- `provider-events`: persistencia, idempotencia y reproceso de eventos.
- `energy`: seleccion de estrategia, solicitud/reutilizacion de energia e integracion con iTRX.
- `forwards`: movimientos salientes de blockchain.
  - SELL: `.forward`
  - BUY: `.send`
- `reconciliation`: reencolado, expiracion y reconstruccion de trabajo pendiente.
- `audit`: timeline y persistencia de transiciones.

### `src/domain`

- Entidades de `order`, `provider_event`, `energy_request`, `forward_request`, `send_request`, `outbox_job` y `distributed_lock`.
- Entidades del panel: `internal_user`, `admin_session`, `admin_audit_log`, `order_note` y `system_setting`.
- Errores de dominio.
- Maquina de estados explicita por tipo de orden.
- Reglas puras:
  - validacion de deposito SELL
  - seleccion de energia
  - politica de forward SELL
  - politica de send BUY

### `src/infrastructure`

- MongoDB/Mongoose y repositorios.
- Logger Pino.
- Cifrado opcional de private keys.
- Cifrado de secretos TOTP y overrides sensibles del panel.
- Locks distribuidos con TTL.
- HTTP clients para providers.
- Servicios aislados para CryptoCurrencyAPI e iTRX.

### `src/jobs`

- Scheduler persistente basado en MongoDB.
- Procesamiento de `outbox_jobs`.
- Reintentos exponenciales.
- Seed de reconciliacion al arrancar.

## Responsabilidades por modulo

- `OrdersService` es el punto central para crear, leer, parchear y transicionar ordenes.
- `EnergyService` resuelve dos contextos:
  - `SELL_DEPOSIT`
  - `BUY_SENDER`
- `ForwardsService` concentra las salidas en cadena:
  - `requestForward()` para SELL
  - `requestBuySend()` para BUY
- `ProviderEventsService` nunca usa payload crudo directamente como estado interno; primero normaliza y luego aplica reglas de dominio.
- `MongoScheduler` nunca agenda trabajo en memoria por orden; usa `outbox_jobs` persistidos.
- `PanelAuthService` concentra login, sesiones, lockout, 2FA y step-up auth.
- `PanelConsoleService` reusa servicios existentes para actuar sobre órdenes y usa consultas Mongo como read model del panel.
- `PanelSettingsService` guarda overrides seguros en Mongo y los aplica en el bootstrap siguiente, evitando hot-reload riesgoso de secretos.

## Diagrama textual del flujo

```text
SELL
CAS -> POST /api/v1/cas/sell-orders
    -> OrdersService
    -> CryptoCurrencyAPI .give (sin to)
    -> Mongo: orders + order_state_transitions + outbox expire
    -> status WAITING_DEPOSIT

CryptoCurrencyAPI webhook deposito
    -> provider_events
    -> normalizacion tolerante
    -> validacion de deposito
    -> status DEPOSIT_DETECTED
    -> outbox request-energy

iTRX callback firmado
    -> provider_events
    -> status ENERGY_CONFIRMED
    -> outbox request-forward

CryptoCurrencyAPI webhook forward/sweep
    -> provider_events
    -> status SWEEP_CONFIRMED
    -> status READY_FOR_PAYOUT

CAS / extension confirma payout final
    -> POST /api/v1/cas/sell-orders/:orderId/complete-payout
    -> OrdersService.completeSellPayout()
    -> validacion de correlacion con externalRef/casTransactionId y terminalId
    -> status COMPLETED

BUY
CAS -> POST /api/v1/cas/buy-orders
    -> OrdersService
    -> Mongo: orders + outbox request-buy-energy
    -> status CREATED

Scheduler / endpoint interno request-buy-energy
    -> EnergyService
    -> iTRX order/price (estimated) o monto fijo
    -> TronGrid getaccountresource sobre TRON_BUY_SENDER_ADDRESS
    -> iTRX order one-off 1H solo si existe deficit real
    -> energy_requests
    -> status ENERGY_REQUESTED

iTRX callback firmado
    -> provider_events
    -> status ENERGY_CONFIRMED
    -> outbox send-buy

Scheduler / endpoint interno send-buy
    -> ForwardsService
    -> CryptoCurrencyAPI .send
    -> send_requests
    -> status SEND_ACCEPTED

CryptoCurrencyAPI webhook send
    -> provider_events
    -> status SEND_BROADCASTED
    -> status DELIVERY_CONFIRMED
    -> status COMPLETED
```

## Decisiones tecnicas importantes

- `.give` se usa sin `to` y con `uniqID`, `statusURL`, `waitPeriod`, `period` y `label`.
- `.forward` y `.send` se tratan como asincronos; el `txid` puede llegar despues.
- La energia SELL se asigna a la deposit address.
- La energia BUY se asigna a la hot wallet emisora central.
- La idempotencia se resuelve con `provider_events.eventKey` unico y locks por `order:{orderId}`.
- Toda transicion relevante queda en `order_state_transitions`.
