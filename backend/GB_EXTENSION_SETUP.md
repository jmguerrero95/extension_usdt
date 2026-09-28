# XelerGo Open Extension para GENERAL BYTES CAS

## Objetivo

La extension Java en [`extension/`](c:/xampp/htdocs/extension/api/extension) es un adaptador delgado entre GENERAL BYTES CAS y el backend REST actual de XelerGo.

El backend Node sigue siendo la fuente de verdad para:

- creacion y consulta de ordenes BUY y SELL
- state machine
- energia iTRX
- webhooks
- reconciliacion
- auditoria
- cierres operativos de orden

La extension Java solo:

- crea, consulta y cancela ordenes via `/api/v1/cas/*`
- expone `depositAddress` al ciclo SELL de CAS
- hace polling ligero para sincronizar estados
- confirma el cierre final de SELL cuando CAS marca la transaccion como retirada
- registra trazabilidad entre `remoteTransactionId`, `orderId`, `terminalId` y `requestId`

## Referencia oficial GENERAL BYTES usada

Repositorio oficial:

- `https://github.com/GENERALBYTESCOM/batm_public`

Referencia validada:

- branch: `master`
- commit: `e9db1f965b784d9bc7c2c89e5c463f61d602eee2`

Piezas oficiales contrastadas:

- `server_extensions_template`
- `server_extensions_api`
- `server_extensions_examples/.../TransactionExtension.java`
- `server_extensions_extra/.../tron/TronExtension.java`

## Por que se eligio `server_extensions_template`

Porque es el template oficial minimo y estable para:

- empaquetar una extension en JAR
- registrar `batm-extensions.xml`
- mantener una estructura simple y compatible con Open Extensions

Los ejemplos de `TransactionExtension` y `TronExtension` se usaron solo para contrastar lifecycle y firmas publicas, no para mover logica de negocio al lado Java.

## Compatibilidad oficial verificada

La extension no depende solo de stubs como fuente de verdad.

Se mantiene un modulo `stubs` para:

- build autocontenido
- tests unitarios ligeros

Pero la compatibilidad con la API publica usada por la extension se verifica con:

```powershell
cd c:\xampp\htdocs\extension\api\extension
.\gradlew.bat verifyOfficialApiContracts
```

Esa tarea valida contra el repo oficial la presencia de las firmas publicas que realmente usamos:

- `ITransactionListener.overrideTransactionRequest(...)`
- `ITransactionListener.onTransactionCreated(...)`
- `ITransactionListener.onTransactionUpdated(...)`
- `ITransactionDetails.isWithdrawn()`
- `ITransactionDetails.canBeCashedOut()`
- `IExtensionContext.updateTransaction(...)`
- `IExtensionContext.addTransactionHash(...)`
- `IExtensionContext.addTask(...)`
- `IExtensionContext.findBuyWallet(...)`
- `IGeneratesNewDepositCryptoAddress.generateNewDepositCryptoAddress(...)`
- `IWallet.sendCoins(...)`
- `IQueryableWallet.getReceivedAmount(...)`

## Estructura del proyecto

- [`extension/build.gradle`](c:/xampp/htdocs/extension/api/extension/build.gradle)
- [`extension/settings.gradle`](c:/xampp/htdocs/extension/api/extension/settings.gradle)
- [`extension/src/main/resources/batm-extensions.xml`](c:/xampp/htdocs/extension/api/extension/src/main/resources/batm-extensions.xml)
- [`extension/src/main/java/com/xelergo/gb/extension/XelerGoExtension.java`](c:/xampp/htdocs/extension/api/extension/src/main/java/com/xelergo/gb/extension/XelerGoExtension.java)
- [`extension/src/main/java/com/xelergo/gb/extension/XelerGoWallet.java`](c:/xampp/htdocs/extension/api/extension/src/main/java/com/xelergo/gb/extension/XelerGoWallet.java)
- [`extension/src/main/java/com/xelergo/gb/extension/XelerGoTransactionSyncTask.java`](c:/xampp/htdocs/extension/api/extension/src/main/java/com/xelergo/gb/extension/XelerGoTransactionSyncTask.java)
- [`extension/src/main/java/com/xelergo/gb/extension/XelerGoApiClient.java`](c:/xampp/htdocs/extension/api/extension/src/main/java/com/xelergo/gb/extension/XelerGoApiClient.java)
- [`extension/src/main/java/com/xelergo/gb/extension/XelerGoStatusMapper.java`](c:/xampp/htdocs/extension/api/extension/src/main/java/com/xelergo/gb/extension/XelerGoStatusMapper.java)
- [`extension/src/test/java/com/xelergo/gb/extension/`](c:/xampp/htdocs/extension/api/extension/src/test/java/com/xelergo/gb/extension)

Clase principal:

- `com.xelergo.gb.extension.XelerGoExtension`

## Contrato consumido del backend

La extension consume solo estos endpoints CAS:

