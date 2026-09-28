# Flujos

## SELL feliz

1. CAS crea orden SELL.
2. La API genera `orderId`, `providerUniqId` y `providerLabel`.
3. CryptoCurrencyAPI `.give` responde deposit address.
4. La orden queda `WAITING_DEPOSIT`.
5. Llega webhook con deposito valido.
6. La orden pasa a `DEPOSIT_DETECTED`.
7. Se encola `REQUEST_ENERGY`.
8. iTRX estima energia o se usa modo fijo.
9. La orden pasa a `ENERGY_REQUESTED`.
10. Llega callback firmado de iTRX.
11. La orden pasa a `ENERGY_CONFIRMED`.
12. Se encola `REQUEST_FORWARD`.
13. CryptoCurrencyAPI acepta `.forward`.
14. La orden pasa a `FORWARD_ACCEPTED`.
15. Llega webhook de sweep confirmado.
16. La orden pasa a `SWEEP_CONFIRMED`.
17. La orden pasa a `READY_FOR_PAYOUT`.
18. Cuando CAS confirma que el efectivo fue dispensado, la extension llama `POST /api/v1/cas/sell-orders/:orderId/complete-payout`.
19. La API valida la correlacion con `casTransactionId` y `terminalId`.
20. La orden pasa a `COMPLETED`.

## BUY feliz

1. CAS crea orden BUY.
2. La orden queda `CREATED`.
3. El scheduler o un endpoint interno valida la orden y pide energia para `TRON_BUY_SENDER_ADDRESS`.
4. La orden pasa por `VALIDATED`, `ENERGY_ESTIMATION_REQUESTED` y `ENERGY_REQUESTED` segun el modo configurado.
5. Llega callback firmado de iTRX.
6. La orden pasa a `ENERGY_CONFIRMED`.
7. Se encola `SEND_BUY`.
8. CryptoCurrencyAPI acepta `.send`.
9. La orden pasa a `SEND_ACCEPTED`.
10. Llega webhook de envio confirmado.
11. La orden pasa a `SEND_BROADCASTED`, `DELIVERY_CONFIRMED` y `COMPLETED`.

## BUY con energia estimated

1. `ENERGY_MODE_BUY=estimated`.
2. Se llama `iTRX order/price` con `to_address=customerDestinationAddress`.
3. Se aplica `ENERGY_SAFETY_MULTIPLIER_BUY`.
4. El monto final se ajusta con `ENERGY_MIN_FLOOR_BUY` y `ENERGY_MAX_CAP_BUY`.
5. Se crea la policy para `TRON_BUY_SENDER_ADDRESS`.

## BUY con energia fixed

1. `ENERGY_MODE_BUY=fixed`.
2. No se usa la estimacion.
3. Se toma `ENERGY_FIXED_AMOUNT_BUY`.
4. Se crea la policy para `TRON_BUY_SENDER_ADDRESS`.

## BUY con reutilizacion de energia

1. Existe una `energy_requests` confirmada para `BUY_SENDER`.
2. La confirmacion sigue vigente dentro de la ventana operativa.
3. La orden BUY salta a `ENERGY_CONFIRMED`.
4. No se vuelve a pedir energia.

## Expiracion SELL

1. Al crear la orden se encola `EXPIRE_ORDER`.
2. Si `expiresAt` ya paso y no hubo deposito valido, el scheduler marca `EXPIRED`.
3. No se continua automaticamente ningun paso de energia o forward.

## Deposito tardio SELL

1. La orden ya esta `EXPIRED` o `CANCELED`.
2. Entra un webhook de deposito valido.
3. La validacion detecta late deposit.
4. La orden cambia a `LATE_DEPOSIT`.
5. `manualReviewRequired=true`.
6. No se solicita energia ni se dispara forward.

## Retry SELL y BUY

1. Un job de energia, forward o send falla por timeout o error temporal.
2. La orden puede pasar a `ERROR_RETRYABLE`.
3. `outbox_jobs` reprograma el mismo trabajo con backoff exponencial.
4. Si se agotan intentos, se encola `MARK_MANUAL_REVIEW`.

## BUY manual review

Se marca `ERROR_MANUAL_REVIEW` cuando:

- el monto BUY esta por debajo de `MIN_OPERATIONAL_USDT_BUY`
- el proveedor responde de forma inconsistente
- se agotan reintentos del envio BUY
- un operador llama al endpoint interno de revision manual

## BUY cancelado

1. La orden esta en `CREATED`, `VALIDATED`, `ENERGY_ESTIMATION_REQUESTED`, `ENERGY_ESTIMATED`, `ENERGY_REQUESTED`, `ENERGY_CONFIRMED` o `ERROR_RETRYABLE`.
2. CAS llama `POST /api/v1/cas/buy-orders/:orderId/cancel`.
3. La orden pasa a `CANCELED`.
4. Si el envio ya fue solicitado, se responde `409 INVALID_STATE_TRANSITION`.

## BUY atascado

1. La orden queda en `SEND_ACCEPTED` o `SEND_BROADCASTED`.
2. El scheduler sigue reencolando `RECONCILE_ORDER`.
3. Si no llega confirmacion final del proveedor, la orden queda visible para operacion.
4. Si se consumen reintentos del job asincrono, se marca `ERROR_MANUAL_REVIEW`.

## Reconciliacion

El scheduler puede reencolar:

- `REQUEST_ENERGY`
- `REQUEST_BUY_ENERGY`
- `REQUEST_FORWARD`
- `SEND_BUY`
- `REPROCESS_PROVIDER_EVENT`
- `EXPIRE_ORDER`
- `RECONCILE_ORDER`

Esto permite recuperarse de:

- reinicios de proceso
- eventos pendientes
- estados `ERROR_RETRYABLE`
- ordenes SELL y BUY atascadas sin step siguiente

## Panel interno

1. Un usuario interno entra por `GET /panel`.
2. El login valida correo, contraseña y lockout.
3. Si el usuario no tiene 2FA, el panel obliga a configurarlo antes de habilitar vistas operativas.
4. Se crea una sesión Mongo con cookie `HttpOnly` y token CSRF.
5. El rol determina módulos visibles y acciones habilitadas.
6. Las acciones manuales sobre órdenes llaman a los servicios ya existentes del backend.
7. Si la acción es sensible, se exige step-up auth reciente.
8. Todo acceso o cambio sensible queda registrado en `admin_audit_logs`.
