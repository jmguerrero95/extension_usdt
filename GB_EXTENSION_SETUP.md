# XelerGo Open Extension para GENERAL BYTES CAS

## Objetivo

La extension Java en esta carpeta es un adaptador delgado entre GENERAL BYTES CAS y el backend REST actual de XelerGo.

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

## Compatibilidad oficial verificada

La extension no depende solo de stubs como fuente de verdad.

Los `stubs` quedan para:

- build autocontenido
- tests unitarios ligeros

La verificacion contra el subset real de la API publica usada se ejecuta con:

```powershell
.\gradlew.bat verifyOfficialApiContracts
```

Ese check valida, como minimo:

- lifecycle de `ITransactionListener` usado por la extension
- estados de `ITransactionDetails` usados por el mapper
- `getCustomData()` y `getNameOfCryptoSettingUsed()`
- `findTransactions`, `findAllTerminals`, `updateTransaction`, `addTask`, `addTransactionHash`
- `IGeneratesNewDepositCryptoAddress` y `IWallet.sendCoins`

## Contrato consumido del backend

La extension consume:

- `POST /api/v1/cas/sell-orders`
- `GET /api/v1/cas/sell-orders/:orderId`
- `GET /api/v1/cas/sell-orders/:orderId/timeline`
- `POST /api/v1/cas/sell-orders/:orderId/cancel`
- `POST /api/v1/cas/sell-orders/:orderId/complete-payout`
- `POST /api/v1/cas/buy-orders`
- `GET /api/v1/cas/buy-orders/:orderId`
- `GET /api/v1/cas/buy-orders/:orderId/timeline`
- `POST /api/v1/cas/buy-orders/:orderId/cancel`

## Cierre completo del flujo SELL

Secuencia:

1. backend llega a `READY_FOR_PAYOUT`
2. CAS completa el cash dispense
3. la transaccion queda `isWithdrawn() == true`
4. la extension llama:

```http
POST /api/v1/cas/sell-orders/{orderId}/complete-payout
```

5. el backend valida correlacion y cierra en `COMPLETED`

## Configuracion de la wallet en CAS

Wallet prefix:

- `xelergo`

Formato:

```text
xelergo:apiProtocol:apiHost:apiPort:apiBasePath:apiKey:connectTimeoutMs:readTimeoutMs:terminalIdMode:staticTerminalId:pollingSeconds:lookbackHours
```

Ejemplo:

```text
xelergo:https:api.midominio.com:443:/api:MI_CAS_API_KEY:5000:10000:terminalSerial::15:72
```

Regla practica para `apiBasePath`:

- usa `""` o `/` si tu backend publica CAS directamente en `https://host/api/v1/cas/*`
- usa `/api` si tu reverse proxy publica el backend en `https://host/api/v1/cas/*` y quieres dejarlo explicito
- usa otro prefijo solo si realmente existe delante de `/api/v1/cas`
- no pegues una URL completa ni query string en `apiBasePath`

La extension ya deduplica segmentos comunes para evitar errores tipo `/api/api/v1/cas/...`, pero la configuracion recomendada sigue siendo mantener `apiBasePath` como un prefijo corto y claro.

Parametros obligatorios:

- `apiProtocol`
- `apiHost`
- `apiKey`

Reglas de validacion endurecidas:

- `apiPort`, si se informa, debe estar entre `1` y `65535`
- `connectTimeoutMs` y `readTimeoutMs` deben ser mayores que cero
- `readTimeoutMs` no puede ser menor que `connectTimeoutMs`
- `pollingSeconds` debe estar entre `5` y `3600`
- `lookbackHours` debe estar entre `1` y `720`
- si `terminalIdMode=static`, `staticTerminalId` es obligatorio

Uso real de `pollingSeconds`:

- controla `getShortestTimeForNexStepInvocation()` del task `xelergo-transaction-sync`
- ese task es el que refresca estados BUY/SELL y agrega el `txid` real al lado CAS cuando el backend ya lo tiene

Limitacion deliberada:

- la extension solo soporta una configuracion segura por instancia CAS
- si una transaccion queda enlazada a un `configKey` que ya no existe, la extension no hara fallback silencioso a otra config

## Semantica de `sendCoins()`

La extension no firma ni transmite la transaccion TRON desde Java.

En BUY:

- la orden se precrea en el backend
- `sendCoins()` reutiliza esa orden y devuelve el `orderId` como referencia logica
- cuando el backend obtiene el `sendTxid` real, la extension lo adjunta a la transaccion de CAS mediante el task de sincronizacion

Esto mantiene a Java como adaptador delgado y deja la ejecucion on-chain en el backend.

## Semantica de `getCryptoBalance()`

GENERAL BYTES puede consultar balance de wallet, pero el backend actual no expone un endpoint de balance compatible con la interfaz de Open Extensions.

Por eso, para `USDTTRON`, la extension devuelve hoy un balance sintetico controlado y lo deja advertido en logs. No debe interpretarse como saldo on-chain real.

## Instalacion

```powershell
cd c:\xampp\htdocs\extension\api\extension
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-11.0.27.6-hotspot'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
.\gradlew.bat build
.\gradlew.bat verifyOfficialApiContracts
```

JAR:

- `build/libs/xelergo_generalbytes_extension.jar`

## Riesgos residuales honestos

1. El orden exacto de algunos hooks en runtime debe cerrarse en un CAS real.
2. `USDTTRON` puede requerir la definicion oficial correspondiente en la instalacion concreta.
3. `getCryptoBalance()` sigue siendo sintetico porque el backend no expone un balance compatible con GENERAL BYTES.
4. La extension admite una sola configuracion segura por instancia CAS.
5. `sendCoins()` devuelve una referencia logica (`orderId`) y no un `txid` final inmediato; el `txid` real llega por sincronizacion posterior.
