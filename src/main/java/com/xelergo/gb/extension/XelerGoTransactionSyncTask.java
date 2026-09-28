package com.xelergo.gb.extension;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.generalbytes.batm.server.extensions.IExtensionContext;
import com.generalbytes.batm.server.extensions.ITask;
import com.generalbytes.batm.server.extensions.ITerminal;
import com.generalbytes.batm.server.extensions.ITransactionDetails;
import com.generalbytes.batm.server.extensions.IWallet;
import com.generalbytes.batm.server.extensions.exceptions.UpdateException;

import org.slf4j.Logger;

final class XelerGoTransactionSyncTask implements ITask {
    private static final long DEFAULT_POLLING_MS = 15000L;
    private static final long CONFIG_SKIP_LOG_INTERVAL_MS = 60000L;

    private final IExtensionContext ctx;
    private final XelerGoConfigRegistry configRegistry;
    private final XelerGoOrderLinkRegistry registry;
    private final Logger log;
    private final Map<String, Long> nextConfigSkipLogAt = new ConcurrentHashMap<String, Long>();

        XelerGoTransactionSyncTask(
        IExtensionContext ctx,
        XelerGoConfigRegistry configRegistry,
        XelerGoOrderLinkRegistry registry,
        Logger log
    ) {
        this.ctx = ctx;
        this.configRegistry = configRegistry;
        this.registry = registry;
        this.log = log;
    }

    @Override
    public boolean onCreate() {
        XelerGoTrace.create()
            .field("flow", "SYNC")
            .field("stage", "transaction_sync")
            .field("result", "started")
            .log(log, XelerGoLogger.Level.INFO);
        return true;
    }

    @Override
    public boolean onDoStep() {
        XelerGoTrace.create()
            .field("flow", "SYNC")
            .field("stage", "transaction_sync")
            .field("result", "step_start")
            .log(log, XelerGoLogger.Level.DEBUG);
        try {
            List<ITerminal> terminals = ctx.findAllTerminals();
            if (terminals == null) {
                XelerGoTrace.create()
                    .field("flow", "SYNC")
                    .field("stage", "transaction_sync")
                    .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                        .field("failureCode", XelerGoFailure.CAS_TERMINALS_NULL)
                        .field("failureReason", "IExtensionContext.findAllTerminals() devolvio null.")
                        .field("result", "skip")
                    .log(log, XelerGoLogger.Level.WARN);
                return false;
            }
            XelerGoTrace.create()
                .field("flow", "SYNC")
                .field("stage", "transaction_sync")
                .field("terminals", terminals.size())
                .field("result", "terminals_loaded")
                .log(log, XelerGoLogger.Level.DEBUG);
            for (ITerminal terminal : terminals) {
                if (terminal == null || terminal.getSerialNumber() == null) {
                    XelerGoTrace.create()
                        .field("flow", "SYNC")
                        .field("stage", "transaction_sync")
                        .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                        .field("failureCode", XelerGoFailure.CAS_TERMINAL_SERIAL_MISSING)
                        .field("failureReason", "IExtensionContext devolvio una terminal sin serial.")
                        .field("result", "skip")
                        .log(log, XelerGoLogger.Level.DEBUG);
                    continue;
                }
                syncTerminal(terminal.getSerialNumber());
            }
        } catch (RuntimeException e) {
            XelerGoTrace.create()
                .field("flow", "SYNC")
                .field("stage", "transaction_sync")
                .field("failureClass", XelerGoFailure.UNKNOWN)
                .field("failureCode", XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION)
                .field("failureReason", e.getMessage())
                .field("result", "error")
                .log(log, XelerGoLogger.Level.WARN, e);
        }
        return false;
    }

