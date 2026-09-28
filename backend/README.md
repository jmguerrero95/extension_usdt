# GENERAL BYTES CAS Wallet API

Backend REST en Node.js + TypeScript + Fastify + MongoDB/Mongoose para operar USDT TRC20 por COP en ambos sentidos, con panel web interno y una extension Java delgada para GENERAL BYTES CAS.

- `SELL`: el cliente envia USDT y el backend deja la orden lista para payout en COP. Cuando CAS confirma la entrega final de efectivo, la orden pasa a `COMPLETED`.
- `BUY`: el cliente entrega COP y el backend envia USDT desde una hot wallet central.

## Alcance

- Si implementa backend REST, Swagger/OpenAPI, scheduler persistente, locks, webhooks, pruebas y documentacion tecnica.
- Si implementa panel web interno para operaciones, soporte, supervision y administracion.
- Si implementa una extension Java delgada para GENERAL BYTES CAS en [`extension/`](extension/).
- No mueve la logica de negocio BUY/SELL al lado Java.

## Referencias oficiales tomadas en cuenta

- GENERAL BYTES BATM Public: <https://github.com/GENERALBYTESCOM/batm_public>
- CryptoCurrencyAPI start: <https://new.cryptocurrencyapi.net/docs/.start>
- CryptoCurrencyAPI give: <https://new.cryptocurrencyapi.net/docs/.api/method-give>
- CryptoCurrencyAPI forward: <https://new.cryptocurrencyapi.net/docs/.api/method-forward>
- CryptoCurrencyAPI send: <https://new.cryptocurrencyapi.net/docs/.api/method-send>
- CryptoCurrencyAPI track: <https://new.cryptocurrencyapi.net/docs/.api/method-track>
- iTRX order price: <https://develop.itrx.io/api/order-price.html>
- iTRX auto policy: <https://develop.itrx.io/api/order-auto-policy.html>
- iTRX callback: <https://develop.itrx.io/general/callback.html>

Referencia concreta usada para validar la extension GENERAL BYTES:

- `batm_public` branch `master`
- commit `e9db1f965b784d9bc7c2c89e5c463f61d602eee2`
- verificacion local por tarea `extension\\gradlew.bat verifyOfficialApiContracts`

## Flujos implementados

### SELL

1. CAS crea una orden SELL.
2. La API pide una deposit address a CryptoCurrencyAPI usando `.give` sin `to`.
3. La orden queda en `WAITING_DEPOSIT`.
4. Un webhook/IPN detecta deposito valido.
5. La API solicita energia a iTRX para la deposit address.
6. El callback firmado de iTRX confirma energia.
7. La API dispara `.forward` de forma asincrona hacia la wallet central.
8. Un webhook de CryptoCurrencyAPI confirma sweep y la orden queda `READY_FOR_PAYOUT`.
9. La extension Java llama `POST /api/v1/cas/sell-orders/:orderId/complete-payout` cuando CAS confirma que el efectivo ya fue entregado.
10. La orden queda `COMPLETED`.

### BUY

1. CAS crea una orden BUY con wallet destino del cliente.
2. La orden queda en `CREATED`.
3. El backend prepara o reutiliza energia para `TRON_BUY_SENDER_ADDRESS`.
4. Cuando la energia queda confirmada, la API dispara `.send` de forma asincrona.
5. Un webhook de CryptoCurrencyAPI confirma el envio.
6. La orden queda `COMPLETED`.

## Arquitectura

La estructura principal vive en `src/`:

- `app/`: bootstrap, Fastify, plugins, seguridad, manejo global de errores y Swagger.
- `modules/`: controladores delgados y servicios por modulo (`cas`, `orders`, `webhooks`, `energy`, `forwards`, `reconciliation`, `audit`, `panel`).
- `domain/`: entidades, errores, reglas puras, state machine y contratos de repositorio.
- `infrastructure/`: Mongo/Mongoose, clientes HTTP, providers, locks, logger, cifrado y outbox.
- `jobs/`: scheduler persistente basado en MongoDB.
- `tests/`: unit, integration y e2e con Vitest, Supertest, Nock y mongodb-memory-server.
- `extension/`: adaptador Java delgado para GENERAL BYTES CAS.

Documentacion detallada:

- [arquitectura.md](docs/arquitectura.md)
- [api-contract.md](docs/api-contract.md)
- [state-machine.md](docs/state-machine.md)
- [collections-and-indexes.md](docs/collections-and-indexes.md)
- [flujos.md](docs/flujos.md)
- [seguridad.md](docs/seguridad.md)
- [despliegue.md](docs/despliegue.md)
- [env.example.md](docs/env.example.md)
- [ADMIN_PANEL_IMPLEMENTATION.md](ADMIN_PANEL_IMPLEMENTATION.md)
- [GB_EXTENSION_SETUP.md](GB_EXTENSION_SETUP.md)
- [GB_PRODUCTION_READINESS.md](GB_PRODUCTION_READINESS.md)

## Requisitos

- Node.js 22+
- npm 11+
- MongoDB accesible
- Java 11 para compilar la extension

## Instalacion

```bash
npm install
copy .env.example .env
```

Completa las variables reales en `.env` antes de iniciar.

## Scripts

- `npm run dev`: servidor de desarrollo con `tsx watch`
- `npm run build`: compila TypeScript a `dist/`
- `npm start`: ejecuta la version compilada
- `npm test`: corre pruebas unitarias, de integracion y e2e
- `npm run lint`: ejecuta ESLint
- `npm run format`: ejecuta Prettier
- `npm run orders:migrate-deposit-index -- --dry-run|--apply`: revisa o corrige el indice unico parcial de `depositObservedTxid`

