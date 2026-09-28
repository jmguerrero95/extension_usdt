package com.xelergo.gb.extension;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.Set;

import com.generalbytes.batm.server.extensions.IGeneratesNewDepositCryptoAddress;
import com.generalbytes.batm.server.extensions.IQueryableWallet;
import com.generalbytes.batm.server.extensions.IWallet;
import com.generalbytes.batm.server.extensions.payment.ReceivedAmount;

import org.slf4j.Logger;

final class XelerGoWallet implements IWallet, IGeneratesNewDepositCryptoAddress, IQueryableWallet {
    private static final BigDecimal SYNTHETIC_BALANCE = new BigDecimal("1000000");

    private final XelerGoConfig config;
    private final XelerGoApiClient apiClient;
    private final XelerGoOrderLinkRegistry registry;
    private final Logger log;

        XelerGoWallet(
        XelerGoConfig config,
        XelerGoConfigRegistry configRegistry,
        XelerGoOrderLinkRegistry registry,
        Logger log
    ) {
        this.config = config;
        this.apiClient = new XelerGoApiClient(config, log);
        this.registry = registry;
        this.log = log;
        configRegistry.register(config);
        XelerGoTrace.create()
            .field("flow", "SYSTEM")
            .field("stage", "wallet")
            .field("backendBaseUrl", config.getBaseUrl())
            .field("terminalIdMode", config.getTerminalIdMode())
            .field("pollingSeconds", config.getPollingSeconds())
            .field("lookbackHours", config.getLookbackHours())
            .field("result", "registered")
            .log(log, XelerGoLogger.Level.INFO);
        XelerGoTrace.create()
            .field("flow", "INIT")
            .field("stage", "wallet_balance")
            .field("reportedBalance", SYNTHETIC_BALANCE)
            .field("failureClass", XelerGoFailure.STATE)
            .field("failureCode", XelerGoFailure.STATE_BALANCE_SYNTHETIC_ONLY)
            .field("failureReason", "El balance reportado por la extension es sintetico y no representa saldo on-chain real.")
            .field("result", "ok")
            .log(log, XelerGoLogger.Level.WARN);
    }

    XelerGoApiClient getApiClient() {
        return apiClient;
    }

    XelerGoConfig getConfig() {
        return config;
    }

    @Override
    public String getCryptoAddress(String cryptoCurrency) {
        // GENERAL BYTES may call this generic wallet method, but XelerGo cannot safely return
        // a static deposit address here because SELL deposit addresses are created per order.
        return walletNullReturn(
            "SELL",
            "getCryptoAddress",
            null,
            cryptoCurrency,
            null,
            XelerGoFailure.STATE,
            XelerGoFailure.STATE_STATIC_CRYPTO_ADDRESS_UNAVAILABLE,
            "XelerGo no expone una direccion generica de wallet; GENERAL BYTES debe usar generateNewDepositCryptoAddress por orden SELL.",
            XelerGoLogger.Level.WARN,
            null,
            0L,
            null,
            "reject"
        );
    }

    @Override
    public Set<String> getCryptoCurrencies() {
        return Collections.singleton(XelerGoConfig.CRYPTO_CURRENCY);
    }

    @Override
    public String getPreferredCryptoCurrency() {
        return XelerGoConfig.CRYPTO_CURRENCY;
    }

