package com.xelergo.gb.extension;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;

import com.generalbytes.batm.server.extensions.IExtensionContext;
import com.generalbytes.batm.server.extensions.ITask;
import com.generalbytes.batm.server.extensions.ITerminal;
import com.generalbytes.batm.server.extensions.ITransactionDetails;
import com.generalbytes.batm.server.extensions.ITransactionListener;
import com.generalbytes.batm.server.extensions.ITransactionRequest;
import com.generalbytes.batm.server.extensions.IWallet;
import com.generalbytes.batm.server.extensions.exceptions.UpdateException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

final class XelerGoObservabilityLoggingTest {
    private static final String VALID_TRON_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

    private XelerGoObservabilityLoggingTest() {
    }

    static void run() throws Exception {
        validatorInvalidAddressEmitsStructuredLog();
        buyRejectedByLocalValidationEmitsStructuredLog();
        sellRejectedBeforeHttpEmitsStructuredLog();
        configMissingEmitsStructuredLog();
        sellConfigMissingEmitsStructuredLog();
        syncTaskConfigMissingIsStructuredAndRateLimited();
        syncTaskLegacyTerminalIsSkippedWithoutSpam();
        createWalletMalformedLoginEmitsSpecificFailureCode();
        createWalletApiKeyEmptyEmitsSpecificFailureCode();
        buyConfigInvalidWalletLoginEmitsSpecificLogs();
        sellConfigInvalidWalletLoginEmitsSpecificLogs();
        getCryptoAddressEmitsWarningBeforeContractualNull();
        generateDepositAddressMissingLinkEmitsStructuredLog();
        buyFallbackInvalidReturnsSafeMapAndEmitsStructuredLog();
        updatedHookMissingLinkReturnsSafeMapAndEmitsStructuredLog();
        apiHttpErrorEmitsStructuredLog();
        apiParseErrorEmitsStructuredLog();
    }

