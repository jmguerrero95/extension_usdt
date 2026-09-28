# GENERAL BYTES + XelerGo: Production Readiness

## Alcance

Este documento resume el estado real de preparacion para validacion final en preproduccion y salida a produccion de:

- backend Node/TypeScript de XelerGo
- extension Java delgada para GENERAL BYTES CAS

No afirma compatibilidad absoluta sin pruebas en un CAS real. Su objetivo es dejar claro:

- que ya esta sustentado
- que debe probarse en staging
- que riesgos residuales quedan

## Referencia oficial usada

Repositorio:

- `https://github.com/GENERALBYTESCOM/batm_public`

Referencia contrastada:

- branch `master`
- commit `e9db1f965b784d9bc7c2c89e5c463f61d602eee2`

## Estado actual

### Backend

Listo para validacion seria:

- endpoints CAS para BUY y SELL
- cierre final SELL post-payout
- webhooks y reconciliacion
- panel interno
- auditoria
- scheduler persistente
- Swagger/OpenAPI
- pruebas unitarias, integracion y e2e

### Extension Java

Lista para validacion seria:

- build JAR
- `batm-extensions.xml`
- polling ligero
- create/cancel/query BUY y SELL
- cierre final SELL al detectar payout completado por CAS
- logging y trazabilidad
- verificacion contra subset real de contratos publicos de GENERAL BYTES

## Prerequisitos

- Node.js 22+
- npm 11+
- MongoDB accesible y estable
- Java 11 para compilar la extension
- instancia CAS de pruebas
- acceso para instalar JAR y Crypto Setting en CAS
- backend desplegado con HTTPS accesible desde CAS

## Build y verificacion

### Backend

```powershell
cd c:\xampp\htdocs\extension\api
npm run build
npm test
```

### Extension

```powershell
cd c:\xampp\htdocs\extension\api\extension
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-11.0.27.6-hotspot'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
.\gradlew.bat build
.\gradlew.bat verifyOfficialApiContracts
```

Artefacto:

- [`extension/build/libs/xelergo_generalbytes_extension.jar`](c:/xampp/htdocs/extension/api/extension/build/libs/xelergo_generalbytes_extension.jar)

## Instalacion en CAS

1. Copiar el JAR a la carpeta de extensiones del CAS master.
2. Reiniciar el servicio master de CAS.
3. Confirmar que `batm-extensions.xml` esta dentro del JAR.
4. Crear un Crypto Setting con wallet provider `xelergo`.
5. Asignar ese Crypto Setting a `USDTTRON` y a la terminal correspondiente.

Ruta habitual de extensiones:

```text
/batm/app/master/extensions/
```

## Configuracion del Crypto Setting

Formato de wallet login:

```text
xelergo:apiProtocol:apiHost:apiPort:apiBasePath:apiKey:connectTimeoutMs:readTimeoutMs:terminalIdMode:staticTerminalId:pollingSeconds:lookbackHours
```

Ejemplo:

```text
xelergo:https:api.midominio.com:443:/api:MI_CAS_API_KEY:5000:10000:terminalSerial::15:72
```

Parametros:

- `apiProtocol`
- `apiHost`
- `apiPort`
- `apiBasePath`
- `apiKey`
- `connectTimeoutMs`
- `readTimeoutMs`
- `terminalIdMode`
- `staticTerminalId`
- `pollingSeconds`
- `lookbackHours`

## Configuracion requerida del backend

Minimos necesarios:

- `CAS_API_KEY`
- `API_BASE_URL`
- `MONGODB_URI`
- `CRYPTOCURRENCY_API_*`
- `ITRX_API_*`
- `TRON_FORWARD_TARGET_ADDRESS`
- `TRON_BUY_SENDER_ADDRESS`
- configuracion de energia y retries

El backend debe quedar accesible desde el CAS con la misma `CAS_API_KEY` configurada en el Crypto Setting.

## Endpoints usados por la extension

- `POST /api/v1/cas/sell-orders`
- `GET /api/v1/cas/sell-orders/:orderId`
- `GET /api/v1/cas/sell-orders/:orderId/timeline`
- `POST /api/v1/cas/sell-orders/:orderId/cancel`
- `POST /api/v1/cas/sell-orders/:orderId/complete-payout`
- `POST /api/v1/cas/buy-orders`
- `GET /api/v1/cas/buy-orders/:orderId`
- `GET /api/v1/cas/buy-orders/:orderId/timeline`
- `POST /api/v1/cas/buy-orders/:orderId/cancel`

## Flujo BUY en produccion