- `POST /api/v1/cas/sell-orders`
- `GET /api/v1/cas/sell-orders/:orderId`
- `GET /api/v1/cas/sell-orders/:orderId/timeline`
- `POST /api/v1/cas/sell-orders/:orderId/cancel`
- `POST /api/v1/cas/sell-orders/:orderId/complete-payout`
- `POST /api/v1/cas/buy-orders`
- `GET /api/v1/cas/buy-orders/:orderId`
- `GET /api/v1/cas/buy-orders/:orderId/timeline`
- `POST /api/v1/cas/buy-orders/:orderId/cancel`

Headers enviados:

- `x-api-key`
- `x-request-id`
- `content-type: application/json`
- `accept: application/json`

## Lifecycle usado en CAS

La extension se apoya en estos puntos del lifecycle publico:

- `overrideTransactionRequest(...)`
- `onTransactionCreated(...)`
- `onTransactionUpdated(...)`
- `generateNewDepositCryptoAddress(...)`
- `sendCoins(...)`
- task de polling via `addTask(...)`

Uso real:

- SELL:
  - `overrideTransactionRequest(...)` precrea la orden SELL
  - `generateNewDepositCryptoAddress(...)` devuelve la `depositAddress` ya reservada en backend
  - el task de sync consulta estado hasta `READY_FOR_PAYOUT`
  - cuando CAS marca la transaccion como retirada (`isWithdrawn()`), la extension llama `complete-payout`
- BUY:
  - `overrideTransactionRequest(...)` intenta precrear la orden BUY
  - `onTransactionCreated(...)` cubre el fallback conservador si CAS aun no tenia toda la informacion
  - `sendCoins(...)` no envia USDT por su cuenta; solo reutiliza la orden BUY ya creada
  - el task de sync consulta estado y propaga `txid` cuando aparece

## Mapping de estados

### SELL

- `CREATED`, `ADDRESS_ASSIGNED`, `WAITING_DEPOSIT` -> `STATUS_SELL_PAYMENT_REQUESTED`
- `DEPOSIT_DETECTED`, `ENERGY_ESTIMATION_REQUESTED`, `ENERGY_ESTIMATED`, `ENERGY_REQUESTED`, `ENERGY_CONFIRMED`, `FORWARD_REQUESTED`, `FORWARD_ACCEPTED`, `SWEEP_CONFIRMED` -> `STATUS_SELL_PAYMENT_ARRIVING`
- `READY_FOR_PAYOUT`, `COMPLETED` -> `STATUS_SELL_PAYMENT_ARRIVED`
- `EXPIRED`, `CANCELED`, `ERROR_RETRYABLE`, `ERROR_MANUAL_REVIEW`, `LATE_DEPOSIT` -> `STATUS_SELL_ERROR`

### BUY

- `CREATED`, `VALIDATED`, `ENERGY_ESTIMATION_REQUESTED`, `ENERGY_ESTIMATED`, `ENERGY_REQUESTED`, `ENERGY_CONFIRMED`, `SEND_REQUESTED`, `SEND_ACCEPTED`, `SEND_BROADCASTED`, `READY_FOR_PAYOUT`, `ERROR_RETRYABLE` -> `STATUS_BUY_IN_PROGRESS`
- `DELIVERY_CONFIRMED`, `COMPLETED` -> `STATUS_BUY_COMPLETED`
- `CANCELED` -> `STATUS_BUY_CANCELED`
- `ERROR_MANUAL_REVIEW` -> `STATUS_BUY_ERROR`

Importante:

- `SEND_BROADCASTED` no se trata como exito final
- `READY_FOR_PAYOUT` en SELL no significa que el backend ya cerro la orden; el cierre final ocurre despues del payout confirmado por CAS

## Cierre completo del flujo SELL

El cierre final ya no depende de una suposicion manual externa.

Secuencia:

1. backend llega a `READY_FOR_PAYOUT`
2. CAS completa el cash dispense
3. la transaccion queda `isWithdrawn() == true`
4. la extension llama:

```http
POST /api/v1/cas/sell-orders/{orderId}/complete-payout
```

Body:

```json
{
  "casTransactionId": "remoteTransactionId de CAS",
  "terminalId": "terminalId resuelto por la extension"
}
```

El backend:

- valida que la orden sea `SELL`
- valida que este en `READY_FOR_PAYOUT`
- valida correlacion con `externalRef` y `terminalId`
- trata la operacion como idempotente
- registra auditoria de transicion
- deja la orden en `COMPLETED`

Si ese cierre no sucede en `onTransactionUpdated(...)`, el task de sync lo reintenta de forma conservadora.

## Configuracion de la wallet en CAS

Wallet prefix:

- `xelergo`

Formato recomendado del wallet login:

```text
xelergo:apiProtocol:apiHost:apiPort:apiBasePath:apiKey:connectTimeoutMs:readTimeoutMs:terminalIdMode:staticTerminalId:pollingSeconds:lookbackHours
```