    private void syncTerminal(String terminalSerialNumber) {
        XelerGoConfig config = resolveTerminalConfigOrNull(terminalSerialNumber);
        if (config == null) {
            return;
        }
        XelerGoTrace.create()
            .field("flow", "SYNC")
            .field("stage", "transaction_sync")
            .field("terminalSerialNumber", safe(terminalSerialNumber))
            .field("result", "load_transactions")
            .log(log, XelerGoLogger.Level.DEBUG);
        Date from = Date.from(Instant.now().minus(config.getLookbackHours(), ChronoUnit.HOURS));
        List<ITransactionDetails> transactions = ctx.findTransactions(terminalSerialNumber, from, null, null, false);
        if (transactions == null) {
            XelerGoTrace.create()
                .field("flow", "SYNC")
                .field("stage", "transaction_sync")
                .field("terminalSerialNumber", safe(terminalSerialNumber))
                .field("result", "no_transactions_list")
                .log(log, XelerGoLogger.Level.DEBUG);
            return;
        }
        XelerGoTrace.create()
            .field("flow", "SYNC")
            .field("stage", "transaction_sync")
            .field("terminalSerialNumber", safe(terminalSerialNumber))
            .field("transactions", transactions.size())
            .field("result", "transactions_loaded")
            .log(log, XelerGoLogger.Level.DEBUG);
        for (ITransactionDetails transaction : transactions) {
            if (transaction == null || !XelerGoConfig.CRYPTO_CURRENCY.equalsIgnoreCase(transaction.getCryptoCurrency())) {
                continue;
            }
            if (transaction.getType() != ITransactionDetails.TYPE_BUY_CRYPTO && transaction.getType() != ITransactionDetails.TYPE_SELL_CRYPTO) {
                continue;
            }
            syncTransaction(transaction, config);
        }
    }

    private void syncTransaction(ITransactionDetails transaction, XelerGoConfig terminalConfig) {
        XelerGoTrace.create()
            .field("flow", transaction.getType() == ITransactionDetails.TYPE_SELL_CRYPTO ? "SELL" : "BUY")
            .field("stage", "transaction_sync")
            .field("correlationId", XelerGoTrace.correlationId(transaction.getRemoteTransactionId(), XelerGoTrace.reflectString(transaction, "getLocalTransactionId"), null))
            .field("transactionId", transaction.getRemoteTransactionId())
            .field("terminalSerialNumber", transaction.getTerminalSerialNumber())
            .field("type", transaction.getType())
            .field("result", "transaction_start")
            .log(log, XelerGoLogger.Level.INFO);
        XelerGoOrderLink link = registry.syncFromCustomData(
            transaction.getRemoteTransactionId(),
            transaction.getTerminalSerialNumber(),
            transaction.getCustomData()
        );
        if (link == null) {
            XelerGoTrace.create()
                .field("flow", transaction.getType() == ITransactionDetails.TYPE_SELL_CRYPTO ? "SELL" : "BUY")
                .field("stage", "transaction_sync")
                .field("correlationId", XelerGoTrace.correlationId(transaction.getRemoteTransactionId(), XelerGoTrace.reflectString(transaction, "getLocalTransactionId"), null))
                .field("transactionId", transaction.getRemoteTransactionId())
                .field("terminalSerialNumber", transaction.getTerminalSerialNumber())
                .field("failureClass", XelerGoFailure.STATE)
                .field("failureCode", XelerGoFailure.STATE_SYNC_LINK_MISSING)
                .field("failureReason", "No existe link local ni customData util para sincronizar la transaccion.")
                .field("result", "skip")
                .log(log, XelerGoLogger.Level.WARN);
            return;
        }
        XelerGoConfig config = configRegistry.findByKey(link.getConfigKey());
        if (config == null && terminalConfig != null) {
            config = terminalConfig;
            XelerGoTrace.create()
                .field("flow", "SYNC")
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", transaction.getTerminalSerialNumber())
                .field("transactionId", transaction.getRemoteTransactionId())
                .field("orderId", link.getOrderId())
                .field("cryptoCurrency", transaction.getCryptoCurrency())
                .field("configKey", link.getConfigKey())
                .field("backendBaseUrl", terminalConfig.getBaseUrl())
                .field("configSourceAttempted", "registry_then_terminal_lookup")
                .field("result", "ok")
                .log(log, XelerGoLogger.Level.INFO);
        }
        if (config == null) {
            logSyncSkip(
                terminalSerialNumber(transaction),
                transaction.getCryptoCurrency(),
                transaction.getRemoteTransactionId(),
                link.getOrderId(),
                link.getConfigKey(),
                "registry_then_terminal_lookup",
                XelerGoFailure.SYNC_CONFIG_NOT_AVAILABLE,
                "No existe configuracion util para sincronizar la orden; se requiere resolverla nuevamente desde CAS.",
                XelerGoLogger.Level.WARN,
                System.currentTimeMillis()
            );
            return;
        }
        XelerGoApiClient client = new XelerGoApiClient(config, log);
        try {
            if ("SELL".equals(link.getOrderType())) {
                syncSellTransaction(transaction, link, client);
            } else if ("BUY".equals(link.getOrderType())) {
                syncBuyTransaction(transaction, link, client);
            }
        } catch (XelerGoApiException e) {
            XelerGoTrace.create()
                .field("flow", link.getOrderType())
                .field("stage", "transaction_sync")
                .field("correlationId", XelerGoTrace.correlationId(transaction.getRemoteTransactionId(), XelerGoTrace.reflectString(transaction, "getLocalTransactionId"), link.getOrderId()))
                .field("transactionId", transaction.getRemoteTransactionId())
                .field("orderId", link.getOrderId())
                .field("backendRequestId", e.getBackendRequestId())
                .field("backendCode", e.getBackendCode())
                .field("failureClass", e.getFailureClass())
                .field("failureCode", e.getFailureCode())
                .field("failureReason", e.getMessage())
                .field("result", "backend_error")
                .log(log, resolveLogLevel(e), e);
        } catch (RuntimeException e) {
            XelerGoTrace.create()
                .field("flow", link.getOrderType())
                .field("stage", "transaction_sync")
                .field("correlationId", XelerGoTrace.correlationId(transaction.getRemoteTransactionId(), XelerGoTrace.reflectString(transaction, "getLocalTransactionId"), link.getOrderId()))
                .field("transactionId", transaction.getRemoteTransactionId())
                .field("orderId", link.getOrderId())
                .field("failureClass", XelerGoFailure.UNKNOWN)
                .field("failureCode", XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION)
                .field("failureReason", e.getMessage())
                .field("result", "runtime_error")
                .log(log, XelerGoLogger.Level.ERROR, e);
        }
    }

