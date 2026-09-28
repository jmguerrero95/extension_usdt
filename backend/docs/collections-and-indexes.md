# Collections and Indexes

## `orders`

Campos principales:

- `orderId` unico
- `externalRef`
- `terminalId`
- `type=SELL|BUY`
- `asset`
- `network`
- `fiatCurrency`
- `fiatAmount`
- `cryptoAmountExpected`
- `cryptoAmountReceived`
- `cryptoAmountToSend`
- `depositAddress`
- `customerDestinationAddress`
- `buySenderAddress`
- `depositAddressPublicKey`
- `depositAddressPrivateKeyStored`
- `providerUniqId` unico
- `providerLabel`
- `providerGiveRequestRaw`
- `providerForwardRequestId`
- `providerForwardTxid`
- `providerSendRequestId`
- `providerSendTxid`
- `forwardTargetAddress`
- `status`
- `statusReason`
- timestamps del flujo
- `manualReviewRequired`
- `lastErrorCode`
- `lastErrorMessage`

Indices:

- unico `orderId`
- unico `providerUniqId`
- `externalRef`
- `terminalId`
- `status`
- `depositAddress`
- `customerDestinationAddress`
- `buySenderAddress`
- `providerSendRequestId`
- `providerSendTxid`
- `createdAt`
- `expiresAt`

Proposito:

- representar la orden principal y su estado operativo actual para SELL y BUY

## `provider_events`

Campos:

- `provider`
- `eventType`
- `eventKey` unico
- `orderId`
- `headers`
- `payload`
- `rawBody`
- `signatureValid`
- `processed`
- `processedAt`
- `error`

Indices:

- unico `eventKey`
- compuesto `provider + createdAt`
- compuesto `orderId + provider`

Proposito:

- asegurar idempotencia y reproceso de webhooks/callbacks

## `energy_requests`

Campos:

- `orderId`
- `provider=itrx`
- `mode`
- `energyContext=SELL_DEPOSIT|BUY_SENDER`
- `estimatedEnergyAmount`
- `requestedEnergyAmount`
- `safetyMultiplier`
- `period`
- `receiveAddress`
- `callbackUrl`
- `providerRequestRaw`
- `providerResponseRaw`
- `providerSerial`
- `status`
- `signatureValid`
- `confirmedAt`

Indices:

- `orderId`
- `receiveAddress`
- `status`
- `createdAt`
- compuesto `receiveAddress + energyContext + status + confirmedAt`

Proposito:

- trazar cada solicitud de energia y permitir reutilizar confirmaciones vigentes para BUY

## `forward_requests`

Campos:

- `orderId`
- `provider=cryptocurrencyapi`
- `fromAddress`
- `toAddress`
- `token`
- `amount`
- `providerRequestId`
- `providerResponseRaw`
- `txid`
- `status`
- `requestedAt`
- `confirmedAt`

Indices:

- `orderId`
- `providerRequestId`
- `txid`
- `status`
- unico parcial `orderId + providerRequestId`

Proposito:

- trazar cada solicitud de forward SELL y su confirmacion posterior

## `send_requests`

Campos:

- `orderId`
- `provider=cryptocurrencyapi`
- `fromAddress`
- `toAddress`
- `token`
- `amount`
- `providerRequestId`
- `providerResponseRaw`
- `txid`
- `status`
- `requestedAt`
- `confirmedAt`

Indices:

- `orderId`
- `providerRequestId`
- `txid`
- `status`
- unico parcial `orderId + providerRequestId`

Proposito:

- trazar cada solicitud de envio BUY y su confirmacion posterior

## `order_state_transitions`

Campos:

- `orderId`
- `fromStatus`
- `toStatus`
- `reason`
- `actorType`
- `actorId`
- `metadata`
- `createdAt`

Indice:

- compuesto `orderId + createdAt`

Proposito:

- auditoria historica del workflow

## `distributed_locks`

Campos:

- `lockKey`
- `ownerId`
- `expiresAt`
- `createdAt`

Indices:

- unico `lockKey`
- TTL sobre `expiresAt`

Proposito:

- evitar doble energy request, doble forward y doble send sobre la misma orden

## `outbox_jobs`

Campos:

- `jobType`
- `orderId`
- `payload`
- `status`
- `runAt`
- `attempts`
- `maxAttempts`
- `lastError`
- `lockedAt`
- timestamps

Job types actuales:

- `REQUEST_ENERGY`
- `REQUEST_BUY_ENERGY`
- `REQUEST_FORWARD`
- `SEND_BUY`
- `EXPIRE_ORDER`
- `RECONCILE_ORDER`
- `REPROCESS_PROVIDER_EVENT`
- `MARK_MANUAL_REVIEW`

Indices:

- compuesto `status + runAt`
- compuesto `orderId + jobType`

Proposito:

- scheduler persistente para expiracion, retries, reconciliacion y reprocesos

## `internal_users`

Campos:

- `email` unico
- `displayName`
- `role=support|operations|supervisor|admin`
- `passwordHash`
- `active`
- `twoFactorEnabled`
- `twoFactorSecretEncrypted`
- `pendingTwoFactorSecretEncrypted`
- `failedLoginAttempts`
- `lockedUntil`
- `lastLoginAt`
- `passwordChangedAt`
- `mustRotatePassword`

Indices:

- unico `email`
- `active`

Proposito:

- autenticar usuarios internos del panel y aplicar RBAC/2FA

## `admin_sessions`

Campos:

- `sessionTokenHash` unico
- `userId`
- `csrfToken`
- `requiresTwoFactorSetup`
- `stepUpVerifiedAt`
- `expiresAt`
- `lastSeenAt`
- `revokedAt`
- `ipAddress`
- `userAgent`

Indices:

- unico `sessionTokenHash`
- `userId`
- TTL sobre `expiresAt`
- `revokedAt`

Proposito:

- sostener sesiones web del panel sin exponer tokens en claro en Mongo

## `admin_audit_logs`

Campos:

- `category`
- `action`
- `actorUserId`
- `actorEmail`
- `actorRole`
- `targetType`
- `targetId`
- `orderId`
- `ipAddress`
- `userAgent`
- `metadata`
- `createdAt`

Indices:

- `category`
- `action`
- `actorUserId`
- `orderId`
- `createdAt`

Proposito:

- trazabilidad de accesos, step-up, cambios de usuarios, settings y acciones manuales

## `order_notes`

Campos:

- `orderId`
- `authorUserId`
- `authorDisplayName`
- `authorRole`
- `note`
- `escalation`
- timestamps

Indices:

- `orderId + createdAt`
- `authorUserId`

Proposito:

- notas operativas internas por orden y escalaciones de soporte/operaciones

## `system_settings`

Campos:

- `key` unico
- `category`
- `description`
- `isSecret`
- `valueEncrypted`
- `valuePlain`
- `updatedByUserId`
- `updatedByEmail`
- timestamps

Indices:

- unico `key`
- `category`

Proposito:

- overrides operativos del panel, con secretos cifrados y aplicación en el siguiente reinicio