Ejemplo:

```text
xelergo:https:api.midominio.com:443:/api:MI_CAS_API_KEY:5000:10000:terminalSerial::15:72
```

Ejemplo con `terminalId` fijo:

```text
xelergo:https:api.midominio.com:443:/api:MI_CAS_API_KEY:5000:10000:static:batm-001:15:72
```

Parametros:

- `apiProtocol`: `http` o `https`
- `apiHost`: host del backend
- `apiPort`: puerto, opcional
- `apiBasePath`: path base, opcional
- `apiKey`: valor de `CAS_API_KEY`
- `connectTimeoutMs`: timeout de conexion HTTP
- `readTimeoutMs`: timeout total de lectura HTTP
- `terminalIdMode`: `terminalSerial` o `static`
- `staticTerminalId`: obligatorio si `terminalIdMode=static`
- `pollingSeconds`: intervalo minimo de sincronizacion
- `lookbackHours`: ventana de consulta de transacciones CAS

## Instalacion en CAS

1. Compilar la extension:

```powershell
cd c:\xampp\htdocs\extension\api\extension
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-11.0.27.6-hotspot'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
.\gradlew.bat build
```

2. Verificar compatibilidad con la API publica oficial:

```powershell
.\gradlew.bat verifyOfficialApiContracts
```

3. JAR generado:

- [`extension/build/libs/xelergo_generalbytes_extension.jar`](c:/xampp/htdocs/extension/api/extension/build/libs/xelergo_generalbytes_extension.jar)

4. Copiar el JAR a la carpeta de extensiones del CAS master.

Ruta habitual:

```text
/batm/app/master/extensions/
```

5. Reiniciar servicios del CAS master.

6. Verificar que el JAR contiene `batm-extensions.xml`.

7. Crear o editar el Crypto Setting en CAS:
   - Wallet provider: `xelergo`
   - Crypto currency: `USDTTRON`
   - Wallet login con el formato indicado arriba

8. Asignar el Crypto Setting a la moneda y a la terminal correspondientes.

## Trazabilidad

La extension guarda en `customData`:

- `xelergo.orderId`
- `xelergo.orderType`
- `xelergo.remoteTransactionId`
- `xelergo.casTransactionId`
- `xelergo.terminalId`
- `xelergo.terminalSerialNumber`
- `xelergo.backendStatus`
- `xelergo.backendRequestId`
- `xelergo.depositAddress`
- `xelergo.qrPayload`
- `xelergo.expiresAt`
- `xelergo.txid`

Esto permite correlacionar:

- transaccion CAS
- orden backend
- terminal
- request id del backend

## Pruebas manuales minimas recomendadas

### SELL feliz con cierre final

1. Crear SELL en CAS.
2. Confirmar creacion de orden SELL en backend.
3. Confirmar que CAS obtiene `depositAddress`.
4. Depositar USDT.
5. Verificar avance backend hasta `READY_FOR_PAYOUT`.
6. Completar el payout en CAS.
7. Verificar llamada a `complete-payout`.
8. Confirmar orden SELL en `COMPLETED`.

### BUY feliz

1. Crear BUY en CAS.
2. Confirmar creacion de orden BUY en backend.
3. Verificar energia y `.send` desde backend.
4. Confirmar `txid` en CAS cuando aparezca.
5. Validar cierre final en `COMPLETED`.

### Expiracion

1. Crear SELL y no depositar.
2. Esperar expiracion.
3. Validar propagacion de error operativo en CAS.

### Manual review

1. Forzar `ERROR_MANUAL_REVIEW` en backend.
2. Verificar que CAS no trate la transaccion como completada.

### Timeout o error backend

1. Simular timeout o `5xx`.
2. Revisar logs `xelergo`.
3. Confirmar que la extension no inventa exito ni estado final.

## Riesgos residuales honestos

1. Orden exacto de callbacks de CAS:
   - la API publica confirma las firmas usadas, pero no prueba por si sola el orden exacto de runtime entre `overrideTransactionRequest(...)` y `generateNewDepositCryptoAddress(...)` en todas las versiones de CAS
2. Disponibilidad de `USDTTRON`:
   - si la instalacion de CAS no incluye la definicion oficial de TRON/USDT, habra que habilitarla con la pieza oficial correspondiente
3. Balance sintetico:
   - `getCryptoBalance()` devuelve un valor sintetico porque el backend actual no expone un endpoint de balance compatible con lo que consulta GENERAL BYTES
4. Configuracion multiple:
   - la extension bloquea multiples configuraciones XelerGo distintas en una misma instancia CAS, porque la API publica no expone un mecanismo equivalente a `findSellWallet()` para resolver SELL multiwallet de forma segura

## Resultado actual

- build JAR: ok
- verificacion de contratos oficiales: ok
- tests ligeros de extension: ok
- cierre final SELL post-payout: implementado
- adaptador Java sigue siendo delgado y sin duplicacion de logica de negocio
