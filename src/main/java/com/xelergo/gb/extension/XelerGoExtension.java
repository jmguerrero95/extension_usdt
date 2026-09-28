package com.xelergo.gb.extension;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.generalbytes.batm.server.extensions.AbstractExtension;
import com.generalbytes.batm.server.extensions.ICryptoAddressValidator;
import com.generalbytes.batm.server.extensions.IExtensionContext;
import com.generalbytes.batm.server.extensions.ITransactionDetails;
import com.generalbytes.batm.server.extensions.ITransactionListener;
import com.generalbytes.batm.server.extensions.ITransactionPreparation;
import com.generalbytes.batm.server.extensions.ITransactionRequest;
import com.generalbytes.batm.server.extensions.IWallet;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class XelerGoExtension extends AbstractExtension implements ITransactionListener {
    private static final Logger LOG = LoggerFactory.getLogger(XelerGoLogger.LOGGER_NAME);
    private static final XelerGoConfigRegistry CONFIGS = new XelerGoConfigRegistry();
    private static final XelerGoOrderLinkRegistry LINKS = new XelerGoOrderLinkRegistry();
    private static final TronAddressValidator TRON_ADDRESS_VALIDATOR = new TronAddressValidator();
    private IExtensionContext extensionContext;

    @Override
    public String getName() {
        return "XelerGo GENERAL BYTES CAS extension";
    }

    @Override
    public Set<String> getSupportedCryptoCurrencies() {
        return Collections.singleton(XelerGoConfig.CRYPTO_CURRENCY);
    }

    @Override
    public void init(IExtensionContext ctx) {
        XelerGoTrace.create()
            .field("flow", "INIT")
            .field("stage", "init")
            .field("result", "enter")
            .log(LOG, Level.INFO);
        try {
            super.init(ctx);
            this.extensionContext = ctx;
            registerTransactionListener(ctx);
            registerTransactionSyncTask(ctx);
            XelerGoTrace.create()
                .field("flow", "INIT")
                .field("stage", "init")
                .field("result", "ok")
                .log(LOG, Level.INFO);
        } catch (RuntimeException e) {
            XelerGoTrace.create()
                .field("flow", "INIT")
                .field("stage", "init")
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.INIT_COMPONENT_ERROR)
                .field("failureReason", e.getMessage())
                .field("result", "error")
                .log(LOG, Level.SEVERE, e);
            throw e;
        }
    }

    @Override
    public IWallet createWallet(String walletLogin, String tunnelPassword) {
        long startedAt = System.currentTimeMillis();
        try {
            enrichWalletLoginTrace(XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "createWallet")
                .field("result", "enter")
            , walletLogin).log(LOG, Level.INFO);
            XelerGoConfig config = XelerGoConfig.fromWalletLogin(walletLogin);
            enrichWalletLoginTrace(XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "createWallet")
                .field("result", "ok")
                .field("backendBaseUrl", config.getBaseUrl())
                .field("terminalIdMode", config.getTerminalIdMode())
                .field("pollingSeconds", config.getPollingSeconds())
                .field("lookbackHours", config.getLookbackHours())
                .field("durationMs", System.currentTimeMillis() - startedAt)
            , walletLogin).log(LOG, Level.INFO);
            return new XelerGoWallet(config, CONFIGS, LINKS, LOG);
        } catch (XelerGoConfigException e) {
            enrichWalletLoginTrace(XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "createWallet")
                .field("result", "error")
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", e.getFailureCode())
                .field("failureReason", e.getMessage())
                .field("durationMs", System.currentTimeMillis() - startedAt)
            , walletLogin).log(LOG, Level.SEVERE);
            return null;
        } catch (RuntimeException e) {
            enrichWalletLoginTrace(XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "createWallet")
                .field("result", "error")
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_INVALID_WALLET_LOGIN)
                .field("failureReason", e.getMessage())
                .field("durationMs", System.currentTimeMillis() - startedAt)
            , walletLogin).log(LOG, Level.SEVERE, e);
            return null;
        }
    }

    @Override
    public ICryptoAddressValidator createAddressValidator(String cryptoCurrency) {
        if (!XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(cryptoCurrency)) {
            XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "createAddressValidator")
                .field("cryptoCurrency", safe(cryptoCurrency))
                .field("result", "unsupported")
                .log(LOG, Level.FINE);
            return null;
        }
        XelerGoTrace.create()
            .field("flow", "SYSTEM")
            .field("stage", "createAddressValidator")
            .field("cryptoCurrency", safe(cryptoCurrency))
            .field("result", "ok")
            .log(LOG, Level.INFO);
        return TRON_ADDRESS_VALIDATOR;
    }

    @Override
    public ITransactionPreparation overrideTransactionPreparation(ITransactionPreparation preparation) {
        if (!isSupportedPreparation(preparation)) {
            preparationTrace(transactionTypeName(preparation == null ? -1 : preparation.getType()), "overrideTransactionPreparation", preparation)
                .field("approvalResult", true)
                .field("result", "skip")
                .log(LOG, Level.INFO);
            return preparation;
        }
        preparationTrace(transactionTypeName(preparation.getType()), "overrideTransactionPreparation", preparation)
            .field("approvalResult", true)
            .field("result", "pass_through")
            .log(LOG, Level.INFO);
        return preparation;
    }

    @Override
    public boolean isTransactionPreparationApproved(ITransactionPreparation preparation) {
        if (!isSupportedPreparation(preparation)) {
            preparationTrace(transactionTypeName(preparation == null ? -1 : preparation.getType()), "isTransactionPreparationApproved", preparation)
                .field("approvalResult", true)
                .field("result", "skip")
                .log(LOG, Level.INFO);
            return true;
        }
        preparationTrace(transactionTypeName(preparation.getType()), "isTransactionPreparationApproved", preparation)
            .field("approvalResult", true)
            .field("result", "approved")
            .log(LOG, Level.INFO);
        return true;
    }

    @Override
    public ITransactionRequest overrideTransactionRequest(ITransactionRequest request) {
        if (request == null) {
            requestTrace("UNKNOWN", "overrideTransactionRequest", null)
                .field("approvalResult", false)
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID)
                .field("failureReason", "CAS invoco overrideTransactionRequest con request nulo.")
                .field("result", "error")
                .log(LOG, Level.SEVERE);
            return null;
        }
        if (!isSupportedRequest(request)) {
            requestTrace("UNKNOWN", "overrideTransactionRequest", request)
                .field("result", "skipped")
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", XelerGoFailure.VALIDATION_UNSUPPORTED_CRYPTO)
                .field("failureReason", "La solicitud no corresponde a USDTTRON BUY/SELL soportado por XelerGo.")
                .log(LOG, Level.FINE);
            return request;
        }
        String flow = transactionTypeName(request.getType());
        long startedAt = System.currentTimeMillis();
        requestTrace(flow, "overrideTransactionRequest", request)
            .field("approvalResult", false)
            .field("requestAttempted", false)
            .field("requestDispatched", false)
            .field("responseReceived", false)
            .field("result", "enter")
            .log(LOG, Level.INFO);

        XelerGoOrderLink existing = LINKS.getByRid(request.getRemoteTransactionId());
        if (existing != null) {
            requestTrace(flow, "overrideTransactionRequest", request)
                .field("orderId", existing.getOrderId())
                .field("terminalId", existing.getTerminalId())
                .field("approvalResult", true)
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reuse_existing_link")
                .log(LOG, Level.INFO);
            return request;
        }

        try {
            TronAddressValidator.ValidationResult addressValidation = validatePrecreateRequest(request, flow);
            requestTrace(flow, "config", request)
                .field("result", "resolve_start")
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .log(LOG, Level.INFO);
            XelerGoConfig config = resolveConfigForTerminal(flow, request.getTerminalSerialNumber());
            String terminalId = TerminalIdResolver.resolve(config, request.getTerminalSerialNumber());
            ensureTerminalIdResolved(flow, request, terminalId);
            XelerGoApiClient apiClient = new XelerGoApiClient(config, LOG);
            requestTrace(flow, "config", request)
                .field("terminalId", terminalId)
                .field("backendBaseUrl", config.getBaseUrl())
                .field("result", "ok")
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .log(LOG, Level.INFO);

            if (request.getType() == ITransactionRequest.TYPE_SELL_CRYPTO) {
                requestTrace(flow, "precreate_http", request)
                    .field("terminalId", terminalId)
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("requestAttempted", true)
                    .field("requestDispatched", false)
                    .field("responseReceived", false)
                    .field("result", "before_dispatch")
                    .log(LOG, Level.INFO);
                XelerGoApiClient.CreateSellOrderResponse sellOrder = apiClient.createSellOrder(
                    request.getRemoteTransactionId(),
                    terminalId,
                    nonNullAmount(request.getCashAmount()),
                    request.getCryptoAmount()
                );
                XelerGoOrderLink link = new XelerGoOrderLink(
                    sellOrder.getOrderId(),
                    "SELL",
                    request.getRemoteTransactionId(),
                    request.getTerminalSerialNumber(),
                    terminalId,
                    config.getConfigKey()
                );
                link.setDepositAddress(sellOrder.getDepositAddress());
                link.setQrPayload(sellOrder.getQrPayload());
                link.setExpiresAt(sellOrder.getExpiresAt());
                link.setBackendStatus(sellOrder.getStatus());
                link.setBackendRequestId(sellOrder.getRequestId());
                link.setCryptoAmountExpected(request.getCryptoAmount());
                LINKS.put(link);
                requestTrace(flow, "precreate_http", request)
                    .field("terminalId", terminalId)
                    .field("orderId", sellOrder.getOrderId())
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("backendStatus", sellOrder.getStatus())
                    .field("backendRequestId", sellOrder.getRequestId())
                    .maskedAddress("depositAddress", sellOrder.getDepositAddress())
                    .field("approvalResult", true)
                    .field("requestAttempted", true)
                    .field("requestDispatched", true)
                    .field("responseReceived", true)
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "ok")
                    .log(LOG, Level.INFO);
            } else if (request.getType() == ITransactionRequest.TYPE_BUY_CRYPTO) {
                requestTrace(flow, "precreate_http", request)
                    .field("terminalId", terminalId)
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("requestAttempted", true)
                    .field("requestDispatched", false)
                    .field("responseReceived", false)
                    .field("addressValidationLevel", addressValidation == null ? null : addressValidation.getValidationLevel())
                    .field("result", "before_dispatch")
                    .log(LOG, Level.INFO);
                XelerGoApiClient.CreateBuyOrderResponse buyOrder = apiClient.createBuyOrder(
                    request.getRemoteTransactionId(),
                    terminalId,
                    nonNullAmount(request.getCashAmount()),
                    nonNullAmount(request.getCryptoAmount()),
                    request.getCryptoAddress()
                );
                XelerGoOrderLink link = new XelerGoOrderLink(
                    buyOrder.getOrderId(),
                    "BUY",
                    request.getRemoteTransactionId(),
                    request.getTerminalSerialNumber(),
                    terminalId,
                    config.getConfigKey()
                );
                link.setBackendStatus(buyOrder.getStatus());
                link.setBackendRequestId(buyOrder.getRequestId());
                link.setCustomerDestinationAddress(request.getCryptoAddress());
                link.setCryptoAmountToSend(request.getCryptoAmount());
                LINKS.put(link);
                requestTrace(flow, "precreate_http", request)
                    .field("terminalId", terminalId)
                    .field("orderId", buyOrder.getOrderId())
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("backendStatus", buyOrder.getStatus())
                    .field("backendRequestId", buyOrder.getRequestId())
                    .field("approvalResult", true)
                    .field("requestAttempted", true)
                    .field("requestDispatched", true)
                    .field("responseReceived", true)
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "ok")
                    .log(LOG, Level.INFO);
            }
        } catch (XelerGoLocalException e) {
            request.setErrorMessage(userFacingPrecreateMessage(flow));
            requestTrace(flow, "precreate_local", request)
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("approvalResult", false)
                .field("failureClass", e.getFailureClass())
                .field("failureCode", e.getFailureCode())
                .field("failureReason", e.getMessage())
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(LOG, Level.SEVERE, e);
        } catch (Exception e) {
            request.setErrorMessage(userFacingPrecreateMessage(flow));
            String failureClass = e instanceof XelerGoApiException ? ((XelerGoApiException) e).getFailureClass() : XelerGoFailure.UNKNOWN;
            String failureCode = e instanceof XelerGoApiException ? ((XelerGoApiException) e).getFailureCode()
                : ("SELL".equals(flow) ? XelerGoFailure.PRE_HTTP_SELL_PRECREATE_FAILED : XelerGoFailure.PRE_HTTP_BUY_PRECREATE_FAILED);
            requestTrace(flow, e instanceof XelerGoApiException ? "precreate_http" : "precreate_local", request)
                .field("requestAttempted", true)
                .field("requestDispatched", e instanceof XelerGoApiException)
                .field("responseReceived", e instanceof XelerGoApiException && ((XelerGoApiException) e).getHttpStatus() > 0)
                .field("approvalResult", false)
                .field("failureClass", failureClass)
                .field("failureCode", failureCode)
                .field("failureReason", e.getMessage())
                .field("exceptionClass", e.getClass().getName())
                .field("exceptionMessage", e.getMessage())
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(LOG, e instanceof XelerGoApiException ? resolveLogLevel((XelerGoApiException) e) : Level.SEVERE, e);
        }

        return request;
    }

    @Override
    public boolean isTransactionApproved(ITransactionRequest transactionRequest) {
        if (transactionRequest == null) {
            requestTrace("UNKNOWN", "approval", null)
                .field("approvalResult", false)
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID)
                .field("failureReason", "CAS invoco isTransactionApproved con request nulo.")
                .field("result", "error")
                .log(LOG, Level.SEVERE);
            return false;
        }
        if (!isSupportedRequest(transactionRequest)) {
            requestTrace("UNKNOWN", "approval", transactionRequest)
                .field("result", "skipped")
                .log(LOG, Level.FINE);
            return true;
        }
        String flow = transactionTypeName(transactionRequest.getType());
        XelerGoOrderLink link = LINKS.getByRid(transactionRequest.getRemoteTransactionId());
        boolean approved = link != null;
        if (!approved && (transactionRequest.getErrorMessage() == null || transactionRequest.getErrorMessage().isEmpty())) {
            transactionRequest.setErrorMessage(
                transactionRequest.getType() == ITransactionRequest.TYPE_SELL_CRYPTO
                    ? "No se pudo preparar la orden SELL en XelerGo."
                    : "No se pudo preparar la orden BUY en XelerGo."
            );
        }
        requestTrace(flow, "approval", transactionRequest)
            .field("orderId", link == null ? null : link.getOrderId())
            .field("terminalId", link == null ? null : link.getTerminalId())
            .field("approvalResult", approved)
            .field("requestAttempted", approved || hasErrorMessage(transactionRequest))
            .field("requestDispatched", approved)
            .field("responseReceived", approved)
            .field("failureClass", approved ? null : XelerGoFailure.STATE)
            .field("failureCode", approved ? null : XelerGoFailure.STATE_APPROVAL_LINK_MISSING)
            .field("failureReason", approved ? null : "La extension no encontro un link local de orden precreada al momento de aprobar.")
            .field("result", approved ? "approved" : "rejected")
            .log(LOG, approved ? Level.INFO : Level.SEVERE);
        return approved;
    }

    @Override
    public Map<String, String> onTransactionCreated(ITransactionDetails transactionDetails) {
        if (transactionDetails == null) {
            Map<String, String> safeReturn = emptyFrameworkCustomData();
            transactionTrace("UNKNOWN", "onTransactionCreated", null, null)
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID)
                .field("failureReason", "CAS invoco onTransactionCreated con transactionDetails nulo.")
                .field("frameworkReturn", frameworkReturnLabel(safeReturn))
                .field("customDataSize", safeReturn.size())
                .field("result", "error")
                .log(LOG, Level.SEVERE);
            return safeReturn;
        }
        String flow = transactionTypeName(transactionDetails.getType());
        transactionTrace(flow, "onTransactionCreated", transactionDetails, null)
            .field("result", "enter")
            .log(LOG, Level.INFO);
        if (!isSupportedTransaction(transactionDetails)) {
            Map<String, String> safeReturn = safeFrameworkCustomData(transactionDetails);
            transactionTrace(flow, "onTransactionCreated", transactionDetails, null)
                .field("frameworkReturn", frameworkReturnLabel(safeReturn))
                .field("customDataSize", safeReturn.size())
                .field("result", "skip")
                .log(LOG, Level.INFO);
            return safeReturn;
        }
        XelerGoOrderLink link = LINKS.getByRid(transactionDetails.getRemoteTransactionId());
        if (link == null && isSupportedTransaction(transactionDetails) && transactionDetails.getType() == ITransactionDetails.TYPE_BUY_CRYPTO) {
            try {
                TronAddressValidator.ValidationResult addressValidation = validateBuyFallbackTransaction(transactionDetails);
                XelerGoConfig config = resolveConfigForTerminal("BUY", transactionDetails.getTerminalSerialNumber());
                XelerGoApiClient apiClient = new XelerGoApiClient(config, LOG);
                String terminalId = TerminalIdResolver.resolve(config, transactionDetails.getTerminalSerialNumber());
                ensureTerminalIdResolved("BUY", transactionDetails, terminalId);
                transactionTrace("BUY", "created_fallback", transactionDetails, null)
                    .field("terminalId", terminalId)
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("requestAttempted", true)
                    .field("requestDispatched", false)
                    .field("responseReceived", false)
                    .field("addressValidationLevel", addressValidation == null ? null : addressValidation.getValidationLevel())
                    .field("result", "before_dispatch")
                    .log(LOG, Level.INFO);
                XelerGoApiClient.CreateBuyOrderResponse buyOrder = apiClient.createBuyOrder(
                    transactionDetails.getRemoteTransactionId(),
                    terminalId,
                    nonNullAmount(transactionDetails.getCashAmount()),
                    nonNullAmount(transactionDetails.getCryptoAmount()),
                    transactionDetails.getCryptoAddress()
                );
                link = new XelerGoOrderLink(
                    buyOrder.getOrderId(),
                    "BUY",
                    transactionDetails.getRemoteTransactionId(),
                    transactionDetails.getTerminalSerialNumber(),
                    terminalId,
                    config.getConfigKey()
                );
                link.setBackendStatus(buyOrder.getStatus());
                link.setBackendRequestId(buyOrder.getRequestId());
                link.setCustomerDestinationAddress(transactionDetails.getCryptoAddress());
                link.setCryptoAmountToSend(transactionDetails.getCryptoAmount());
                LINKS.put(link);
                transactionTrace("BUY", "created_fallback", transactionDetails, link)
                    .field("terminalId", terminalId)
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("backendStatus", buyOrder.getStatus())
                    .field("backendRequestId", buyOrder.getRequestId())
                    .field("requestAttempted", true)
                    .field("requestDispatched", true)
                    .field("responseReceived", true)
                    .field("result", "ok")
                    .log(LOG, Level.INFO);
            } catch (Exception e) {
                String failureClass = e instanceof XelerGoApiException
                    ? ((XelerGoApiException) e).getFailureClass()
                    : e instanceof XelerGoLocalException
                        ? ((XelerGoLocalException) e).getFailureClass()
                        : XelerGoFailure.UNKNOWN;
                String failureCode = e instanceof XelerGoApiException
                    ? ((XelerGoApiException) e).getFailureCode()
                    : e instanceof XelerGoLocalException
                        ? ((XelerGoLocalException) e).getFailureCode()
                        : XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION;
                transactionTrace("BUY", "created_fallback", transactionDetails, null)
                    .field("requestAttempted", !(e instanceof XelerGoLocalException))
                    .field("requestDispatched", e instanceof XelerGoApiException)
                    .field("responseReceived", e instanceof XelerGoApiException && ((XelerGoApiException) e).getHttpStatus() > 0)
                    .field("failureClass", failureClass)
                    .field("failureCode", failureCode)
                    .field("failureReason", e.getMessage())
                    .field("result", "error")
                    .log(LOG, e instanceof XelerGoApiException ? resolveLogLevel((XelerGoApiException) e) : Level.WARNING, e);
            }
        }
        if (link == null) {
            Map<String, String> safeReturn = safeFrameworkCustomData(transactionDetails);
            transactionTrace(flow, "onTransactionCreated", transactionDetails, null)
                .field("failureClass", XelerGoFailure.STATE)
                .field("failureCode", XelerGoFailure.STATE_SYNC_LINK_MISSING)
                .field("failureReason", "No existe link local para construir customData en esta etapa.")
                .field("frameworkReturn", frameworkReturnLabel(safeReturn))
                .field("customDataSize", safeReturn.size())
                .field("result", "skip")
                .log(LOG, Level.WARNING);
            return safeReturn;
        } else {
            transactionTrace(flow, "onTransactionCreated", transactionDetails, link)
                .field("result", "custom_data")
                .log(LOG, Level.INFO);
        }
        return link.toCustomData();
    }

    @Override
    public Map<String, String> onTransactionUpdated(ITransactionDetails transactionDetails) {
        if (transactionDetails == null) {
            Map<String, String> safeReturn = emptyFrameworkCustomData();
            transactionTrace("UNKNOWN", "onTransactionUpdated", null, null)
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID)
                .field("failureReason", "CAS invoco onTransactionUpdated con transactionDetails nulo.")
                .field("frameworkReturn", frameworkReturnLabel(safeReturn))
                .field("customDataSize", safeReturn.size())
                .field("result", "error")
                .log(LOG, Level.SEVERE);
            return safeReturn;
        }
        String flow = transactionTypeName(transactionDetails.getType());
        transactionTrace(flow, "onTransactionUpdated", transactionDetails, null)
            .field("result", "enter")
            .log(LOG, Level.INFO);
        if (!isSupportedTransaction(transactionDetails)) {
            Map<String, String> safeReturn = safeFrameworkCustomData(transactionDetails);
            transactionTrace(flow, "onTransactionUpdated", transactionDetails, null)
                .field("frameworkReturn", frameworkReturnLabel(safeReturn))
                .field("customDataSize", safeReturn.size())
                .field("result", "skip")
                .log(LOG, Level.INFO);
            return safeReturn;
        }
        XelerGoOrderLink link = LINKS.syncFromCustomData(
            transactionDetails.getRemoteTransactionId(),
            transactionDetails.getTerminalSerialNumber(),
            transactionDetails.getCustomData()
        );
        if (link == null) {
            Map<String, String> safeReturn = safeFrameworkCustomData(transactionDetails);
            transactionTrace(flow, "onTransactionUpdated", transactionDetails, null)
                .field("failureClass", XelerGoFailure.STATE)
                .field("failureCode", XelerGoFailure.STATE_SYNC_LINK_MISSING)
                .field("failureReason", "No se encontro link local ni customData util para la transaccion.")
                .field("frameworkReturn", frameworkReturnLabel(safeReturn))
                .field("customDataSize", safeReturn.size())
                .field("result", "skip")
                .log(LOG, Level.WARNING);
            return safeReturn;
        }

        try {
            XelerGoConfig config = CONFIGS.findByKey(link.getConfigKey());
            if (config == null) {
                config = resolveConfigForTerminal(flow, transactionDetails.getTerminalSerialNumber());
                transactionTrace(flow, "onTransactionUpdated", transactionDetails, link)
                    .field("backendBaseUrl", config == null ? null : config.getBaseUrl())
                    .field("result", "config_recovered")
                    .log(LOG, Level.INFO);
            }
            if (config != null) {
                XelerGoApiClient client = new XelerGoApiClient(config, LOG);
                if (transactionDetails.getType() == ITransactionDetails.TYPE_BUY_CRYPTO
                    && transactionDetails.getStatus() == ITransactionDetails.STATUS_BUY_CANCELED) {
                    client.cancelBuyOrder(link.getOrderId());
                    transactionTrace("BUY", "cancel", transactionDetails, link)
                        .field("result", "requested")
                        .log(LOG, Level.INFO);
                } else if (transactionDetails.getType() == ITransactionDetails.TYPE_SELL_CRYPTO
                    && transactionDetails.getStatus() == ITransactionDetails.STATUS_SELL_ERROR
                    && !transactionDetails.isWithdrawn()
                    && !transactionDetails.canBeCashedOut()) {
                    client.cancelSellOrder(link.getOrderId());
                    transactionTrace("SELL", "cancel", transactionDetails, link)
                        .field("result", "requested")
                        .log(LOG, Level.INFO);
                } else if (transactionDetails.getType() == ITransactionDetails.TYPE_SELL_CRYPTO
                    && shouldAttemptCompleteSellPayout(link, transactionDetails.isWithdrawn())) {
                    try {
                        client.completeSellPayout(
                            link.getOrderId(),
                            transactionDetails.getRemoteTransactionId(),
                            link.getTerminalId()
                        );
                        link.setBackendStatus("COMPLETED");
                        transactionTrace("SELL", "complete_payout", transactionDetails, link)
                            .field("result", "completed")
                            .log(LOG, Level.INFO);
                    } catch (XelerGoApiException payoutError) {
                        if (payoutError.getHttpStatus() == 409) {
                            transactionTrace("SELL", "complete_payout", transactionDetails, link)
                                .field("backendCode", payoutError.getBackendCode())
                                .field("failureClass", payoutError.getFailureClass())
                                .field("failureCode", payoutError.getFailureCode())
                                .field("failureReason", payoutError.getMessage())
                                .field("result", "already_completed")
                                .log(LOG, Level.INFO);
                        } else {
                            throw payoutError;
                        }
                    }
                } else if (transactionDetails.getType() == ITransactionDetails.TYPE_SELL_CRYPTO
                    && transactionDetails.isWithdrawn()
                    && !"COMPLETED".equals(link.getBackendStatus())) {
                    transactionTrace("SELL", "complete_payout", transactionDetails, link)
                        .field("backendStatus", link.getBackendStatus())
                        .field("failureClass", XelerGoFailure.STATE)
                        .field("failureCode", XelerGoFailure.STATE_RESPONSE_NOT_READY)
                        .field("failureReason", "CAS reporta withdrawn=true pero el backend aun no esta READY_FOR_PAYOUT/COMPLETED.")
                        .field("result", "skipped")
                        .log(LOG, Level.INFO);
                }
            } else {
                transactionTrace(flow, "onTransactionUpdated", transactionDetails, link)
                    .field("failureClass", XelerGoFailure.CONFIG)
                    .field("failureCode", XelerGoFailure.CONFIG_WALLET_NOT_FOUND)
                    .field("failureReason", "No fue posible resolver configuracion para sincronizar la transaccion.")
                    .field("configSourceAttempted", "registry_then_cas_wallet_lookup")
                    .field("result", "skip")
                    .log(LOG, Level.WARNING);
            }
        } catch (XelerGoApiException e) {
            transactionTrace(flow, "onTransactionUpdated", transactionDetails, link)
                .field("failureClass", e.getFailureClass())
                .field("failureCode", e.getFailureCode())
                .field("failureReason", e.getMessage())
                .field("result", "ignored_error")
                .log(LOG, resolveLogLevel(e), e);
        } catch (XelerGoLocalException e) {
            transactionTrace(flow, "onTransactionUpdated", transactionDetails, link)
                .field("failureClass", e.getFailureClass())
                .field("failureCode", e.getFailureCode())
                .field("failureReason", e.getMessage())
                .field("result", "ignored_error")
                .log(LOG, Level.WARNING, e);
        } catch (RuntimeException e) {
            transactionTrace(flow, "onTransactionUpdated", transactionDetails, link)
                .field("failureClass", XelerGoFailure.UNKNOWN)
                .field("failureCode", XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION)
                .field("failureReason", e.getMessage())
                .field("result", "ignored_error")
                .log(LOG, Level.SEVERE, e);
        }

        Map<String, String> merged = new HashMap<>();
        if (transactionDetails.getCustomData() != null) {
            merged.putAll(transactionDetails.getCustomData());
        }
        merged.putAll(link.toCustomData());
        return merged;
    }

    private boolean isSupportedRequest(ITransactionRequest request) {
        return request != null
            && XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(request.getCryptoCurrency())
            && (request.getType() == ITransactionRequest.TYPE_BUY_CRYPTO
                || request.getType() == ITransactionRequest.TYPE_SELL_CRYPTO);
    }

    private boolean isSupportedPreparation(ITransactionPreparation preparation) {
        return preparation != null
            && XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(preparation.getCryptoCurrency())
            && (preparation.getType() == ITransactionPreparation.TYPE_BUY_CRYPTO
                || preparation.getType() == ITransactionPreparation.TYPE_SELL_CRYPTO);
    }

    private boolean isSupportedTransaction(ITransactionDetails details) {
        return details != null
            && XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(details.getCryptoCurrency())
            && (details.getType() == ITransactionDetails.TYPE_BUY_CRYPTO
                || details.getType() == ITransactionDetails.TYPE_SELL_CRYPTO);
    }

    private TronAddressValidator.ValidationResult validatePrecreateRequest(ITransactionRequest request, String flow) {
        if (XelerGoTrace.firstNonBlank(request == null ? null : request.getRemoteTransactionId()) == null) {
            requestTrace(flow, "validate_local", request)
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID)
                .field("failureReason", "CAS no entrego remoteTransactionId al listener en " + flow + ".")
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.CAS_INTERNAL,
                XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID,
                "CAS no entrego remoteTransactionId al listener en " + flow + "."
            );
        }
        if (request == null || request.getCashAmount() == null || request.getCashAmount().compareTo(BigDecimal.ZERO) <= 0) {
            requestTrace(flow, "validate_local", request)
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_CASH_AMOUNT)
                .field("failureReason", "cashAmount debe ser mayor que cero para " + flow + ".")
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.VALIDATION,
                XelerGoFailure.VALIDATION_MISSING_CASH_AMOUNT,
                "cashAmount debe ser mayor que cero para " + flow + "."
            );
        }
        if (request.getCryptoAmount() == null || request.getCryptoAmount().compareTo(BigDecimal.ZERO) <= 0) {
            requestTrace(flow, "validate_local", request)
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_CRYPTO_AMOUNT)
                .field("failureReason", "cryptoAmount debe ser mayor que cero para " + flow + ".")
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.VALIDATION,
                XelerGoFailure.VALIDATION_MISSING_CRYPTO_AMOUNT,
                "cryptoAmount debe ser mayor que cero para " + flow + "."
            );
        }
        if ("BUY".equals(flow)) {
            if (request.getCryptoAddress() == null || request.getCryptoAddress().trim().isEmpty()) {
                requestTrace(flow, "validate_local", request)
                    .field("requestAttempted", false)
                    .field("requestDispatched", false)
                    .field("responseReceived", false)
                    .field("failureClass", XelerGoFailure.VALIDATION)
                    .field("failureCode", XelerGoFailure.VALIDATION_MISSING_DESTINATION_ADDRESS)
                    .field("failureReason", "customerDestinationAddress es obligatorio para BUY.")
                    .field("result", "reject")
                    .log(LOG, Level.SEVERE);
                throw new XelerGoLocalException(
                    XelerGoFailure.VALIDATION,
                    XelerGoFailure.VALIDATION_MISSING_DESTINATION_ADDRESS,
                    "customerDestinationAddress es obligatorio para BUY."
                );
            }
            TronAddressValidator.ValidationResult validation = TRON_ADDRESS_VALIDATOR.validate(request.getCryptoAddress());
            if (!validation.isValid()) {
                requestTrace(flow, "validate_local", request)
                    .field("addressValidationLevel", validation.getValidationLevel())
                    .field("requestAttempted", false)
                    .field("requestDispatched", false)
                    .field("responseReceived", false)
                    .field("failureClass", XelerGoFailure.VALIDATION)
                    .field("failureCode", validation.getFailureCode() == null
                        ? XelerGoFailure.VALIDATION_INVALID_TRON_ADDRESS
                        : validation.getFailureCode())
                    .field("failureReason", validation.getMessage() == null
                        ? "La direccion TRON de BUY no paso la validacion local."
                        : validation.getMessage())
                    .field("result", "reject")
                    .log(LOG, Level.SEVERE);
                throw new XelerGoLocalException(
                    XelerGoFailure.VALIDATION,
                    validation.getFailureCode() == null ? XelerGoFailure.VALIDATION_INVALID_TRON_ADDRESS : validation.getFailureCode(),
                    validation.getMessage() == null
                        ? "La direccion TRON de BUY no paso la validacion local."
                        : validation.getMessage()
                );
            }
            requestTrace(flow, "validate_local", request)
                .field("addressValidationLevel", validation.getValidationLevel())
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("approvalResult", true)
                .field("result", "ok")
                .log(LOG, Level.INFO);
            return validation;
        }
        requestTrace(flow, "validate_local", request)
            .field("requestAttempted", false)
            .field("requestDispatched", false)
            .field("responseReceived", false)
            .field("approvalResult", true)
            .field("result", "ok")
            .log(LOG, Level.INFO);
        return null;
    }

    private TronAddressValidator.ValidationResult validateBuyFallbackTransaction(ITransactionDetails details) {
        if (XelerGoTrace.firstNonBlank(details == null ? null : details.getRemoteTransactionId()) == null) {
            transactionTrace("BUY", "validate_local", details, null)
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID)
                .field("failureReason", "CAS no entrego remoteTransactionId en onTransactionCreated para BUY.")
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.CAS_INTERNAL,
                XelerGoFailure.VALIDATION_MISSING_TRANSACTION_ID,
                "CAS no entrego remoteTransactionId en onTransactionCreated para BUY."
            );
        }
        if (details == null || details.getCashAmount() == null || details.getCashAmount().compareTo(BigDecimal.ZERO) <= 0) {
            transactionTrace("BUY", "validate_local", details, null)
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_CASH_AMOUNT)
                .field("failureReason", "cashAmount debe ser mayor que cero para el fallback BUY en onTransactionCreated.")
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.VALIDATION,
                XelerGoFailure.VALIDATION_MISSING_CASH_AMOUNT,
                "cashAmount debe ser mayor que cero para el fallback BUY en onTransactionCreated."
            );
        }
        if (details.getCryptoAmount() == null || details.getCryptoAmount().compareTo(BigDecimal.ZERO) <= 0) {
            transactionTrace("BUY", "validate_local", details, null)
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_CRYPTO_AMOUNT)
                .field("failureReason", "cryptoAmount debe ser mayor que cero para el fallback BUY en onTransactionCreated.")
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.VALIDATION,
                XelerGoFailure.VALIDATION_MISSING_CRYPTO_AMOUNT,
                "cryptoAmount debe ser mayor que cero para el fallback BUY en onTransactionCreated."
            );
        }
        if (details.getCryptoAddress() == null || details.getCryptoAddress().trim().isEmpty()) {
            transactionTrace("BUY", "validate_local", details, null)
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", XelerGoFailure.VALIDATION_MISSING_DESTINATION_ADDRESS)
                .field("failureReason", "customerDestinationAddress es obligatorio para el fallback BUY en onTransactionCreated.")
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.VALIDATION,
                XelerGoFailure.VALIDATION_MISSING_DESTINATION_ADDRESS,
                "customerDestinationAddress es obligatorio para el fallback BUY en onTransactionCreated."
            );
        }
        TronAddressValidator.ValidationResult validation = TRON_ADDRESS_VALIDATOR.validate(details.getCryptoAddress());
        if (!validation.isValid()) {
            transactionTrace("BUY", "validate_local", details, null)
                .field("addressValidationLevel", validation.getValidationLevel())
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", validation.getFailureCode() == null
                    ? XelerGoFailure.VALIDATION_INVALID_TRON_ADDRESS
                    : validation.getFailureCode())
                .field("failureReason", validation.getMessage() == null
                    ? "La direccion TRON del fallback BUY no paso la validacion local."
                    : validation.getMessage())
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.VALIDATION,
                validation.getFailureCode() == null ? XelerGoFailure.VALIDATION_INVALID_TRON_ADDRESS : validation.getFailureCode(),
                validation.getMessage() == null
                    ? "La direccion TRON del fallback BUY no paso la validacion local."
                    : validation.getMessage()
            );
        }
        transactionTrace("BUY", "validate_local", details, null)
            .field("addressValidationLevel", validation.getValidationLevel())
            .field("requestAttempted", false)
            .field("requestDispatched", false)
            .field("responseReceived", false)
            .field("result", "ok")
            .log(LOG, Level.INFO);
        return validation;
    }

    private static BigDecimal nonNullAmount(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    static boolean shouldAttemptCompleteSellPayout(XelerGoOrderLink link, boolean withdrawn) {
        return withdrawn
            && link != null
            && "SELL".equals(link.getOrderType())
            && "READY_FOR_PAYOUT".equals(link.getBackendStatus());
    }

    private static XelerGoLogger.Level resolveLogLevel(XelerGoApiException error) {
        if (error.isTemporary() || error.isConflict()) {
            return XelerGoLogger.Level.WARN;
        }
        if (error.isUnauthorized()) {
            return XelerGoLogger.Level.ERROR;
        }
        return XelerGoLogger.Level.WARN;
    }

    private XelerGoConfig resolveConfigForTerminal(String terminalSerialNumber) {
        return resolveConfigForTerminal("INIT", terminalSerialNumber);
    }

    private XelerGoConfig resolveConfigForTerminal(String flow, String terminalSerialNumber) {
        long startedAt = System.currentTimeMillis();
        if (extensionContext == null) {
            XelerGoTrace.create()
                .field("flow", flow)
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", terminalSerialNumber)
                .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_EXTENSION_CONTEXT_MISSING)
                .field("failureReason", "XelerGoExtension aun no tiene IExtensionContext disponible.")
                .field("configSourceAttempted", "cas_wallet_lookup")
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.CONFIG,
                XelerGoFailure.CONFIG_EXTENSION_CONTEXT_MISSING,
                "XelerGoExtension aun no tiene IExtensionContext disponible."
            );
        }
        String invalidSerialReason = XelerGoTerminalSerials.invalidReasonForCasLookup(terminalSerialNumber);
        if (invalidSerialReason != null) {
            XelerGoTrace.create()
                .field("flow", flow)
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", terminalSerialNumber)
                .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_TERMINAL_SERIAL_INVALID)
                .field("failureReason", invalidSerialReason)
                .field("configSourceAttempted", "cas_wallet_lookup")
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.CONFIG,
                XelerGoFailure.CONFIG_TERMINAL_SERIAL_INVALID,
                invalidSerialReason
            );
        }
        XelerGoTrace.create()
            .field("flow", flow)
            .field("stage", "config_resolution")
            .field("terminalSerialNumber", terminalSerialNumber)
            .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
            .field("configSourceAttempted", "cas_wallet_lookup")
            .field("result", "enter")
            .log(LOG, Level.INFO);
        IWallet wallet;
        try {
            wallet = extensionContext.findBuyWallet(terminalSerialNumber, XelerGoConfig.CRYPTO_CURRENCY);
        } catch (RuntimeException e) {
            String frameworkInvalidSerialMessage = XelerGoTerminalSerials.frameworkInvalidSerialMessage(e);
            if (frameworkInvalidSerialMessage != null) {
                String failureReason = "CAS rechazo el terminalSerialNumber como invalido para lookup de wallet: "
                    + frameworkInvalidSerialMessage;
                XelerGoTrace.create()
                    .field("flow", flow)
                    .field("stage", "config_resolution")
                    .field("terminalSerialNumber", terminalSerialNumber)
                    .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                    .field("failureClass", XelerGoFailure.CONFIG)
                    .field("failureCode", XelerGoFailure.CONFIG_TERMINAL_SERIAL_INVALID)
                    .field("failureReason", failureReason)
                    .field("configSourceAttempted", "cas_wallet_lookup")
                    .field("durationMs", System.currentTimeMillis() - startedAt)
                    .field("result", "reject")
                    .log(LOG, Level.SEVERE);
                throw new XelerGoLocalException(
                    XelerGoFailure.CONFIG,
                    XelerGoFailure.CONFIG_TERMINAL_SERIAL_INVALID,
                    failureReason,
                    e
                );
            }
            XelerGoTrace.create()
                .field("flow", flow)
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", terminalSerialNumber)
                .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                .field("failureClass", XelerGoFailure.UNKNOWN)
                .field("failureCode", XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION)
                .field("failureReason", e.getMessage())
                .field("configSourceAttempted", "cas_wallet_lookup")
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(LOG, Level.SEVERE, e);
            throw e;
        }
        if (wallet == null) {
            XelerGoTrace.create()
                .field("flow", flow)
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", terminalSerialNumber)
                .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_WALLET_NOT_FOUND)
                .field("failureReason", "No se encontro una wallet XelerGo en CAS para la terminal " + safe(terminalSerialNumber)
                    + ". Si la terminal esta configurada, revisar stage=createWallet para identificar un walletLogin invalido.")
                .field("configSourceAttempted", "cas_wallet_lookup")
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.CONFIG,
                XelerGoFailure.CONFIG_WALLET_NOT_FOUND,
                "No se encontro una wallet XelerGo en CAS para la terminal " + safe(terminalSerialNumber)
                    + ". Si la terminal esta configurada, revisar stage=createWallet para identificar un walletLogin invalido."
            );
        }
        if (!(wallet instanceof XelerGoWallet)) {
            XelerGoTrace.create()
                .field("flow", flow)
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", terminalSerialNumber)
                .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_WALLET_TYPE_UNSUPPORTED)
                .field("failureReason", "CAS devolvio una wallet incompatible para la terminal " + safe(terminalSerialNumber) + ": "
                    + wallet.getClass().getName())
                .field("configSourceAttempted", "cas_wallet_lookup")
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.CONFIG,
                XelerGoFailure.CONFIG_WALLET_TYPE_UNSUPPORTED,
                "CAS devolvio una wallet incompatible para la terminal " + safe(terminalSerialNumber) + ": "
                    + wallet.getClass().getName()
            );
        }
        XelerGoConfig config = ((XelerGoWallet) wallet).getConfig();
        CONFIGS.register(config);
        XelerGoTrace.create()
            .field("flow", flow)
            .field("stage", "config_resolution")
            .field("terminalSerialNumber", terminalSerialNumber)
            .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
            .field("backendBaseUrl", config.getBaseUrl())
            .field("configKey", config.getConfigKey())
            .field("configSourceAttempted", "cas_wallet_lookup")
            .field("durationMs", System.currentTimeMillis() - startedAt)
            .field("result", "ok")
            .log(LOG, Level.INFO);
        return config;
    }

    private void registerTransactionListener(IExtensionContext ctx) {
        try {
            XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "init_transaction_listener")
                .field("result", "register")
                .log(LOG, Level.INFO);
            ctx.addTransactionListener(this);
            XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "init_transaction_listener")
                .field("result", "registered")
                .log(LOG, Level.INFO);
        } catch (Throwable error) {
            logInitFailure("transaction-listener", error);
        }
    }

    private void registerTransactionSyncTask(IExtensionContext ctx) {
        try {
            XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "init_transaction_sync_task")
                .field("result", "register")
                .log(LOG, Level.INFO);
            ctx.addTask(
                "XelerGoTransactionSyncTask",
                new XelerGoTransactionSyncTask(ctx, CONFIGS, LINKS, LOG),
                null
            );
            XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "init_transaction_sync_task")
                .field("result", "registered")
                .log(LOG, Level.INFO);
        } catch (Throwable error) {
            logInitFailure("transaction-sync-task", error);
        }
    }

    private void logInitFailure(String component, Throwable error) {
        try {
            XelerGoTrace.create()
                .field("flow", "SYSTEM")
                .field("stage", "init_" + component)
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.INIT_COMPONENT_ERROR)
                .field("failureReason", error.getMessage())
                .field("result", "error")
                .log(LOG, Level.WARNING, error);
        } catch (Throwable ignored) {
            // Avoid hiding the original init problem behind logging issues.
        }
    }

    private void ensureTerminalIdResolved(String flow, ITransactionRequest request, String terminalId) {
        if (terminalId == null || terminalId.trim().isEmpty()) {
            requestTrace(flow, "terminal_id", request)
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_TERMINAL_ID_UNRESOLVED)
                .field("failureReason", "No se pudo resolver terminalId para " + flow + " usando terminalSerialNumber="
                    + safe(request == null ? null : request.getTerminalSerialNumber()) + ".")
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.CONFIG,
                XelerGoFailure.CONFIG_TERMINAL_ID_UNRESOLVED,
                "No se pudo resolver terminalId para " + flow + " usando terminalSerialNumber="
                    + safe(request == null ? null : request.getTerminalSerialNumber()) + "."
            );
        }
    }

    private void ensureTerminalIdResolved(String flow, ITransactionDetails details, String terminalId) {
        if (terminalId == null || terminalId.trim().isEmpty()) {
            transactionTrace(flow, "terminal_id", details, null)
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_TERMINAL_ID_UNRESOLVED)
                .field("failureReason", "No se pudo resolver terminalId para " + flow + " usando terminalSerialNumber="
                    + safe(details == null ? null : details.getTerminalSerialNumber()) + ".")
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reject")
                .log(LOG, Level.SEVERE);
            throw new XelerGoLocalException(
                XelerGoFailure.CONFIG,
                XelerGoFailure.CONFIG_TERMINAL_ID_UNRESOLVED,
                "No se pudo resolver terminalId para " + flow + " usando terminalSerialNumber="
                    + safe(details == null ? null : details.getTerminalSerialNumber()) + "."
            );
        }
    }

    private static String localTransactionId(ITransactionRequest request) {
        return XelerGoTrace.reflectString(request, "getLocalTransactionId");
    }

    private static String localTransactionId(ITransactionDetails details) {
        return XelerGoTrace.reflectString(details, "getLocalTransactionId");
    }

    private static String identityPublicId(Object value) {
        return XelerGoTrace.reflectString(value, "getIdentityPublicId");
    }

    private static boolean hasErrorMessage(ITransactionRequest request) {
        return request != null && request.getErrorMessage() != null && !request.getErrorMessage().trim().isEmpty();
    }

    private static String userFacingPrecreateMessage(String flow) {
        return "SELL".equals(flow)
            ? "No fue posible inicializar la orden SELL en XelerGo."
            : "No fue posible inicializar la orden BUY en XelerGo.";
    }

    private XelerGoTrace enrichWalletLoginTrace(XelerGoTrace trace, String walletLogin) {
        List<String> parts = walletLoginParts(walletLogin);
        String apiKey = walletLoginPart(parts, 5);
        String staticTerminalId = walletLoginPart(parts, 9);
        return trace
            .field("walletLoginPresent", Boolean.valueOf(walletLogin != null && !walletLogin.trim().isEmpty()))
            .field("walletLoginLength", Integer.valueOf(walletLogin == null ? 0 : walletLogin.trim().length()))
            .field("walletLoginPartCount", Integer.valueOf(parts.size()))
            .field("walletPrefix", walletLoginPart(parts, 0))
            .field("apiProtocol", walletLoginPart(parts, 1))
            .field("apiHost", walletLoginPart(parts, 2))
            .field("apiPort", walletLoginPart(parts, 3))
            .field("apiBasePath", walletLoginPart(parts, 4))
            .field("terminalIdModeRaw", walletLoginPart(parts, 8))
            .field("staticTerminalIdPresent", Boolean.valueOf(staticTerminalId != null && !staticTerminalId.trim().isEmpty()))
            .field("apiKeyPresent", Boolean.valueOf(apiKey != null && !apiKey.trim().isEmpty()))
            .field("apiKeyLength", Integer.valueOf(apiKey == null ? 0 : apiKey.trim().length()))
            .field("walletLoginMasked", maskedWalletLogin(walletLogin));
    }

    private static Map<String, String> safeFrameworkCustomData(ITransactionDetails details) {
        Map<String, String> customData = new HashMap<String, String>();
        if (details != null && details.getCustomData() != null) {
            customData.putAll(details.getCustomData());
        }
        return customData;
    }

    private static Map<String, String> emptyFrameworkCustomData() {
        return new HashMap<String, String>();
    }

    private static List<String> walletLoginParts(String walletLogin) {
        if (walletLogin == null || walletLogin.trim().isEmpty()) {
            return Collections.emptyList();
        }
        return Arrays.asList(walletLogin.trim().split(":", -1));
    }

    private static String walletLoginPart(List<String> parts, int index) {
        if (parts == null || parts.size() <= index) {
            return null;
        }
        return XelerGoTrace.truncate(parts.get(index), 64);
    }

    private static String maskedWalletLogin(String walletLogin) {
        List<String> parts = walletLoginParts(walletLogin);
        if (parts.isEmpty()) {
            return "<missing>";
        }
        String[] masked = parts.toArray(new String[parts.size()]);
        if (masked.length > 5) {
            String apiKey = masked[5];
            masked[5] = apiKey == null || apiKey.trim().isEmpty()
                ? "<empty>"
                : "<hidden len=" + apiKey.trim().length() + ">";
        }
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < masked.length; i++) {
            if (i > 0) {
                builder.append(':');
            }
            builder.append(masked[i] == null ? "" : masked[i]);
        }
        return XelerGoTrace.truncate(builder.toString(), 160);
    }

    private static String frameworkReturnLabel(Map<String, String> customData) {
        return customData == null || customData.isEmpty() ? "empty_map" : "existing_custom_data";
    }

    private XelerGoTrace requestTrace(String flow, String stage, ITransactionRequest request) {
        return XelerGoTrace.create()
            .field("flow", flow)
            .field("stage", stage)
            .field("correlationId", XelerGoTrace.correlationId(
                request == null ? null : request.getRemoteTransactionId(),
                localTransactionId(request),
                null
            ))
            .field("terminalSerialNumber", request == null ? null : request.getTerminalSerialNumber())
            .field("transactionId", request == null ? null : request.getRemoteTransactionId())
            .field("remoteTransactionId", request == null ? null : request.getRemoteTransactionId())
            .field("localTransactionId", localTransactionId(request))
            .field("cryptoCurrency", request == null ? null : request.getCryptoCurrency())
            .field("cashAmount", String.valueOf(nonNullAmount(request == null ? null : request.getCashAmount())))
            .field("cryptoAmount", String.valueOf(nonNullAmount(request == null ? null : request.getCryptoAmount())))
            .maskedAddress("address", request == null ? null : request.getCryptoAddress())
            .maskedIdentity("identityPublicId", identityPublicId(request));
    }

    private XelerGoTrace preparationTrace(String flow, String stage, ITransactionPreparation preparation) {
        return XelerGoTrace.create()
            .field("flow", flow)
            .field("stage", stage)
            .field("correlationId", XelerGoTrace.correlationId(null, preparation == null ? null : preparation.getLocalTransactionId(), null))
            .field("terminalSerialNumber", preparation == null ? null : preparation.getTerminalSerialNumber())
            .field("remoteTransactionId", preparation == null ? null : XelerGoTrace.reflectString(preparation, "getRemoteTransactionId"))
            .field("localTransactionId", preparation == null ? null : preparation.getLocalTransactionId())
            .field("cryptoCurrency", preparation == null ? null : preparation.getCryptoCurrency())
            .field("cashAmount", String.valueOf(nonNullAmount(preparation == null ? null : preparation.getCashAmount())))
            .maskedAddress("address", preparation == null ? null : preparation.getCryptoAddress())
            .maskedIdentity("identityPublicId", preparation == null ? null : preparation.getIdentityPublicId());
    }

    private XelerGoTrace transactionTrace(String flow, String stage, ITransactionDetails details, XelerGoOrderLink link) {
        return XelerGoTrace.create()
            .field("flow", flow)
            .field("stage", stage)
            .field("correlationId", XelerGoTrace.correlationId(
                details == null ? null : details.getRemoteTransactionId(),
                localTransactionId(details),
                link == null ? null : link.getOrderId()
            ))
            .field("terminalSerialNumber", details == null ? null : details.getTerminalSerialNumber())
            .field("terminalId", link == null ? null : link.getTerminalId())
            .field("transactionId", details == null ? null : details.getRemoteTransactionId())
            .field("remoteTransactionId", details == null ? null : details.getRemoteTransactionId())
            .field("localTransactionId", localTransactionId(details))
            .field("orderId", link == null ? null : link.getOrderId())
            .field("cryptoCurrency", details == null ? null : details.getCryptoCurrency())
            .field("cashAmount", String.valueOf(nonNullAmount(details == null ? null : details.getCashAmount())))
            .field("cryptoAmount", String.valueOf(nonNullAmount(details == null ? null : details.getCryptoAmount())))
            .field("casStatus", details == null ? null : details.getStatus())
            .field("withdrawn", details == null ? null : details.isWithdrawn())
            .field("canBeCashedOut", details == null ? null : details.canBeCashedOut())
            .maskedAddress("address", details == null ? null : details.getCryptoAddress())
            .maskedIdentity("identityPublicId", identityPublicId(details));
    }

    private static String transactionTypeName(int type) {
        if (type == ITransactionRequest.TYPE_SELL_CRYPTO || type == ITransactionDetails.TYPE_SELL_CRYPTO) {
            return "SELL";
        }
        if (type == ITransactionRequest.TYPE_BUY_CRYPTO || type == ITransactionDetails.TYPE_BUY_CRYPTO) {
            return "BUY";
        }
        return "UNKNOWN";
    }
}