1. CAS crea BUY.
2. La extension crea la orden BUY en backend.
3. El backend gestiona energia y `send`.
4. La extension solo sincroniza estado y `txid`.
5. `COMPLETED` lo decide el backend, no Java.

## Flujo SELL en produccion

1. CAS prepara SELL.
2. La extension crea la orden SELL en backend.
3. La extension entrega a CAS la `depositAddress`.
4. El backend gestiona deposito, energia, forward y sweep.
5. El backend deja la orden en `READY_FOR_PAYOUT`.
6. Cuando CAS completa el cash dispense, la extension llama `complete-payout`.
7. El backend valida correlacion, audita y cierra en `COMPLETED`.

## Seguridad y hardening

- la extension no loggea API keys completas
- el backend sigue siendo fuente de verdad
- los errores del backend se traducen sin exponer detalles sensibles al operador final
- el cierre final SELL exige correlacion con `casTransactionId` y `terminalId`
- la extension evita configuraciones multiples ambiguas en una misma instancia CAS
- no se duplican webhooks, reconciliacion ni state machine en Java

## Validaciones minimas antes de produccion

### SELL

- crear SELL y confirmar `depositAddress`
- depositar USDT y verificar avance hasta `READY_FOR_PAYOUT`
- completar payout en CAS y verificar `COMPLETED`
- validar idempotencia de `complete-payout`

### BUY

- crear BUY con direccion valida
- verificar avance por energia y `send`
- validar que `SEND_BROADCASTED` no se trate como cierre final
- confirmar cierre solo en `DELIVERY_CONFIRMED` o `COMPLETED`

### Resiliencia

- timeout del backend
- error `401/403`
- error `404`
- error `409`
- error `422`
- error `5xx`
- polling posterior a webhook
- cancelacion BUY y SELL permitida
- manual review

## Plan manual end-to-end de staging

### 1. SELL feliz

- iniciar SELL en terminal de pruebas
- validar orden creada en backend
- validar QR y direccion mostrados en CAS
- enviar deposito real o simulado
- esperar `READY_FOR_PAYOUT`
- completar cash dispense
- validar `COMPLETED`

### 2. BUY feliz

- iniciar BUY
- validar creacion de orden
- confirmar energia
- confirmar `send`
- validar `txid` propagado al CAS
- validar `COMPLETED`

### 3. SELL con expiracion

- crear SELL sin depositar
- esperar expiracion
- validar que CAS no muestre exito

### 4. Cancelacion

- cancelar BUY en estado permitido
- cancelar SELL en espera de deposito
- confirmar reflejo en CAS tras sync

### 5. Manual review

- forzar `ERROR_MANUAL_REVIEW`
- confirmar que CAS no cierre la operacion como exitosa

### 6. Timeout backend

- simular timeout HTTP
- validar logs utiles
- confirmar que el estado no se falsea

### 7. Polling como fallback

- bloquear webhook o callback
- dejar que reconciliacion backend recupere estado
- confirmar que el polling de la extension refleja el estado final correcto

## Riesgos residuales

1. La API publica de GENERAL BYTES no documenta por si sola el orden exacto de runtime de todos los callbacks; ese punto debe cerrarse en un CAS de pruebas.
2. La disponibilidad de `USDTTRON` puede depender de tener instalada o habilitada la definicion oficial correspondiente en CAS.
3. El balance reportado por la extension es sintetico, no on-chain.
4. La extension solo admite una configuracion segura por instancia CAS.

## Checklist de salida a produccion

- `npm run build` ok
- `npm test` ok
- `.\gradlew.bat build` ok
- `.\gradlew.bat verifyOfficialApiContracts` ok
- JAR copiado a CAS
- Crypto Setting creado y asignado
- `CAS_API_KEY` verificada
- backend accesible por HTTPS desde CAS
- SELL feliz validado extremo a extremo
- BUY feliz validado extremo a extremo
- SELL post-payout validado hasta `COMPLETED`
- expiracion validada
- cancelacion validada
- manual review validado
- timeout/backend error validado
- monitoreo y logs revisados por operacion

## Conclusion honesta

La solucion queda lista para una validacion final seria en preproduccion y razonablemente cerca de produccion real.

Lo que ya esta sustentado:

- contrato REST backend
- cierre final SELL
- adapter Java delgado
- compatibilidad con el subset oficial de Open Extensions usado
- trazabilidad y auditoria

Lo que aun depende de validacion en un CAS real:

- orden exacto de invocacion de ciertos hooks en runtime
- comportamiento visual exacto del terminal con `USDTTRON`
- detalles de despliegue propios de la instalacion concreta de CAS
