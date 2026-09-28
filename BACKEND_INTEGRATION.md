# Backend Integration Evidence

Este documento deja trazabilidad minima y verificable del lado backend que consume la extension.

## Endpoint CAS de cierre final SELL

El endpoint existe en el backend actual en:

- [`src/modules/cas/cas.routes.ts`](c:/xampp/htdocs/extension/api/src/modules/cas/cas.routes.ts)
- [`src/modules/cas/cas.controller.ts`](c:/xampp/htdocs/extension/api/src/modules/cas/cas.controller.ts)
- [`src/modules/cas/cas.schemas.ts`](c:/xampp/htdocs/extension/api/src/modules/cas/cas.schemas.ts)
- [`src/modules/orders/orders.service.ts`](c:/xampp/htdocs/extension/api/src/modules/orders/orders.service.ts)

Ruta:

```http
POST /api/v1/cas/sell-orders/:orderId/complete-payout
```

## Garantias implementadas por el backend

- solo aplica a ordenes `SELL`
- valida correlacion con `casTransactionId`
- valida `terminalId` cuando la orden lo tiene definido
- solo permite cierre desde `READY_FOR_PAYOUT`
- es idempotente si la orden ya esta `COMPLETED`
- registra la transicion en auditoria

## Donde lo consume la extension

- llamada HTTP: `src/main/java/com/xelergo/gb/extension/XelerGoApiClient.java`
- hook principal de runtime: `src/main/java/com/xelergo/gb/extension/XelerGoExtension.java`
- fallback de polling/sync: `src/main/java/com/xelergo/gb/extension/XelerGoTransactionSyncTask.java`

## Nota sobre alcance

La extension sigue siendo un adaptador delgado.

No mueve al lado Java:

- state machine
- reconciliacion
- webhooks
- logica BUY/SELL de negocio