    private void syncSellTransaction(ITransactionDetails transaction, XelerGoOrderLink link, XelerGoApiClient client) throws XelerGoApiException {
        XelerGoApiClient.OrderStatusResponse order = client.getSellOrder(link.getOrderId());
        order = maybeCompleteSellPayout(transaction, link, client, order);
        link.setBackendStatus(order.getStatus());
        link.setBackendRequestId(order.getRequestId());
        link.setDepositAddress(order.getDepositAddress());
        link.setCryptoAmountExpected(order.getCryptoAmountExpected());
        link.setCryptoAmountReceived(order.getCryptoAmountReceived());
        registry.put(link);

        int mappedStatus = XelerGoStatusMapper.mapSellStatus(order.getStatus());
        Map<String, String> customData = mergeCustomData(transaction.getCustomData(), link);

        if (transaction.getStatus() != mappedStatus || customDataChanged(transaction.getCustomData(), customData)) {
            try {
                ctx.updateTransaction(transaction.getRemoteTransactionId(), mappedStatus, null, customData);
                XelerGoTrace.create()
                    .field("flow", "SELL")
                    .field("stage", "transaction_sync")
                    .field("correlationId", XelerGoTrace.correlationId(transaction.getRemoteTransactionId(), XelerGoTrace.reflectString(transaction, "getLocalTransactionId"), link.getOrderId()))
                    .field("transactionId", transaction.getRemoteTransactionId())
                    .field("orderId", link.getOrderId())
                    .field("backendStatus", order.getStatus())
                    .field("casStatus", mappedStatus)
                    .field("backendRequestId", order.getRequestId())
                    .field("result", "updated")
                    .log(log, XelerGoLogger.Level.INFO);
            } catch (UpdateException e) {
                XelerGoTrace.create()
                    .field("flow", "SELL")
                    .field("stage", "transaction_sync")
                    .field("transactionId", transaction.getRemoteTransactionId())
                    .field("orderId", link.getOrderId())
                    .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                    .field("failureCode", XelerGoFailure.CAS_UPDATE_FAILED)
                    .field("failureReason", e.getMessage())
                    .field("result", "update_failed")
                    .log(log, XelerGoLogger.Level.WARN, e);
            }
        }
    }