### Extension GENERAL BYTES

Desde `extension/`:

- `.\gradlew.bat build`
- `.\gradlew.bat verifyOfficialApiContracts`

Desde la raiz:

- `.\package-extension.ps1`
  - regenera `extension.zip` con la extension, la documentacion operativa y los archivos backend relevantes para verificar `complete-payout`

## Desarrollo local

```bash
npm run dev
```

La API expone:

- Swagger UI: `GET /docs`
- OpenAPI JSON: `GET /docs/json`
- Panel interno: `GET /panel`
- Health: `GET /health`, `GET /ready`, `GET /live`

## Endpoints principales

### CAS

- `POST /api/v1/cas/sell-orders`
- `GET /api/v1/cas/sell-orders/:orderId`
- `GET /api/v1/cas/sell-orders/:orderId/timeline`
- `POST /api/v1/cas/sell-orders/:orderId/cancel`
- `POST /api/v1/cas/sell-orders/:orderId/complete-payout`
- `POST /api/v1/cas/buy-orders`
- `GET /api/v1/cas/buy-orders/:orderId`
- `GET /api/v1/cas/buy-orders/:orderId/timeline`
- `POST /api/v1/cas/buy-orders/:orderId/cancel`

### Webhooks

- `POST /api/v1/webhooks/cryptocurrencyapi`
- `POST /api/v1/webhooks/itrx`

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

## Autenticacion

- `X-API-Key` obligatorio en `/api/v1/cas/*` con `CAS_API_KEY`
- `X-API-Key` obligatorio en `/api/v1/internal/*` con `INTERNAL_API_KEY`
- Los webhooks no usan `X-API-Key`; se validan por raw body, firma y allowlist opcional

## Variables de entorno

Consulta `.env.example` y [env.example.md](docs/env.example.md).

Variables nuevas de BUY:

- `TRON_BUY_SENDER_ADDRESS`
- `MIN_OPERATIONAL_USDT_BUY`
- `ENERGY_MODE_BUY`
- `ENERGY_FIXED_AMOUNT_BUY`
- `ENERGY_SAFETY_MULTIPLIER_BUY`
- `ENERGY_MIN_FLOOR_BUY`
- `ENERGY_MAX_CAP_BUY`
- `ALLOW_FIXED_ENERGY_FALLBACK_BUY`
- `BUY_MAX_RETRY_COUNT`
- `BUY_RETRY_BACKOFF_MS`

Variables operativas relevantes de SELL/webhooks:

- `DEPOSIT_OBSERVED_MAX_WAIT_MINUTES`: ventana maxima para mantener una SELL con deposito observado pero sin confirmaciones suficientes antes de revision manual.
- `WEBHOOK_REQUIRE_IP_ALLOWLIST`: en produccion debe permanecer en `true` para webhooks externos.
- `CRYPTOCURRENCY_API_IP_ALLOWLIST`: en produccion debe incluir las IP oficiales reales del proveedor para CryptoCurrencyAPI.

## Extension GENERAL BYTES

La extension Java vive en [`extension/`](extension/) y esta documentada en [GB_EXTENSION_SETUP.md](GB_EXTENSION_SETUP.md).

Puntos operativos relevantes:

- sigue siendo un adaptador delgado
- usa el backend actual como fuente de verdad
- valida SELL post-payout con `casTransactionId` y `terminalId`
- solo soporta una configuracion segura por instancia CAS
- usa stubs locales solo para build/test autocontenido; la compatibilidad contra la API oficial se verifica contra `batm_public`
- reporta un balance sintetico de wallet porque el backend actual no expone un endpoint de balance usable por GENERAL BYTES

## Webhooks en local

Para pruebas locales necesitas exponer `API_BASE_URL` a internet con una herramienta como ngrok o Cloudflare Tunnel y apuntar:

- `POST {API_BASE_URL}/api/v1/webhooks/cryptocurrencyapi`
- `POST {API_BASE_URL}/api/v1/webhooks/itrx`

Configuracion exacta por proveedor:

- CryptoCurrencyAPI:
  - `statusURL` en `.give`, `.forward` y `.send`: `POST {API_BASE_URL}/api/v1/webhooks/cryptocurrencyapi`
- iTRX:
  - `callback_url` al crear la politica de energia: `POST {API_BASE_URL}/api/v1/webhooks/itrx`

## Advertencias operativas

- `.give` se ejecuta sin `to` por regla de negocio SELL.
- `.forward` y `.send` se tratan como asincronos: no se asume `txid` inmediato.
- Si un webhook/callback no llega, la reconciliacion interna usa `CryptoCurrencyAPI .status` e `iTRX order/query` como fallback conservador.
- Nunca se pide energia antes de un deposito SELL valido.
- Nunca se hace `forward` antes de `ENERGY_CONFIRMED`.
- Nunca se hace `send BUY` antes de `ENERGY_CONFIRMED`.
- La energia BUY se solicita para la hot wallet emisora, no para la wallet del cliente.
- Las acciones sensibles del panel exigen reautenticacion fuerte reciente.
- Si una orden SELL expira y luego entra deposito, se marca `LATE_DEPOSIT` y no continua automaticamente.
- Las private keys nunca se guardan en texto plano.
- El scheduler usa MongoDB y outbox, no `setTimeout`, y es seguro para multiples instancias por locks TTL.

## Estado de verificacion

- `npm run build`: pasa
- `npm test`: pasa
- `extension\\gradlew.bat build`: pasa
- `extension\\gradlew.bat verifyOfficialApiContracts`: pasa
- Suite backend actual: 14 archivos / 56 pruebas
