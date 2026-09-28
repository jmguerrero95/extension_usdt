# Final Production Validation Checklist

## Automatizado

Estas validaciones ya quedan cubiertas por tests locales:

- parseo de `walletLogin`
- validaciones de config obligatoria y rangos
- bloqueo de multiples configuraciones inseguras
- no fallback a `primary` cuando falta `configKey`
- mapping conservador de estados BUY y SELL
- clasificacion de errores temporales/conflict/no autorizado
- payload de `complete-payout`
- verificacion del subset oficial de Open Extensions usado
- guard de lifecycle para no intentar cerrar SELL fuera de `READY_FOR_PAYOUT`

## Manual obligatorio en CAS real

### SELL

- crear SELL y validar `depositAddress`
- validar polling hasta `READY_FOR_PAYOUT`
- confirmar cash dispense
- validar llamada a `complete-payout`
- validar cierre final en `COMPLETED`
- repetir callback/update posterior y confirmar que no rompe idempotencia

### BUY

- crear BUY con direccion valida
- validar polling de estados intermedios
- validar que `SEND_BROADCASTED` no se trate como exito final
- validar `txid` propagado cuando exista
- validar cierre final en `COMPLETED`

### Errores

- timeout del backend
- `401/403` por API key invalida
- `409` por `complete-payout` fuera de estado
- `422` por validacion de payload
- `5xx` temporal del backend

### Configuracion

- `terminalIdMode=terminalSerial`
- `terminalIdMode=static`
- rechazo de `static` sin `staticTerminalId`
- rechazo de timeouts/rangos invalidos
- confirmar que no se mezcla una transaccion con otra config

### Seguridad

- revisar logs y confirmar que no aparece `apiKey`
- revisar logs de error y confirmar que no exponen payloads sensibles
- revisar que un `configKey` faltante produce bloqueo seguro y visible

## Go-live

Se puede considerar listo para go-live cuando:

- build y verificacion oficial pasan
- BUY feliz validado en CAS real
- SELL feliz validado en CAS real
- SELL post-payout validado hasta `COMPLETED`
- errores y timeouts validados
- configuracion final documentada y congelada
- operacion acepta la limitacion single-config o la topologia desplegada la hace segura