    private XelerGoApiClient.OrderStatusResponse maybeCompleteSellPayout(
        ITransactionDetails transaction,
        XelerGoOrderLink link,
        XelerGoApiClient client,
        XelerGoApiClient.OrderStatusResponse order
    ) throws XelerGoApiException {
        if (!transaction.isWithdrawn()) {
            return order;
        }
        if ("COMPLETED".equals(order.getStatus())) {
            return order;
        }
        if (!"READY_FOR_PAYOUT".equals(order.getStatus())) {
            XelerGoTrace.create()
                .field("flow", "SELL")
                .field("stage", "complete_payout_sync")
                .field("correlationId", XelerGoTrace.correlationId(transaction.getRemoteTransactionId(), XelerGoTrace.reflectString(transaction, "getLocalTransactionId"), link.getOrderId()))
                .field("transactionId", transaction.getRemoteTransactionId())
                .field("orderId", link.getOrderId())
                .field("backendStatus", order.getStatus())
                .field("failureClass", XelerGoFailure.STATE)
                .field("failureCode", XelerGoFailure.STATE_RESPONSE_NOT_READY)
                .field("failureReason", "La orden aun no esta READY_FOR_PAYOUT para ejecutar complete-payout.")
                .field("result", "skipped")
                .log(log, XelerGoLogger.Level.INFO);
            return order;
        }

        client.completeSellPayout(link.getOrderId(), transaction.getRemoteTransactionId(), link.getTerminalId());
        XelerGoTrace.create()
            .field("flow", "SELL")
            .field("stage", "complete_payout_sync")
            .field("correlationId", XelerGoTrace.correlationId(transaction.getRemoteTransactionId(), XelerGoTrace.reflectString(transaction, "getLocalTransactionId"), link.getOrderId()))
            .field("transactionId", transaction.getRemoteTransactionId())
            .field("orderId", link.getOrderId())
            .field("terminalId", link.getTerminalId())
            .field("result", "completed")
            .log(log, XelerGoLogger.Level.INFO);
        return client.getSellOrder(link.getOrderId());
    }

    private void syncBuyTransaction(ITransactionDetails transaction, XelerGoOrderLink link, XelerGoApiClient client) throws XelerGoApiException {
        XelerGoApiClient.OrderStatusResponse order = client.getBuyOrder(link.getOrderId());
        link.setBackendStatus(order.getStatus());
        link.setBackendRequestId(order.getRequestId());
        link.setCustomerDestinationAddress(order.getCustomerDestinationAddress());
        link.setCryptoAmountToSend(order.getCryptoAmountToSend());
        link.setTxid(order.getTxid());
        registry.put(link);

        int mappedStatus = XelerGoStatusMapper.mapBuyStatus(order.getStatus());
        Map<String, String> customData = mergeCustomData(transaction.getCustomData(), link);

        try {
            if (order.getTxid() != null) {
                ctx.addTransactionHash(transaction.getRemoteTransactionId(), order.getTxid());
            }
        } catch (UpdateException e) {
            XelerGoTrace.create()
                .field("flow", "BUY")
                .field("stage", "transaction_sync")
                .field("transactionId", transaction.getRemoteTransactionId())
                .field("orderId", link.getOrderId())
                .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                .field("failureCode", XelerGoFailure.CAS_ADD_HASH_FAILED)
                .field("failureReason", e.getMessage())
                .field("result", "add_hash_failed")
                .log(log, XelerGoLogger.Level.WARN, e);
        }

        if (transaction.getStatus() != mappedStatus || customDataChanged(transaction.getCustomData(), customData)) {
            try {
                ctx.updateTransaction(transaction.getRemoteTransactionId(), mappedStatus, null, customData);
                XelerGoTrace.create()
                    .field("flow", "BUY")
                    .field("stage", "transaction_sync")
                    .field("correlationId", XelerGoTrace.correlationId(transaction.getRemoteTransactionId(), XelerGoTrace.reflectString(transaction, "getLocalTransactionId"), link.getOrderId()))
                    .field("transactionId", transaction.getRemoteTransactionId())
                    .field("orderId", link.getOrderId())
                    .field("backendStatus", order.getStatus())
                    .field("casStatus", mappedStatus)
                    .field("txid", order.getTxid())
                    .field("backendRequestId", order.getRequestId())
                    .field("result", "updated")
                    .log(log, XelerGoLogger.Level.INFO);
            } catch (UpdateException e) {
                XelerGoTrace.create()
                    .field("flow", "BUY")
                    .field("stage", "transaction_sync")
                    .field("transactionId", transaction.getRemoteTransactionId())
                    .field("orderId", link.getOrderId())
                    .field("failureClass", XelerGoFailure.CAS_INTERNAL)
                    .field("failureCode", XelerGoFailure.CAS_UPDATE_FAILED)
                    .field("failureReason", e.getMessage())
                    .field("result", "update_failed")
                    .log(log, XelerGoLogger.Level.WARN, e);
            }
        }
    }

