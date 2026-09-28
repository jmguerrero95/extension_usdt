# Despliegue

## Variables minimas

- MongoDB accesible
- `API_BASE_URL` publico y estable
- keys de proveedores y API keys internas
- wallet TRON central de SELL configurada
- hot wallet TRON de BUY configurada
- variables del panel (`PANEL_*`) definidas, en especial:
  - `PANEL_ENCRYPTION_SECRET`
  - `PANEL_BOOTSTRAP_ADMIN_EMAIL`
  - `PANEL_BOOTSTRAP_ADMIN_PASSWORD`

## Build

```bash
npm install
npm run build
```

Salida:

- codigo compilado en `dist/`
- frontend estático del panel en `panel/`

## Ejecucion

```bash
npm start
```

Panel interno:

- UI: `GET /panel`
- APIs: `GET/POST /panel/api/*`

## Produccion inicial recomendada

- ejecutar al menos dos instancias de la API si hay balanceador
- compartir la misma base MongoDB
- mantener `SCHEDULER_ENABLED=true` en una o varias instancias
- confiar en locks TTL para exclusividad por orden
- exponer solo `443` / `https`
- configurar `API_BASE_URL` publico para webhooks reales
- monitorear saldo y energia operativa de `TRON_BUY_SENDER_ADDRESS`

## Health checks

- `GET /live`: liveness
- `GET /ready`: readiness con chequeo de Mongo
- `GET /health`: resumen simple

## Operacion

- revisar `provider_events` fallidos
- revisar `outbox_jobs` en `FAILED`
- revisar ordenes `ERROR_MANUAL_REVIEW`
- revisar ordenes `LATE_DEPOSIT`
- revisar ordenes BUY en `SEND_ACCEPTED` o `SEND_BROADCASTED`

## Rollback

- la persistencia clave esta en MongoDB
- ante rollback de codigo, validar compatibilidad con:
  - maquinas de estado
  - payloads normalizados
  - colecciones ya creadas

## Exposicion de webhooks

- `POST {API_BASE_URL}/api/v1/webhooks/cryptocurrencyapi`
- `POST {API_BASE_URL}/api/v1/webhooks/itrx`

Si se usa entorno local, exponer con tunel y actualizar `API_BASE_URL`.
