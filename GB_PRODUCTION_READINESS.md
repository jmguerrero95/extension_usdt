# GENERAL BYTES + XelerGo: Production Readiness

## Estado actual

Esta extension queda lista para validacion seria en preproduccion junto con el backend actual.

Lo ya sustentado:

- JAR compilable
- `batm-extensions.xml`
- build autocontenido con `stubs`
- verificacion contra subset oficial de Open Extensions
- cierre final SELL post-payout
- trazabilidad entre CAS y backend
- resolucion de configuracion endurecida y sin fallback peligroso a una config distinta
- logs mas defensivos para errores temporales, conflictos y configuracion faltante
- resolucion de URLs endurecida para `apiBasePath`, evitando duplicaciones comunes como `/api/api/v1/cas`
- `pollingSeconds` documentado y usado por el task de sincronizacion

## Verificaciones

```powershell
cd c:\xampp\htdocs\extension\api\extension
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-11.0.27.6-hotspot'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
.\gradlew.bat build
.\gradlew.bat verifyOfficialApiContracts
```

## Flujo SELL

1. la extension crea SELL en backend
2. devuelve `depositAddress` al ciclo SELL de CAS
3. el backend avanza hasta `READY_FOR_PAYOUT`
4. cuando CAS completa el payout, la extension llama `complete-payout`
5. el backend cierra en `COMPLETED`

## Flujo BUY

1. la extension crea BUY en backend
2. el backend gestiona energia y `send`
3. la extension solo sincroniza estado y `txid`

## Checklist minimo de salida

- `.\gradlew.bat build` ok
- `.\gradlew.bat verifyOfficialApiContracts` ok
- backend accesible desde CAS
- `CAS_API_KEY` verificada
- `walletLogin` validado con parametros obligatorios y timeouts correctos
- `apiBasePath` validado como path y no como URL completa
- SELL feliz validado
- BUY feliz validado
- SELL post-payout validado hasta `COMPLETED`

Checklist operativo detallado:

- [FINAL_PRODUCTION_VALIDATION_CHECKLIST.md](FINAL_PRODUCTION_VALIDATION_CHECKLIST.md)

## Rollback minimo

1. retirar el JAR `xelergo_generalbytes_extension.jar` del directorio de extensiones del master
2. restaurar el JAR anterior si existia uno previo validado
3. reiniciar el servicio master de CAS
4. dejar desasignado el Crypto Setting `xelergo` si se requiere aislar completamente la prueba
5. confirmar en logs que ya no se instancia `XelerGoExtension`

## Riesgos residuales

1. Algunos detalles del lifecycle solo pueden cerrarse con un CAS real.
2. La disponibilidad de `USDTTRON` depende de la instalacion concreta.
3. El balance reportado por la extension es sintetico.
4. La extension sigue siendo deliberadamente single-config por instancia CAS para evitar resoluciones ambiguas de wallet SELL.
5. `sendCoins()` devuelve una referencia logica de orden backend y no un `txid` inmediato; esto es deliberado y depende del sync posterior para adjuntar el hash real en CAS.