    private Map<String, String> mergeCustomData(Map<String, String> existing, XelerGoOrderLink link) {
        Map<String, String> merged = new HashMap<>();
        if (existing != null) {
            merged.putAll(existing);
        }
        merged.putAll(link.toCustomData());
        return merged;
    }

    private boolean customDataChanged(Map<String, String> current, Map<String, String> next) {
        if (current == null) {
            return !next.isEmpty();
        }
        return !current.equals(next);
    }

    private static String safe(String value) {
        return value == null ? "" : value;
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

    @Override
    public void onFinish() {
    }

    @Override
    public boolean isFinished() {
        return false;
    }

    @Override
    public Object getResult() {
        return null;
    }

    @Override
    public boolean isFailed() {
        return false;
    }

    @Override
    public long getShortestTimeForNexStepInvocation() {
        return configRegistry.findShortestPollingMillis(DEFAULT_POLLING_MS);
    }

    private XelerGoConfig resolveTerminalConfigOrNull(String terminalSerialNumber) {
        long startedAt = System.currentTimeMillis();
        if (ctx == null) {
            XelerGoTrace.create()
                .field("flow", "SYNC")
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", terminalSerialNumber)
                .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_EXTENSION_CONTEXT_MISSING)
                .field("failureReason", "XelerGoTransactionSyncTask no recibio IExtensionContext.")
                .field("configSourceAttempted", "cas_wallet_lookup")
                .field("nextInvocationDelaySec", getShortestTimeForNexStepInvocation() / 1000L)
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(log, XelerGoLogger.Level.ERROR);
            return null;
        }
        String invalidSerialReason = XelerGoTerminalSerials.invalidReasonForCasLookup(terminalSerialNumber);
        if (invalidSerialReason != null) {
            logSyncSkip(
                terminalSerialNumber,
                XelerGoConfig.CRYPTO_CURRENCY,
                null,
                null,
                null,
                "cas_wallet_lookup",
                XelerGoFailure.SYNC_TERMINAL_SERIAL_INVALID,
                invalidSerialReason,
                XelerGoLogger.Level.INFO,
                startedAt
            );
            return null;
        }

        IWallet wallet;
        try {
            wallet = ctx.findBuyWallet(terminalSerialNumber, XelerGoConfig.CRYPTO_CURRENCY);
        } catch (RuntimeException e) {
            String frameworkInvalidSerialMessage = XelerGoTerminalSerials.frameworkInvalidSerialMessage(e);
            if (frameworkInvalidSerialMessage != null) {
                logSyncSkip(
                    terminalSerialNumber,
                    XelerGoConfig.CRYPTO_CURRENCY,
                    null,
                    null,
                    null,
                    "cas_wallet_lookup",
                    XelerGoFailure.SYNC_TERMINAL_SERIAL_INVALID,
                    "CAS rechazo el terminalSerialNumber como invalido para lookup de wallet: " + frameworkInvalidSerialMessage,
                    XelerGoLogger.Level.INFO,
                    startedAt
                );
                return null;
            }
            XelerGoTrace.create()
                .field("flow", "SYNC")
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", terminalSerialNumber)
                .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                .field("failureClass", XelerGoFailure.UNKNOWN)
                .field("failureCode", XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION)
                .field("failureReason", e.getMessage())
                .field("configSourceAttempted", "cas_wallet_lookup")
                .field("nextInvocationDelaySec", getShortestTimeForNexStepInvocation() / 1000L)
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "error")
                .log(log, XelerGoLogger.Level.ERROR, e);
            return null;
        }

