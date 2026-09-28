# XelerGo GENERAL BYTES Extension

Esta carpeta es la fuente canonica del adaptador Java para GENERAL BYTES CAS.

Incluye:

- codigo fuente Java de la extension
- `batm-extensions.xml`
- wrapper de Gradle
- `stubs` locales solo para compile/test autocontenido
- documentacion operativa de la extension
- JAR compilado en `build/libs/`
- checklist final de validacion para salida a produccion

Documentos principales dentro de esta misma carpeta:

- [GB_EXTENSION_SETUP.md](GB_EXTENSION_SETUP.md)
- [GB_PRODUCTION_READINESS.md](GB_PRODUCTION_READINESS.md)
- [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md)
- [FINAL_PRODUCTION_VALIDATION_CHECKLIST.md](FINAL_PRODUCTION_VALIDATION_CHECKLIST.md)

Build:

```powershell
cd c:\xampp\htdocs\extension\api\extension
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-11.0.27.6-hotspot'
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
.\gradlew.bat build
```

Verificacion del subset de contratos publicos usados de GENERAL BYTES:

```powershell
.\gradlew.bat verifyOfficialApiContracts
```

Empaquetado final:

```powershell
cd c:\xampp\htdocs\extension\api
.\package-extension.ps1
```

Ese script limpia caches y salidas intermedias no necesarias de `extension/`, conserva el JAR final en `build/libs/` y genera `extension.zip` alineado con el contenido real de la carpeta.

Notas importantes de produccion:

- la extension admite una sola configuracion segura por instancia CAS
- si falta `configKey` para una transaccion ya creada, la extension ahora prefiere bloquear y loggear antes que usar una config equivocada
- `stubs` no son la fuente de verdad de compatibilidad; solo sostienen build/test local
- `apiBasePath` debe contener solo el prefijo anterior a `/api/v1/cas`; la extension deduplica rutas comunes para evitar `/api/api/v1/cas`, pero el valor recomendado sigue siendo `""`, `/` o `/api`
- `pollingSeconds` si se usa: controla la frecuencia del task `xelergo-transaction-sync`
- `sendCoins()` no dispara un envio on-chain directo desde Java; reutiliza la orden BUY ya creada en backend y devuelve el `orderId` como referencia logica mientras el `txid` real se agrega despues por sync
- `getCryptoBalance()` sigue siendo sintetico para `USDTTRON` porque el backend actual no expone un endpoint de balance compatible con GENERAL BYTES