    private static void validatorInvalidAddressEmitsStructuredLog() {
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            TronAddressValidator validator = new TronAddressValidator();

            TestSupport.assertTrue(!validator.isAddressValid("TINVALID"),
                "El validador TRON debe rechazar una direccion invalida.");
            TestSupport.assertTrue(logs.contains("stage=address_validator"),
                "La validacion previa al hook debe dejar trazabilidad propia.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.VALIDATION_TRON_ADDRESS_FORMAT_FAILED),
                "El validador debe exponer el failureCode exacto.");
            TestSupport.assertTrue(logs.contains(ch.qos.logback.classic.Level.WARN, "stage=address_validator"),
                "El rechazo del validador no debe quedar solo en DEBUG.");
        }
    }

    private static void buyRejectedByLocalValidationEmitsStructuredLog() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();
            extension.init(new TestContext(null));

            TestRequest request = TestRequest.buy(
                "term-buy-log",
                "rid-buy-log",
                XelerGoConfig.CRYPTO_CURRENCY,
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                "TINVALID"
            );

            extension.overrideTransactionRequest(request);
            TestSupport.assertTrue(!extension.isTransactionApproved(request), "BUY invalido debe quedar rechazado.");
            TestSupport.assertTrue(logs.contains("stage=validate_local"), "Debe registrar la validacion local.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.VALIDATION_TRON_ADDRESS_FORMAT_FAILED),
                "Debe exponer el failureCode exacto de validacion TRON.");
            TestSupport.assertTrue(logs.contains("result=reject"), "El rechazo debe quedar marcado en logs.");
            TestSupport.assertTrue(logs.contains(ch.qos.logback.classic.Level.ERROR, "failureCode=" + XelerGoFailure.VALIDATION_TRON_ADDRESS_FORMAT_FAILED),
                "El rechazo BUY por direccion invalida no debe quedar solo en DEBUG.");
        }
    }

    private static void sellRejectedBeforeHttpEmitsStructuredLog() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();
            extension.init(new TestContext(null));

            TestRequest request = TestRequest.sell(
                "term-sell-log",
                "rid-sell-log",
                XelerGoConfig.CRYPTO_CURRENCY,
                BigDecimal.ZERO,
                new BigDecimal("1.25")
            );

            extension.overrideTransactionRequest(request);
            TestSupport.assertTrue(!extension.isTransactionApproved(request), "SELL sin cashAmount valido debe quedar rechazada.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.VALIDATION_MISSING_CASH_AMOUNT),
                "Debe registrar el rechazo SELL antes de HTTP.");
            TestSupport.assertTrue(logs.contains("stage=approval"), "Debe registrarse el rechazo final de aprobacion.");
            TestSupport.assertTrue(logs.contains(ch.qos.logback.classic.Level.ERROR, "stage=approval"),
                "La aprobacion false debe quedar visible al menos como ERROR.");
        }
    }

    private static void configMissingEmitsStructuredLog() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();
            extension.init(new TestContext(null));

            TestRequest request = TestRequest.buy(
                "term-no-wallet",
                "rid-no-wallet",
                XelerGoConfig.CRYPTO_CURRENCY,
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                VALID_TRON_ADDRESS
            );

            extension.overrideTransactionRequest(request);
            TestSupport.assertTrue(!extension.isTransactionApproved(request), "Sin wallet/config no debe aprobar.");
            TestSupport.assertTrue(logs.contains("stage=config_resolution") && logs.contains("configSourceAttempted=cas_wallet_lookup"),
                "La falta de config BUY debe quedar trazada como resolucion via CAS por terminal.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.CONFIG_WALLET_NOT_FOUND),
                "Debe dejar evidencia de configuracion faltante.");
            TestSupport.assertTrue(logs.contains(ch.qos.logback.classic.Level.ERROR, "failureCode=" + XelerGoFailure.CONFIG_WALLET_NOT_FOUND),
                "La config faltante debe quedar visible en ERROR.");
        }
    }

    private static void sellConfigMissingEmitsStructuredLog() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();
            extension.init(new TestContext(null));

            TestRequest request = TestRequest.sell(
                "term-no-wallet-sell",
                "rid-no-wallet-sell",
                XelerGoConfig.CRYPTO_CURRENCY,
                new BigDecimal("100000"),
                new BigDecimal("24.12")
            );

            extension.overrideTransactionRequest(request);
            TestSupport.assertTrue(!extension.isTransactionApproved(request), "Sin wallet/config SELL no debe aprobar.");
            TestSupport.assertTrue(logs.contains("stage=config_resolution") && logs.contains("terminalSerialNumber=term-no-wallet-sell"),
                "La falta de config SELL debe quedar trazada en config_resolution.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.CONFIG_WALLET_NOT_FOUND),
                "SELL tambien debe dejar evidencia explicita cuando CAS no expone wallet/config.");
        }
    }

    private static void syncTaskConfigMissingIsStructuredAndRateLimited() {
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoTransactionSyncTask task = new XelerGoTransactionSyncTask(
                new SyncMissingWalletContext(),
                new XelerGoConfigRegistry(),
                new XelerGoOrderLinkRegistry(),
                TestSupport.logger(XelerGoLogger.LOGGER_NAME)
            );

            TestSupport.assertTrue(!task.onDoStep(), "El sync task debe seguir vivo cuando no hay config en CAS.");
            TestSupport.assertTrue(!task.onDoStep(), "El segundo ciclo tambien debe hacer skip limpio.");
            TestSupport.assertTrue(logs.contains("flow=SYNC") && logs.contains("stage=config_resolution"),
                "El sync task debe dejar traza de la resolucion de config.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.SYNC_CONFIG_NOT_AVAILABLE),
                "La ausencia esperable de config del sync debe usar failureCode estable.");
            TestSupport.assertTrue(logs.contains("configSourceAttempted=cas_wallet_lookup"),
                "El sync task debe indicar que intento resolver via terminal/CAS.");
            TestSupport.assertTrue(logs.contains("nextInvocationDelaySec=15"),
                "El skip del sync debe dejar visible el delay del proximo ciclo.");
            TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(logs.count("failureCode=" + XelerGoFailure.SYNC_CONFIG_NOT_AVAILABLE)),
                "El mismo skip de config del sync debe quedar rate-limited y no spamearse en cada ciclo.");
        }
    }

    private static void syncTaskLegacyTerminalIsSkippedWithoutSpam() {
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            SyncLegacyTerminalContext ctx = new SyncLegacyTerminalContext();
            XelerGoTransactionSyncTask task = new XelerGoTransactionSyncTask(
                ctx,
                new XelerGoConfigRegistry(),
                new XelerGoOrderLinkRegistry(),
                TestSupport.logger(XelerGoLogger.LOGGER_NAME)
            );

            TestSupport.assertTrue(!task.onDoStep(), "Una terminal legacy debe ser ignorada sin romper el sync task.");
            TestSupport.assertTrue(!task.onDoStep(), "El segundo ciclo tambien debe hacer skip limpio del serial legacy.");
            TestSupport.assertEquals(Integer.valueOf(0), Integer.valueOf(ctx.findBuyWalletCalls),
                "El sync task no debe intentar findBuyWallet para seriales _OLD.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.SYNC_TERMINAL_SERIAL_INVALID),
                "La terminal legacy debe clasificarse con failureCode especifico.");
            TestSupport.assertTrue(logs.contains("terminalSerialNumber=BT300055_OLD2"),
                "El serial legacy debe quedar visible en el log.");
            TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(logs.count("failureCode=" + XelerGoFailure.SYNC_TERMINAL_SERIAL_INVALID)),
                "El skip de terminal legacy tambien debe quedar rate-limited.");
        }
    }

    private static void createWalletMalformedLoginEmitsSpecificFailureCode() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();

            TestSupport.assertEquals(null, extension.createWallet("xelergo:https", null),
                "createWallet debe rechazar walletLogin malformado.");
            TestSupport.assertTrue(logs.contains("stage=createWallet"),
                "El rechazo debe quedar trazado en createWallet.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.CONFIG_WALLET_LOGIN_MALFORMED),
                "createWallet debe clasificar walletLogin malformado con failureCode especifico.");
            TestSupport.assertTrue(logs.contains("walletLoginPartCount=2"),
                "El log debe dejar visible la cantidad de partes recibidas.");
            TestSupport.assertTrue(logs.contains("walletLoginMasked=xelergo:https"),
                "El input recibido debe quedar logueado de forma segura.");
        }
    }

    private static void createWalletApiKeyEmptyEmitsSpecificFailureCode() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();

            TestSupport.assertEquals(null, extension.createWallet("xelergo:https:api.example.com:443:/api:", null),
                "createWallet debe rechazar apiKey vacia.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.CONFIG_API_KEY_EMPTY),
                "La apiKey vacia debe tener failureCode especifico.");
            TestSupport.assertTrue(logs.contains("apiKeyPresent=false") && logs.contains("apiKeyLength=0"),
                "El log debe dejar presencia/longitud de apiKey sin exponer el secreto.");
            TestSupport.assertTrue(logs.contains("walletLoginMasked=xelergo:https:api.example.com:443:/api:<empty>"),
                "La apiKey vacia debe quedar enmascarada en el walletLogin.");
        }
    }

    private static void buyConfigInvalidWalletLoginEmitsSpecificLogs() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();
            extension.init(new InvalidWalletContext(extension, "xelergo:https:api.example.com:443:/api:"));

            TestRequest request = TestRequest.buy(
                "term-buy-invalid-wallet",
                "rid-buy-invalid-wallet",
                XelerGoConfig.CRYPTO_CURRENCY,
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                VALID_TRON_ADDRESS
            );

            extension.overrideTransactionRequest(request);
            TestSupport.assertTrue(!extension.isTransactionApproved(request),
                "BUY debe quedar rechazado cuando CAS no puede construir la wallet por config invalida.");
            TestSupport.assertTrue(logs.contains("stage=createWallet") && logs.contains("failureCode=" + XelerGoFailure.CONFIG_API_KEY_EMPTY),
                "El motivo exacto del walletLogin invalido debe quedar visible en createWallet.");
            TestSupport.assertTrue(logs.contains("stage=precreate_local") && logs.contains("failureCode=" + XelerGoFailure.CONFIG_WALLET_NOT_FOUND),
                "BUY debe rechazar de forma explicita cuando CAS no entrega una wallet usable.");
            TestSupport.assertTrue(logs.contains("terminalSerialNumber=term-buy-invalid-wallet") && logs.contains("configSourceAttempted=cas_wallet_lookup"),
                "El rechazo BUY debe quedar trazado con terminal y fuente de resolucion.");
        }
    }

    private static void sellConfigInvalidWalletLoginEmitsSpecificLogs() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();
            extension.init(new InvalidWalletContext(extension, "xelergo:https:api.example.com:443:/api:"));

            TestRequest request = TestRequest.sell(
                "term-sell-invalid-wallet",
                "rid-sell-invalid-wallet",
                XelerGoConfig.CRYPTO_CURRENCY,
                new BigDecimal("100000"),
                new BigDecimal("24.12")
            );

            extension.overrideTransactionRequest(request);
            TestSupport.assertTrue(!extension.isTransactionApproved(request),
                "SELL debe quedar rechazado cuando CAS no puede construir la wallet por config invalida.");
            TestSupport.assertTrue(logs.contains("stage=createWallet") && logs.contains("failureCode=" + XelerGoFailure.CONFIG_API_KEY_EMPTY),
                "El motivo exacto del walletLogin invalido tambien debe verse en SELL.");
            TestSupport.assertTrue(logs.contains("stage=precreate_local") && logs.contains("failureCode=" + XelerGoFailure.CONFIG_WALLET_NOT_FOUND),
                "SELL debe rechazar de forma explicita cuando CAS no entrega wallet usable.");
            TestSupport.assertTrue(logs.contains("terminalSerialNumber=term-sell-invalid-wallet") && logs.contains("configSourceAttempted=cas_wallet_lookup"),
                "El rechazo SELL debe quedar trazado con terminal y fuente de resolucion.");
        }
    }

    private static void getCryptoAddressEmitsWarningBeforeContractualNull() {
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoWallet wallet = new XelerGoWallet(
                XelerGoConfig.fromWalletLogin("xelergo:https:api.example.com:443::cas-key"),
                new XelerGoConfigRegistry(),
                new XelerGoOrderLinkRegistry(),
                TestSupport.logger(XelerGoLogger.LOGGER_NAME)
            );

            String address = wallet.getCryptoAddress(XelerGoConfig.CRYPTO_CURRENCY);
            TestSupport.assertEquals(null, address, "getCryptoAddress debe mantener null contractual.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.STATE_STATIC_CRYPTO_ADDRESS_UNAVAILABLE),
                "Debe explicar por que getCryptoAddress devuelve null.");
            TestSupport.assertTrue(logs.contains("frameworkReturn=null"),
                "Debe dejar explicito que el framework recibe null por contrato.");
            TestSupport.assertTrue(logs.contains(ch.qos.logback.classic.Level.WARN, "stage=getCryptoAddress"),
                "getCryptoAddress no debe quedar solo en DEBUG.");
        }
    }

    private static void generateDepositAddressMissingLinkEmitsStructuredLog() throws Exception {
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoWallet wallet = new XelerGoWallet(
                XelerGoConfig.fromWalletLogin("xelergo:https:api.example.com:443::cas-key"),
                new XelerGoConfigRegistry(),
                new XelerGoOrderLinkRegistry(),
                TestSupport.logger(XelerGoLogger.LOGGER_NAME)
            );

            String address = wallet.generateNewDepositCryptoAddress(XelerGoConfig.CRYPTO_CURRENCY, "rid-missing-link-log");
            TestSupport.assertEquals(null, address, "Sin link SELL local no debe devolver depositAddress.");
            TestSupport.assertTrue(logs.contains("stage=generateNewDepositCryptoAddress"),
                "Debe registrar el stage de generateNewDepositCryptoAddress.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.STATE_SELL_ORDER_LINK_MISSING),
                "Debe registrar link faltante de SELL.");
            TestSupport.assertTrue(logs.contains("frameworkReturn=null") && logs.contains("linkPresent=false"),
                "El null contractual de depositAddress debe dejar contexto de framework y link.");
            TestSupport.assertTrue(logs.contains(ch.qos.logback.classic.Level.ERROR, "failureCode=" + XelerGoFailure.STATE_SELL_ORDER_LINK_MISSING),
                "El null critico de depositAddress debe quedar al menos en ERROR.");
        }
    }

    private static void buyFallbackInvalidReturnsSafeMapAndEmitsStructuredLog() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();
            extension.init(new TestContext(null));

            Map<String, String> customData = extension.onTransactionCreated(TestTransactionDetails.buy(
                "term-fallback",
                "rid-fallback-invalid",
                XelerGoConfig.CRYPTO_CURRENCY,
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                "TINVALID"
            ));

            TestSupport.assertTrue(customData != null && customData.isEmpty(),
                "El fallback BUY invalido debe devolver un mapa vacio explicito.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.VALIDATION_TRON_ADDRESS_FORMAT_FAILED),
                "Debe registrar el fallo de validacion del fallback BUY.");
            TestSupport.assertTrue(logs.contains("frameworkReturn=empty_map"),
                "Debe quedar explicito el retorno seguro al framework.");
        }
    }

    private static void updatedHookMissingLinkReturnsSafeMapAndEmitsStructuredLog() throws Exception {
        resetExtensionState();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoExtension extension = new XelerGoExtension();
            extension.init(new TestContext(null));

            Map<String, String> customData = extension.onTransactionUpdated(TestTransactionDetails.sell(
                "term-updated",
                "rid-updated-missing-link",
                XelerGoConfig.CRYPTO_CURRENCY,
                new BigDecimal("90000"),
                new BigDecimal("12.34")
            ));

            TestSupport.assertTrue(customData != null && customData.isEmpty(),
                "onTransactionUpdated sin link debe devolver un mapa vacio explicito.");
            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.STATE_SYNC_LINK_MISSING),
                "Debe dejar evidencia del link faltante.");
            TestSupport.assertTrue(logs.contains(ch.qos.logback.classic.Level.WARN, "failureCode=" + XelerGoFailure.STATE_SYNC_LINK_MISSING),
                "El link faltante del hook update no debe quedar solo en DEBUG.");
        }
    }

    private static void apiHttpErrorEmitsStructuredLog() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/sell-orders", exchange -> sendJson(
            exchange,
            503,
            "{\"success\":false,\"error\":{\"code\":\"TEMPORARY_OUTAGE\",\"message\":\"Backend ocupado\"},\"meta\":{\"requestId\":\"req-http-error\"}}"
        ));
        server.start();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoConfig config = XelerGoConfig.fromWalletLogin(
                "xelergo:http:127.0.0.1:" + server.getAddress().getPort() + "::cas-key"
            );
            XelerGoApiClient client = new XelerGoApiClient(config, TestSupport.logger(XelerGoLogger.LOGGER_NAME));
            try {
                client.createSellOrder("rid-http-error", "batm-001", new BigDecimal("100000"), new BigDecimal("24.12"));
                TestSupport.fail("Se esperaba error HTTP.");
            } catch (XelerGoApiException expected) {
                TestSupport.assertEquals("TEMPORARY_OUTAGE", expected.getBackendCode(), "backendCode");
            }

            TestSupport.assertTrue(logs.contains("result=after_dispatch"), "Debe registrarse la recepcion HTTP antes de clasificar el error.");
            TestSupport.assertTrue(logs.contains("failureCode=BACKEND_TEMPORARY_OUTAGE"),
                "Debe registrar el failureCode derivado del backend.");
            TestSupport.assertTrue(logs.contains("backendRequestId=req-http-error"), "Debe incluir requestId del backend.");
        } finally {
            server.stop(0);
        }
    }

    private static void apiParseErrorEmitsStructuredLog() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/sell-orders", exchange -> sendJson(
            exchange,
            201,
            "{\"success\":true,\"data\":{\"orderId\":\"ord-bad\",\"status\":\"WAITING_DEPOSIT\"},\"meta\":{\"requestId\":\"req-parse-error\"}}"
        ));
        server.start();
        try (TestLogCapture logs = TestLogCapture.attachXelerGo()) {
            XelerGoConfig config = XelerGoConfig.fromWalletLogin(
                "xelergo:http:127.0.0.1:" + server.getAddress().getPort() + "::cas-key"
            );
            XelerGoApiClient client = new XelerGoApiClient(config, TestSupport.logger(XelerGoLogger.LOGGER_NAME));
            try {
                client.createSellOrder("rid-parse-error", "batm-001", new BigDecimal("100000"), new BigDecimal("24.12"));
                TestSupport.fail("Se esperaba error de schema.");
            } catch (XelerGoApiException expected) {
                TestSupport.assertEquals(XelerGoFailure.RESPONSE_MISSING_DEPOSIT_ADDRESS, expected.getFailureCode(), "failureCode");
            }

            TestSupport.assertTrue(logs.contains("failureCode=" + XelerGoFailure.RESPONSE_MISSING_DEPOSIT_ADDRESS),
                "Debe registrar el schema invalido exacto.");
            TestSupport.assertTrue(logs.contains("requestId=gbext-"), "Debe quedar trazado el requestId local.");
        } finally {
            server.stop(0);
        }
    }

    private static void resetExtensionState() throws Exception {
        resetStaticField(XelerGoExtension.class, "CONFIGS", XelerGoConfigRegistry.class, "configs");
        resetStaticField(XelerGoExtension.class, "LINKS", XelerGoOrderLinkRegistry.class, "byRid");
        resetStaticField(XelerGoExtension.class, "LINKS", XelerGoOrderLinkRegistry.class, "byOrderId");
        resetStaticField(XelerGoExtension.class, "LINKS", XelerGoOrderLinkRegistry.class, "byAddress");

        Field configsField = XelerGoExtension.class.getDeclaredField("CONFIGS");
        configsField.setAccessible(true);
        Object registry = configsField.get(null);
        Field primaryField = XelerGoConfigRegistry.class.getDeclaredField("primary");
        primaryField.setAccessible(true);
        primaryField.set(registry, null);
    }

    private static void resetStaticField(Class<?> ownerClass, String staticFieldName, Class<?> innerClass, String mapFieldName) throws Exception {
        Field staticField = ownerClass.getDeclaredField(staticFieldName);
        staticField.setAccessible(true);
        Object target = staticField.get(null);
        Field mapField = innerClass.getDeclaredField(mapFieldName);
        mapField.setAccessible(true);
        ((Map<?, ?>) mapField.get(target)).clear();
    }

    private static void sendJson(HttpExchange exchange, int statusCode, String body) throws IOException {
        byte[] response = body.getBytes("UTF-8");
        exchange.getResponseHeaders().set("content-type", "application/json");
        exchange.sendResponseHeaders(statusCode, response.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(response);
        }
    }

    private static final class TestContext implements IExtensionContext {
        private final IWallet wallet;

        private TestContext(IWallet wallet) {
            this.wallet = wallet;
        }

        @Override
        public void addTransactionListener(ITransactionListener listener) {
        }

        @Override
        public void addTask(String name, ITask task, Runnable onFinish) {
        }

        @Override
        public List<ITerminal> findAllTerminals() {
            return Collections.emptyList();
        }

        @Override
        public List<ITransactionDetails> findTransactions(
            String terminalSerialNumber,
            Date serverTimeFrom,
            Date serverTimeTo,
            String previousRID,
            boolean includeBanknotes
        ) {
            return Collections.emptyList();
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail) throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail, Map<String, String> customData)
            throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails addTransactionHash(String transactionRemoteId, String transactionHash) throws UpdateException {
            return null;
        }

        @Override
        public String getConfigProperty(String fileNameInConfigDirectory, String key, String defaultValue) {
            return defaultValue;
        }

        @Override
        public IWallet findBuyWallet(String terminalSerialNumber, String cryptoCurrency) {
            return wallet;
        }
    }

    private static final class SyncMissingWalletContext implements IExtensionContext {
        @Override
        public void addTransactionListener(ITransactionListener listener) {
        }

        @Override
        public void addTask(String name, ITask task, Runnable onFinish) {
        }

        @Override
        public List<ITerminal> findAllTerminals() {
            return Collections.<ITerminal>singletonList(new SyncTerminal("term-sync-no-wallet"));
        }

        @Override
        public List<ITransactionDetails> findTransactions(
            String terminalSerialNumber,
            Date serverTimeFrom,
            Date serverTimeTo,
            String previousRID,
            boolean includeBanknotes
        ) {
            return Collections.emptyList();
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail) throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail, Map<String, String> customData)
            throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails addTransactionHash(String transactionRemoteId, String transactionHash) throws UpdateException {
            return null;
        }

        @Override
        public String getConfigProperty(String fileNameInConfigDirectory, String key, String defaultValue) {
            return defaultValue;
        }

        @Override
        public IWallet findBuyWallet(String terminalSerialNumber, String cryptoCurrency) {
            return null;
        }
    }

    private static final class SyncLegacyTerminalContext implements IExtensionContext {
        private int findBuyWalletCalls;

        @Override
        public void addTransactionListener(ITransactionListener listener) {
        }

        @Override
        public void addTask(String name, ITask task, Runnable onFinish) {
        }

        @Override
        public List<ITerminal> findAllTerminals() {
            return Collections.<ITerminal>singletonList(new SyncTerminal("BT300055_OLD2"));
        }

        @Override
        public List<ITransactionDetails> findTransactions(
            String terminalSerialNumber,
            Date serverTimeFrom,
            Date serverTimeTo,
            String previousRID,
            boolean includeBanknotes
        ) {
            return Collections.emptyList();
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail) throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail, Map<String, String> customData)
            throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails addTransactionHash(String transactionRemoteId, String transactionHash) throws UpdateException {
            return null;
        }

        @Override
        public String getConfigProperty(String fileNameInConfigDirectory, String key, String defaultValue) {
            return defaultValue;
        }

        @Override
        public IWallet findBuyWallet(String terminalSerialNumber, String cryptoCurrency) {
            findBuyWalletCalls++;
            return null;
        }
    }

    private static final class InvalidWalletContext implements IExtensionContext {
        private final XelerGoExtension extension;
        private final String walletLogin;

        private InvalidWalletContext(XelerGoExtension extension, String walletLogin) {
            this.extension = extension;
            this.walletLogin = walletLogin;
        }

        @Override
        public void addTransactionListener(ITransactionListener listener) {
        }

        @Override
        public void addTask(String name, ITask task, Runnable onFinish) {
        }

        @Override
        public List<ITerminal> findAllTerminals() {
            return Collections.emptyList();
        }

        @Override
        public List<ITransactionDetails> findTransactions(
            String terminalSerialNumber,
            Date serverTimeFrom,
            Date serverTimeTo,
            String previousRID,
            boolean includeBanknotes
        ) {
            return Collections.emptyList();
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail) throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail, Map<String, String> customData)
            throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails addTransactionHash(String transactionRemoteId, String transactionHash) throws UpdateException {
            return null;
        }

        @Override
        public String getConfigProperty(String fileNameInConfigDirectory, String key, String defaultValue) {
            return defaultValue;
        }

        @Override
        public IWallet findBuyWallet(String terminalSerialNumber, String cryptoCurrency) {
            return extension.createWallet(walletLogin, null);
        }
    }

    private static final class SyncTerminal implements ITerminal {
        private final String serialNumber;

        private SyncTerminal(String serialNumber) {
            this.serialNumber = serialNumber;
        }

        @Override
        public String getSerialNumber() {
            return serialNumber;
        }
    }

    private static final class TestRequest implements ITransactionRequest {
        private final int type;
        private final String terminalSerialNumber;
        private final String remoteTransactionId;
        private final String cryptoCurrency;
        private final BigDecimal cashAmount;
        private final BigDecimal cryptoAmount;
        private final String cryptoAddress;
        private String errorMessage;

        private TestRequest(
            int type,
            String terminalSerialNumber,
            String remoteTransactionId,
            String cryptoCurrency,
            BigDecimal cashAmount,
            BigDecimal cryptoAmount,
            String cryptoAddress
        ) {
            this.type = type;
            this.terminalSerialNumber = terminalSerialNumber;
            this.remoteTransactionId = remoteTransactionId;
            this.cryptoCurrency = cryptoCurrency;
            this.cashAmount = cashAmount;
            this.cryptoAmount = cryptoAmount;
            this.cryptoAddress = cryptoAddress;
        }

        static TestRequest sell(
            String terminalSerialNumber,
            String remoteTransactionId,
            String cryptoCurrency,
            BigDecimal cashAmount,
            BigDecimal cryptoAmount
        ) {
            return new TestRequest(TYPE_SELL_CRYPTO, terminalSerialNumber, remoteTransactionId, cryptoCurrency, cashAmount, cryptoAmount, null);
        }

        static TestRequest buy(
            String terminalSerialNumber,
            String remoteTransactionId,
            String cryptoCurrency,
            BigDecimal cashAmount,
            BigDecimal cryptoAmount,
            String cryptoAddress
        ) {
            return new TestRequest(TYPE_BUY_CRYPTO, terminalSerialNumber, remoteTransactionId, cryptoCurrency, cashAmount, cryptoAmount, cryptoAddress);
        }

        @Override
        public int getType() {
            return type;
        }

        @Override
        public String getTerminalSerialNumber() {
            return terminalSerialNumber;
        }

        @Override
        public String getRemoteTransactionId() {
            return remoteTransactionId;
        }

        @Override
        public BigDecimal getCashAmount() {
            return cashAmount;
        }

        @Override
        public String getCashCurrency() {
            return "COP";
        }

        @Override
        public BigDecimal getCryptoAmount() {
            return cryptoAmount;
        }

        @Override
        public String getCryptoCurrency() {
            return cryptoCurrency;
        }

        @Override
        public String getCryptoAddress() {
            return cryptoAddress;
        }

        @Override
        public String getErrorMessage() {
            return errorMessage;
        }

        @Override
        public void setErrorMessage(String errorMessage) {
            this.errorMessage = errorMessage;
        }
    }

    private static final class TestTransactionDetails implements ITransactionDetails {
        private final int type;
        private final String terminalSerialNumber;
        private final String remoteTransactionId;
        private final String cryptoCurrency;
        private final BigDecimal cashAmount;
        private final BigDecimal cryptoAmount;
        private final String cryptoAddress;

        private TestTransactionDetails(
            int type,
            String terminalSerialNumber,
            String remoteTransactionId,
            String cryptoCurrency,
            BigDecimal cashAmount,
            BigDecimal cryptoAmount,
            String cryptoAddress
        ) {
            this.type = type;
            this.terminalSerialNumber = terminalSerialNumber;
            this.remoteTransactionId = remoteTransactionId;
            this.cryptoCurrency = cryptoCurrency;
            this.cashAmount = cashAmount;
            this.cryptoAmount = cryptoAmount;
            this.cryptoAddress = cryptoAddress;
        }

        static TestTransactionDetails buy(
            String terminalSerialNumber,
            String remoteTransactionId,
            String cryptoCurrency,
            BigDecimal cashAmount,
            BigDecimal cryptoAmount,
            String cryptoAddress
        ) {
            return new TestTransactionDetails(TYPE_BUY_CRYPTO, terminalSerialNumber, remoteTransactionId, cryptoCurrency, cashAmount, cryptoAmount, cryptoAddress);
        }

        static TestTransactionDetails sell(
            String terminalSerialNumber,
            String remoteTransactionId,
            String cryptoCurrency,
            BigDecimal cashAmount,
            BigDecimal cryptoAmount
        ) {
            return new TestTransactionDetails(TYPE_SELL_CRYPTO, terminalSerialNumber, remoteTransactionId, cryptoCurrency, cashAmount, cryptoAmount, null);
        }

        @Override
        public int getType() {
            return type;
        }

        @Override
        public String getTerminalSerialNumber() {
            return terminalSerialNumber;
        }

        @Override
        public String getRemoteTransactionId() {
            return remoteTransactionId;
        }

        @Override
        public int getStatus() {
            return type == TYPE_BUY_CRYPTO ? STATUS_BUY_IN_PROGRESS : STATUS_SELL_PAYMENT_REQUESTED;
        }

        @Override
        public int getErrorCode() {
            return 0;
        }

        @Override
        public BigDecimal getCashAmount() {
            return cashAmount;
        }

        @Override
        public String getCashCurrency() {
            return "COP";
        }

        @Override
        public BigDecimal getCryptoAmount() {
            return cryptoAmount;
        }

        @Override
        public String getCryptoCurrency() {
            return cryptoCurrency;
        }

        @Override
        public String getCryptoAddress() {
            return cryptoAddress;
        }

        @Override
        public String getDetail() {
            return null;
        }

        @Override
        public boolean isWithdrawn() {
            return false;
        }

        @Override
        public boolean canBeCashedOut() {
            return false;
        }

        @Override
        public Map<String, String> getCustomData() {
            return null;
        }
    }
}