    @Override
    public BigDecimal getCryptoBalance(String cryptoCurrency) {
        if (!XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(cryptoCurrency)) {
            XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "getCryptoBalance")
                .field("cryptoCurrency", safe(cryptoCurrency))
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", XelerGoFailure.VALIDATION_UNSUPPORTED_CRYPTO)
                .field("failureReason", "CAS solicito balance para una criptomoneda no soportada por esta wallet.")
                .field("result", "unsupported")
                .log(log, XelerGoLogger.Level.INFO);
            return BigDecimal.ZERO;
        }
        XelerGoTrace.create()
            .field("flow", "SYSTEM")
            .field("stage", "getCryptoBalance")
            .field("cryptoCurrency", safe(cryptoCurrency))
            .field("reportedBalance", SYNTHETIC_BALANCE)
            .field("result", "synthetic")
            .log(log, XelerGoLogger.Level.INFO);
        return SYNTHETIC_BALANCE;
    }

    @Override
    public String sendCoins(String destinationAddress, BigDecimal amount, String cryptoCurrency, String description) {
        long startedAt = System.currentTimeMillis();
        XelerGoOrderLink link = null;
        try {
            XelerGoTrace.create()
                .field("flow", "BUY")
                .field("stage", "sendCoins")
                .field("correlationId", XelerGoTrace.correlationId(description, null, null))
                .field("transactionId", description)
                .field("cryptoCurrency", safe(cryptoCurrency))
                .field("cryptoAmount", String.valueOf(amount == null ? BigDecimal.ZERO : amount))
                .field("remoteTransactionId", description)
                .maskedAddress("address", destinationAddress)
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "enter")
                .log(log, XelerGoLogger.Level.INFO);
            if (description == null || description.trim().isEmpty()) {
                return sendCoinsFailure(
                    destinationAddress,
                    amount,
                    cryptoCurrency,
                    description,
                    null,
                    XelerGoFailure.CAS_INTERNAL,
                    XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID,
                    "sendCoins fue invocado sin remoteTransactionId/description trazable.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt
                );
            }
            if (!XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(cryptoCurrency)) {
                return sendCoinsFailure(
                    destinationAddress,
                    amount,
                    cryptoCurrency,
                    description,
                    null,
                    XelerGoFailure.VALIDATION,
                    XelerGoFailure.VALIDATION_UNSUPPORTED_CRYPTO,
                    "sendCoins fue invocado con una criptomoneda no soportada.",
                    XelerGoLogger.Level.WARN,
                    null,
                    startedAt
                );
            }

            link = registry.getByRid(description);
            if (link == null) {
                return sendCoinsFailure(
                    destinationAddress,
                    amount,
                    cryptoCurrency,
                    description,
                    null,
                    XelerGoFailure.STATE,
                    XelerGoFailure.STATE_BUY_ORDER_LINK_MISSING,
                    "sendCoins no encontro una orden BUY precreada asociada al remote transaction id.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt
                );
            }

            if (!"BUY".equals(link.getOrderType())) {
                return sendCoinsFailure(
                    destinationAddress,
                    amount,
                    cryptoCurrency,
                    description,
                    link,
                    XelerGoFailure.STATE,
                    XelerGoFailure.STATE_BUY_ORDER_TYPE_INVALID,
                    "sendCoins encontro un link local, pero no corresponde a una orden BUY.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt
                );
            }

            if (link.getOrderId() == null || link.getOrderId().trim().isEmpty()) {
                return sendCoinsFailure(
                    destinationAddress,
                    amount,
                    cryptoCurrency,
                    description,
                    link,
                    XelerGoFailure.STATE,
                    XelerGoFailure.STATE_BUY_ORDER_ID_MISSING,
                    "La orden BUY precreada no contiene orderId reutilizable para sendCoins.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt
                );
            }

            String expectedDestination = trimToNull(link.getCustomerDestinationAddress());
            String providedDestination = trimToNull(destinationAddress);
            if (expectedDestination != null && providedDestination != null && !expectedDestination.equals(providedDestination)) {
                return sendCoinsFailure(
                    destinationAddress,
                    amount,
                    cryptoCurrency,
                    description,
                    link,
                    XelerGoFailure.STATE,
                    XelerGoFailure.STATE_BUY_DESTINATION_MISMATCH,
                    "sendCoins detecto una direccion destino distinta a la precreada en la orden BUY.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt
                );
            }

            BigDecimal expectedAmount = link.getCryptoAmountToSend();
            if (expectedAmount != null && amount != null && expectedAmount.compareTo(amount) != 0) {
                return sendCoinsFailure(
                    destinationAddress,
                    amount,
                    cryptoCurrency,
                    description,
                    link,
                    XelerGoFailure.STATE,
                    XelerGoFailure.STATE_BUY_AMOUNT_MISMATCH,
                    "sendCoins detecto un cryptoAmount distinto al precreado en la orden BUY.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt
                );
            }

            XelerGoTrace.create()
                .field("flow", "BUY")
                .field("stage", "sendCoins")
                .field("correlationId", XelerGoTrace.correlationId(description, null, link.getOrderId()))
                .field("transactionId", description)
                .field("remoteTransactionId", description)
                .field("orderId", link.getOrderId())
                .field("backendStatus", link.getBackendStatus())
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("approvalResult", true)
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "reuse_existing_order")
                .log(log, XelerGoLogger.Level.INFO);
            return link.getOrderId();
        } catch (RuntimeException e) {
            return sendCoinsFailure(
                destinationAddress,
                amount,
                cryptoCurrency,
                description,
                link,
                XelerGoFailure.UNKNOWN,
                XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION,
                "sendCoins fallo antes de devolver el identificador reutilizable de la orden BUY.",
                XelerGoLogger.Level.ERROR,
                e,
                startedAt
            );
        }
    }

    @Override
    public String generateNewDepositCryptoAddress(String cryptoCurrency, String label) {
        long startedAt = System.currentTimeMillis();
        XelerGoOrderLink link = null;
        try {
            XelerGoTrace.create()
                .field("flow", "SELL")
                .field("stage", "generateNewDepositCryptoAddress")
                .field("correlationId", XelerGoTrace.correlationId(label, null, null))
                .field("transactionId", label)
                .field("remoteTransactionId", label)
                .field("cryptoCurrency", safe(cryptoCurrency))
                .field("result", "enter")
                .log(log, XelerGoLogger.Level.INFO);
            // Returning null is contractual here: handing GB a fake or placeholder deposit address
            // would be more dangerous than refusing the address generation with an explicit log.
            if (label == null || label.trim().isEmpty()) {
                return walletNullReturn(
                    "SELL",
                    "generateNewDepositCryptoAddress",
                    label,
                    cryptoCurrency,
                    null,
                    XelerGoFailure.CAS_INTERNAL,
                    XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID,
                    "generateNewDepositCryptoAddress fue invocado sin label/remoteTransactionId.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt,
                    null,
                    "reject"
                );
            }
            if (!XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(cryptoCurrency)) {
                return walletNullReturn(
                    "SELL",
                    "generateNewDepositCryptoAddress",
                    label,
                    cryptoCurrency,
                    null,
                    XelerGoFailure.VALIDATION,
                    XelerGoFailure.VALIDATION_UNSUPPORTED_CRYPTO,
                    "generateNewDepositCryptoAddress fue invocado con una criptomoneda no soportada.",
                    XelerGoLogger.Level.WARN,
                    null,
                    startedAt,
                    null,
                    "reject"
                );
            }
            link = registry.getByRid(label);
            if (link == null) {
                return walletNullReturn(
                    "SELL",
                    "generateNewDepositCryptoAddress",
                    label,
                    cryptoCurrency,
                    null,
                    XelerGoFailure.STATE,
                    XelerGoFailure.STATE_SELL_ORDER_LINK_MISSING,
                    "No existe orden SELL precreada asociada al label/remote transaction id.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt,
                    null,
                    "error"
                );
            }
            if (!"SELL".equals(link.getOrderType())) {
                return walletNullReturn(
                    "SELL",
                    "generateNewDepositCryptoAddress",
                    label,
                    cryptoCurrency,
                    link,
                    XelerGoFailure.STATE,
                    XelerGoFailure.STATE_SELL_ORDER_TYPE_INVALID,
                    "El link recuperado no corresponde a una orden SELL valida.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt,
                    null,
                    "error"
                );
            }
            if (link.getDepositAddress() == null) {
                return walletNullReturn(
                    "SELL",
                    "generateNewDepositCryptoAddress",
                    label,
                    cryptoCurrency,
                    link,
                    XelerGoFailure.STATE,
                    XelerGoFailure.STATE_DEPOSIT_ADDRESS_MISSING,
                    "La orden SELL existe pero aun no tiene depositAddress en el link local.",
                    XelerGoLogger.Level.ERROR,
                    null,
                    startedAt,
                    null,
                    "error"
                );
            }
            XelerGoTrace.create()
                .field("flow", "SELL")
                .field("stage", "generateNewDepositCryptoAddress")
                .field("correlationId", XelerGoTrace.correlationId(label, null, link.getOrderId()))
                .field("transactionId", label)
                .field("remoteTransactionId", label)
                .field("orderId", link.getOrderId())
                .field("backendRequestId", link.getBackendRequestId())
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .maskedAddress("address", link.getDepositAddress())
                .field("result", "ok")
                .log(log, XelerGoLogger.Level.INFO);
            return link.getDepositAddress();
        } catch (RuntimeException e) {
            return walletNullReturn(
                "SELL",
                "generateNewDepositCryptoAddress",
                label,
                cryptoCurrency,
                link,
                XelerGoFailure.UNKNOWN,
                XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION,
                "generateNewDepositCryptoAddress fallo antes de devolver una depositAddress.",
                XelerGoLogger.Level.ERROR,
                e,
                startedAt,
                null,
                "error"
            );
        }
    }

    @Override
    public ReceivedAmount getReceivedAmount(String address, String cryptoCurrency) {
        long startedAt = System.currentTimeMillis();
        XelerGoOrderLink link = null;
        try {
            XelerGoTrace.create()
                .field("flow", "SELL")
                .field("stage", "getReceivedAmount")
                .maskedAddress("address", address)
                .field("cryptoCurrency", safe(cryptoCurrency))
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "enter")
                .log(log, XelerGoLogger.Level.INFO);
            if (address == null || address.trim().isEmpty()) {
                XelerGoTrace.create()
                    .field("flow", "SELL")
                    .field("stage", "getReceivedAmount")
                    .field("failureClass", XelerGoFailure.VALIDATION)
                    .field("failureCode", XelerGoFailure.VALIDATION_MISSING_DESTINATION_ADDRESS)
                    .field("failureReason", "getReceivedAmount fue invocado sin depositAddress.")
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "error")
                    .log(log, XelerGoLogger.Level.ERROR);
                return ReceivedAmount.ZERO;
            }
            if (!XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(cryptoCurrency)) {
                XelerGoTrace.create()
                    .field("flow", "SELL")
                    .field("stage", "getReceivedAmount")
                    .maskedAddress("address", address)
                    .field("cryptoCurrency", safe(cryptoCurrency))
                    .field("failureClass", XelerGoFailure.VALIDATION)
                    .field("failureCode", XelerGoFailure.VALIDATION_UNSUPPORTED_CRYPTO)
                    .field("failureReason", "getReceivedAmount fue invocado con una criptomoneda no soportada.")
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "reject")
                    .log(log, XelerGoLogger.Level.WARN);
                return ReceivedAmount.ZERO;
            }
            link = registry.getByAddress(address);
            if (link == null) {
                XelerGoTrace.create()
                    .field("flow", "SELL")
                    .field("stage", "getReceivedAmount")
                    .maskedAddress("address", address)
                    .field("failureClass", XelerGoFailure.STATE)
                    .field("failureCode", XelerGoFailure.STATE_SELL_ORDER_LINK_MISSING)
                    .field("failureReason", "No existe link local para la depositAddress consultada.")
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "error")
                    .log(log, XelerGoLogger.Level.WARN);
                return ReceivedAmount.ZERO;
            }
            if (!"SELL".equals(link.getOrderType())) {
                XelerGoTrace.create()
                    .field("flow", "SELL")
                    .field("stage", "getReceivedAmount")
                    .field("orderId", link.getOrderId())
                    .maskedAddress("address", address)
                    .field("failureClass", XelerGoFailure.STATE)
                    .field("failureCode", XelerGoFailure.STATE_SELL_ORDER_TYPE_INVALID)
                    .field("failureReason", "La depositAddress recupero un link que no corresponde a una orden SELL.")
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "error")
                    .log(log, XelerGoLogger.Level.ERROR);
                return ReceivedAmount.ZERO;
            }

            XelerGoApiClient.OrderStatusResponse response = apiClient.getSellOrder(link.getOrderId());
            link.setBackendStatus(response.getStatus());
            link.setBackendRequestId(response.getRequestId());
            link.setCryptoAmountReceived(response.getCryptoAmountReceived());
            registry.put(link);

            if ("READY_FOR_PAYOUT".equals(response.getStatus()) || "COMPLETED".equals(response.getStatus())) {
                BigDecimal amount = response.getCryptoAmountReceived() == null ? BigDecimal.ZERO : response.getCryptoAmountReceived();
                XelerGoTrace.create()
                    .field("flow", "SELL")
                    .field("stage", "getReceivedAmount")
                    .field("orderId", link.getOrderId())
                    .maskedAddress("address", address)
                    .field("backendStatus", response.getStatus())
                    .field("cryptoAmount", amount)
                    .field("requestAttempted", true)
                    .field("requestDispatched", true)
                    .field("responseReceived", true)
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "confirmed")
                    .log(log, XelerGoLogger.Level.INFO);
                return new ReceivedAmount(amount, 1);
            }

            if (
                "DEPOSIT_DETECTED".equals(response.getStatus())
                    || "ENERGY_ESTIMATION_REQUESTED".equals(response.getStatus())
                    || "ENERGY_ESTIMATED".equals(response.getStatus())
                    || "ENERGY_REQUESTED".equals(response.getStatus())
                    || "ENERGY_CONFIRMED".equals(response.getStatus())
                    || "FORWARD_REQUESTED".equals(response.getStatus())
                    || "FORWARD_ACCEPTED".equals(response.getStatus())
                    || "SWEEP_CONFIRMED".equals(response.getStatus())
            ) {
                BigDecimal amount = response.getCryptoAmountReceived() == null ? BigDecimal.ZERO : response.getCryptoAmountReceived();
                XelerGoTrace.create()
                    .field("flow", "SELL")
                    .field("stage", "getReceivedAmount")
                    .field("orderId", link.getOrderId())
                    .maskedAddress("address", address)
                    .field("backendStatus", response.getStatus())
                    .field("cryptoAmount", amount)
                    .field("requestAttempted", true)
                    .field("requestDispatched", true)
                    .field("responseReceived", true)
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "pending")
                    .log(log, XelerGoLogger.Level.INFO);
                return new ReceivedAmount(amount, 0);
            }

            XelerGoTrace.create()
                .field("flow", "SELL")
                .field("stage", "getReceivedAmount")
                .field("orderId", link.getOrderId())
                .maskedAddress("address", address)
                .field("backendStatus", response.getStatus())
                .field("failureClass", XelerGoFailure.STATE)
                .field("failureCode", XelerGoFailure.STATE_SELL_STATUS_UNMAPPED)
                .field("failureReason", "El backend devolvio un estado SELL no esperado para ReceivedAmount.")
                .field("requestAttempted", true)
                .field("requestDispatched", true)
                .field("responseReceived", true)
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "unmapped_status")
                .log(log, XelerGoLogger.Level.WARN);
            return ReceivedAmount.ZERO;
        } catch (XelerGoApiException e) {
            XelerGoTrace.create()
                .field("flow", "SELL")
                .field("stage", "getReceivedAmount")
                .field("orderId", link == null ? null : link.getOrderId())
                .maskedAddress("address", address)
                .field("failureClass", e.getFailureClass())
                .field("failureCode", e.getFailureCode())
                .field("failureReason", e.getMessage())
                .field("requestAttempted", true)
                .field("requestDispatched", true)
                .field("responseReceived", e.getHttpStatus() > 0)
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(log, XelerGoLogger.Level.WARN, e);
            return ReceivedAmount.ZERO;
        } catch (RuntimeException e) {
            XelerGoTrace.create()
                .field("flow", "SELL")
                .field("stage", "getReceivedAmount")
                .maskedAddress("address", address)
                .field("cryptoCurrency", safe(cryptoCurrency))
                .field("failureClass", XelerGoFailure.UNKNOWN)
                .field("failureCode", XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION)
                .field("failureReason", "getReceivedAmount fallo antes de completar la consulta local/backend.")
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(log, XelerGoLogger.Level.ERROR, e);
            return ReceivedAmount.ZERO;
        }
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private String walletNullReturn(
        String flow,
        String stage,
        String transactionId,
        String cryptoCurrency,
        XelerGoOrderLink link,
        String failureClass,
        String failureCode,
        String failureReason,
        XelerGoLogger.Level level,
        RuntimeException error,
        long startedAt,
        String address,
        String result
    ) {
        XelerGoTrace trace = XelerGoTrace.create()
            .field("flow", flow)
            .field("stage", stage)
            .field("correlationId", XelerGoTrace.correlationId(transactionId, null, link == null ? null : link.getOrderId()))
            .field("transactionId", transactionId)
            .field("remoteTransactionId", transactionId)
            .field("cryptoCurrency", safe(cryptoCurrency))
            .field("orderId", link == null ? null : link.getOrderId())
            .field("linkPresent", link != null)
            .field("linkOrderType", link == null ? null : link.getOrderType())
            .field("backendStatus", link == null ? null : link.getBackendStatus())
            .field("backendRequestId", link == null ? null : link.getBackendRequestId())
            .maskedAddress("address", address)
            .field("frameworkReturn", "null")
            .field("nullReturn", true)
            .field("failureClass", failureClass)
            .field("failureCode", failureCode)
            .field("failureReason", failureReason)
            .field("durationMs", startedAt <= 0L ? null : System.currentTimeMillis() - startedAt)
            .field("result", result);
        if (error == null) {
            trace.log(log, level);
        } else {
            trace.log(log, level, error);
        }
        return null;
    }

    private String sendCoinsFailure(
        String destinationAddress,
        BigDecimal amount,
        String cryptoCurrency,
        String description,
        XelerGoOrderLink link,
        String failureClass,
        String failureCode,
        String failureReason,
        XelerGoLogger.Level level,
        RuntimeException error,
        long startedAt
    ) {
        String failureHandle = buildSendCoinsFailureHandle(failureCode, description);
        XelerGoTrace trace = XelerGoTrace.create()
            .field("flow", "BUY")
            .field("stage", "sendCoins")
            .field("correlationId", XelerGoTrace.correlationId(description, null, link == null ? null : link.getOrderId()))
            .field("transactionId", description)
            .field("remoteTransactionId", description)
            .field("orderId", link == null ? null : link.getOrderId())
            .field("cryptoCurrency", safe(cryptoCurrency))
            .field("cryptoAmount", String.valueOf(amount == null ? BigDecimal.ZERO : amount))
            .maskedAddress("address", destinationAddress)
            .field("requestAttempted", false)
            .field("requestDispatched", false)
            .field("responseReceived", false)
            .field("approvalResult", false)
            .field("failureClass", failureClass)
            .field("failureCode", failureCode)
            .field("failureReason", failureReason)
            .field("returnedHandle", failureHandle)
            .field("durationMs", System.currentTimeMillis() - startedAt)
            .field("result", "error");
        if (error == null) {
            trace.log(log, level);
        } else {
            trace.log(log, level, error);
        }
        return failureHandle;
    }

    private static String trimToNull(String value) {
        return value == null || value.trim().isEmpty() ? null : value.trim();
    }

    private static String buildSendCoinsFailureHandle(String failureCode, String transactionId) {
        String normalizedCode = (failureCode == null ? "UNKNOWN_RUNTIME_EXCEPTION" : failureCode)
            .replaceAll("[^A-Za-z0-9_\\-]", "_");
        String normalizedTransactionId = safe(transactionId)
            .replaceAll("[^A-Za-z0-9_\\-]", "_");
        if (normalizedTransactionId.isEmpty()) {
            return "XELERGO_ERR_" + normalizedCode;
        }
        return "XELERGO_ERR_" + normalizedCode + "_" + normalizedTransactionId;
    }
}