        if (wallet == null) {
            logSyncSkip(
                terminalSerialNumber,
                XelerGoConfig.CRYPTO_CURRENCY,
                null,
                null,
                null,
                "cas_wallet_lookup",
                XelerGoFailure.SYNC_CONFIG_NOT_AVAILABLE,
                "CAS todavia no expone una wallet XelerGo utilizable para esta terminal.",
                XelerGoLogger.Level.INFO,
                startedAt
            );
            return null;
        }
        if (!(wallet instanceof XelerGoWallet)) {
            XelerGoTrace.create()
                .field("flow", "SYNC")
                .field("stage", "config_resolution")
                .field("terminalSerialNumber", terminalSerialNumber)
                .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_WALLET_TYPE_UNSUPPORTED)
                .field("failureReason", "CAS devolvio una wallet incompatible para sincronizar esta terminal: " + wallet.getClass().getName())
                .field("configSourceAttempted", "cas_wallet_lookup")
                .field("nextInvocationDelaySec", getShortestTimeForNexStepInvocation() / 1000L)
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("result", "skip")
                .log(log, XelerGoLogger.Level.WARN);
            return null;
        }

        XelerGoConfig config = ((XelerGoWallet) wallet).getConfig();
        boolean cachedBefore = configRegistry.findByKey(config.getConfigKey()) != null;
        configRegistry.register(config);
        XelerGoTrace.create()
            .field("flow", "SYNC")
            .field("stage", "config_resolution")
            .field("terminalSerialNumber", terminalSerialNumber)
            .field("cryptoCurrency", XelerGoConfig.CRYPTO_CURRENCY)
            .field("backendBaseUrl", config.getBaseUrl())
            .field("configKey", config.getConfigKey())
            .field("configSourceAttempted", "cas_wallet_lookup")
            .field("nextInvocationDelaySec", getShortestTimeForNexStepInvocation() / 1000L)
            .field("durationMs", System.currentTimeMillis() - startedAt)
            .field("result", "ok")
            .log(log, cachedBefore ? XelerGoLogger.Level.DEBUG : XelerGoLogger.Level.INFO);
        return config;
    }

    private void logSyncSkip(
        String terminalSerialNumber,
        String cryptoCurrency,
        String transactionId,
        String orderId,
        String configKey,
        String configSourceAttempted,
        String failureCode,
        String failureReason,
        XelerGoLogger.Level level,
        long startedAt
    ) {
        String key = safe(configSourceAttempted) + "|" + safe(terminalSerialNumber) + "|" + safe(failureCode);
        long now = System.currentTimeMillis();
        Long nextAllowed = nextConfigSkipLogAt.get(key);
        if (nextAllowed != null && now < nextAllowed.longValue()) {
            return;
        }
        nextConfigSkipLogAt.put(key, Long.valueOf(now + CONFIG_SKIP_LOG_INTERVAL_MS));
        XelerGoTrace.create()
            .field("flow", "SYNC")
            .field("stage", "config_resolution")
            .field("terminalSerialNumber", terminalSerialNumber)
            .field("cryptoCurrency", cryptoCurrency)
            .field("transactionId", transactionId)
            .field("orderId", orderId)
            .field("configKey", configKey)
            .field("failureClass", XelerGoFailure.CONFIG)
            .field("failureCode", failureCode)
            .field("failureReason", failureReason)
            .field("configSourceAttempted", configSourceAttempted)
            .field("nextInvocationDelaySec", getShortestTimeForNexStepInvocation() / 1000L)
            .field("durationMs", System.currentTimeMillis() - startedAt)
            .field("result", "skip")
            .log(log, level);
    }

    private static String terminalSerialNumber(ITransactionDetails transaction) {
        return transaction == null ? null : transaction.getTerminalSerialNumber();
    }
}
