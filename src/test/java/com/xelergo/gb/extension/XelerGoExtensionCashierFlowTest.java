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
import java.util.concurrent.atomic.AtomicInteger;

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

final class XelerGoExtensionCashierFlowTest {
    private static final String VALID_TRON_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

    private XelerGoExtensionCashierFlowTest() {
    }

    static void run() throws Exception {
        sellFlowPrecreatesOrderAndGeneratesDepositAddress();
        buyFlowPrecreatesOrderAndReusesExistingOrderOnSend();
        sellFlowResolvesConfigWithoutPriorWalletCreation();
        buyFlowResolvesConfigWithoutPriorWalletCreation();
        buyFlowIsRejectedEarlyWhenPrecreateFails();
        buyFallbackDoesNotDispatchHttpWhenTransactionDetailsAreInvalid();
        sendCoinsNeverReturnsNullOnFailurePaths();
    }

    private static void sellFlowPrecreatesOrderAndGeneratesDepositAddress() throws Exception {
        resetExtensionState();
        AtomicInteger sellCreates = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/sell-orders", exchange -> {
            sellCreates.incrementAndGet();
            sendJson(
                exchange,
                201,
                "{\"success\":true,\"data\":{\"orderId\":\"ord_sell\",\"status\":\"WAITING_DEPOSIT\",\"depositAddress\":\"TSELL123456789012345678901234567890\",\"qrPayload\":\"tron:TSELL123456789012345678901234567890?token=USDT\",\"expiresAt\":\"2026-04-14T12:00:00.000Z\"},\"meta\":{\"requestId\":\"req-sell\"}}"
            );
        });
        server.start();
        try {
            XelerGoExtension extension = new XelerGoExtension();
            TestContext ctx = new TestContext();
            extension.init(ctx);
            XelerGoWallet wallet = (XelerGoWallet) extension.createWallet(walletLogin(server), null);
            ctx.setWallet(wallet);

            TestRequest request = TestRequest.sell("term-001", "rid-sell-001", "USDTTRON", new BigDecimal("100000"), new BigDecimal("24.12"));
            extension.overrideTransactionRequest(request);

            TestSupport.assertEquals(null, request.getErrorMessage(), "SELL no debe fallar antes del backend");
            TestSupport.assertTrue(extension.isTransactionApproved(request), "SELL debe quedar aprobada cuando la precreacion fue correcta");
            TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(sellCreates.get()), "SELL debe crear una sola orden en el backend");
            TestSupport.assertEquals(
                "TSELL123456789012345678901234567890",
                wallet.generateNewDepositCryptoAddress(XelerGoConfig.CRYPTO_CURRENCY, request.getRemoteTransactionId()),
                "La deposit address debe salir del link precreado"
            );
        } finally {
            server.stop(0);
        }
    }

    private static void buyFlowPrecreatesOrderAndReusesExistingOrderOnSend() throws Exception {
        resetExtensionState();
        AtomicInteger buyCreates = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/buy-orders", exchange -> {
            buyCreates.incrementAndGet();
            sendJson(
                exchange,
                201,
                "{\"success\":true,\"data\":{\"orderId\":\"ord_buy\",\"type\":\"BUY\",\"status\":\"CREATED\",\"customerDestinationAddress\":\"" + VALID_TRON_ADDRESS + "\",\"cryptoAmountToSend\":24.12},\"meta\":{\"requestId\":\"req-buy\"}}"
            );
        });
        server.start();
        try {
            XelerGoExtension extension = new XelerGoExtension();
            TestContext ctx = new TestContext();
            extension.init(ctx);
            XelerGoWallet wallet = (XelerGoWallet) extension.createWallet(walletLogin(server), null);
            ctx.setWallet(wallet);

            TestRequest request = TestRequest.buy(
                "term-001",
                "rid-buy-001",
                "USDTTRON",
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                VALID_TRON_ADDRESS
            );
            extension.overrideTransactionRequest(request);

            TestSupport.assertEquals(null, request.getErrorMessage(), "BUY no debe fallar antes del backend");
            TestSupport.assertTrue(extension.isTransactionApproved(request), "BUY debe quedar aprobada cuando la precreacion fue correcta");

            TestTransactionDetails details = TestTransactionDetails.buy(
                "term-001",
                "rid-buy-001",
                "USDTTRON",
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                VALID_TRON_ADDRESS
            );
            Map<String, String> customData = extension.onTransactionCreated(details);
            TestSupport.assertTrue(customData != null && "ord_buy".equals(customData.get("xelergo.orderId")),
                "Debe devolver customData con el orderId ya precreado");

            String sendResult = wallet.sendCoins(
                VALID_TRON_ADDRESS,
                new BigDecimal("24.12"),
                XelerGoConfig.CRYPTO_CURRENCY,
                "rid-buy-001"
            );
            TestSupport.assertEquals("ord_buy", sendResult, "sendCoins debe reutilizar la orden BUY existente");
            TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(buyCreates.get()),
                "BUY no debe duplicar la creacion entre overrideTransactionRequest y onTransactionCreated");
        } finally {
            server.stop(0);
        }
    }

    private static void sellFlowResolvesConfigWithoutPriorWalletCreation() throws Exception {
        resetExtensionState();
        AtomicInteger sellCreates = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/sell-orders", exchange -> {
            sellCreates.incrementAndGet();
            sendJson(
                exchange,
                201,
                "{\"success\":true,\"data\":{\"orderId\":\"ord_sell_lazy\",\"status\":\"WAITING_DEPOSIT\",\"depositAddress\":\"TSELLLAZY123456789012345678901234567\",\"qrPayload\":\"tron:TSELLLAZY123456789012345678901234567?token=USDT\",\"expiresAt\":\"2026-04-14T12:00:00.000Z\"},\"meta\":{\"requestId\":\"req-sell-lazy\"}}"
            );
        });
        server.start();
        try {
            XelerGoExtension extension = new XelerGoExtension();
            LazyWalletContext ctx = new LazyWalletContext(extension, walletLogin(server));
            extension.init(ctx);

            TestRequest request = TestRequest.sell("term-lazy-sell", "rid-sell-lazy", "USDTTRON", new BigDecimal("100000"), new BigDecimal("24.12"));
            extension.overrideTransactionRequest(request);

            TestSupport.assertEquals(null, request.getErrorMessage(),
                "SELL debe resolver config desde CAS aunque no exista wallet previa en memoria.");
            TestSupport.assertTrue(extension.isTransactionApproved(request),
                "SELL debe aprobarse cuando CAS puede resolver y crear la wallet al vuelo.");
            TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(ctx.findBuyWalletCalls),
                "SELL debe resolver config via CAS por terminal en lugar de depender de primary lazy.");
            TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(sellCreates.get()),
                "SELL debe crear la orden tras resolver config sin wallet previa.");
            TestSupport.assertEquals(
                "TSELLLAZY123456789012345678901234567",
                ((XelerGoWallet) ctx.getWallet()).generateNewDepositCryptoAddress(XelerGoConfig.CRYPTO_CURRENCY, request.getRemoteTransactionId()),
                "La wallet resuelta via CAS debe quedar usable para generateNewDepositCryptoAddress."
            );
        } finally {
            server.stop(0);
        }
    }

    private static void buyFlowResolvesConfigWithoutPriorWalletCreation() throws Exception {
        resetExtensionState();
        AtomicInteger buyCreates = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/buy-orders", exchange -> {
            buyCreates.incrementAndGet();
            sendJson(
                exchange,
                201,
                "{\"success\":true,\"data\":{\"orderId\":\"ord_buy_lazy\",\"type\":\"BUY\",\"status\":\"CREATED\",\"customerDestinationAddress\":\"" + VALID_TRON_ADDRESS + "\",\"cryptoAmountToSend\":24.12},\"meta\":{\"requestId\":\"req-buy-lazy\"}}"
            );
        });
        server.start();
        try {
            XelerGoExtension extension = new XelerGoExtension();
            LazyWalletContext ctx = new LazyWalletContext(extension, walletLogin(server));
            extension.init(ctx);

            TestRequest request = TestRequest.buy(
                "term-lazy-buy",
                "rid-buy-lazy",
                "USDTTRON",
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                VALID_TRON_ADDRESS
            );
            extension.overrideTransactionRequest(request);

            TestSupport.assertEquals(null, request.getErrorMessage(),
                "BUY debe resolver config desde CAS sin requerir wallet previamente creada.");
            TestSupport.assertTrue(extension.isTransactionApproved(request),
                "BUY debe aprobarse cuando la wallet se resuelve al vuelo desde CAS.");
            TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(ctx.findBuyWalletCalls),
                "BUY debe consultar a CAS por terminal y no reutilizar una primary lazy.");
            TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(buyCreates.get()),
                "BUY debe crear la orden solo una vez tras resolver config al vuelo.");
            TestSupport.assertEquals(
                "ord_buy_lazy",
                ((XelerGoWallet) ctx.getWallet()).sendCoins(
                    VALID_TRON_ADDRESS,
                    new BigDecimal("24.12"),
                    XelerGoConfig.CRYPTO_CURRENCY,
                    "rid-buy-lazy"
                ),
                "La wallet resuelta via CAS debe quedar util para sendCoins."
            );
        } finally {
            server.stop(0);
        }
    }

    private static void buyFlowIsRejectedEarlyWhenPrecreateFails() throws Exception {
        resetExtensionState();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/buy-orders", exchange -> sendJson(
            exchange,
            422,
            "{\"success\":false,\"error\":{\"code\":\"VALIDATION_ERROR\",\"message\":\"Direccion invalida\"},\"meta\":{\"requestId\":\"req-buy-error\"}}"
        ));
        server.start();
        try {
            XelerGoExtension extension = new XelerGoExtension();
            TestContext ctx = new TestContext();
            extension.init(ctx);
            XelerGoWallet wallet = (XelerGoWallet) extension.createWallet(walletLogin(server), null);
            ctx.setWallet(wallet);

            TestRequest request = TestRequest.buy(
                "term-001",
                "rid-buy-error",
                "USDTTRON",
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                "TINVALID"
            );
            extension.overrideTransactionRequest(request);

            TestSupport.assertTrue(
                request.getErrorMessage() != null && request.getErrorMessage().contains("BUY"),
                "Si la precreacion BUY falla, la extension debe dejar mensaje claro"
            );
            TestSupport.assertTrue(!extension.isTransactionApproved(request),
                "Si la orden BUY no se pudo precrear, CAS no debe continuar hasta sendCoins");
        } finally {
            server.stop(0);
        }
    }

    private static void buyFallbackDoesNotDispatchHttpWhenTransactionDetailsAreInvalid() throws Exception {
        resetExtensionState();
        AtomicInteger buyCreates = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/buy-orders", exchange -> {
            buyCreates.incrementAndGet();
            sendJson(
                exchange,
                201,
                "{\"success\":true,\"data\":{\"orderId\":\"ord_buy_fallback\",\"type\":\"BUY\",\"status\":\"CREATED\",\"customerDestinationAddress\":\"" + VALID_TRON_ADDRESS + "\",\"cryptoAmountToSend\":24.12},\"meta\":{\"requestId\":\"req-buy-fallback\"}}"
            );
        });
        server.start();
        try {
            XelerGoExtension extension = new XelerGoExtension();
            TestContext ctx = new TestContext();
            extension.init(ctx);
            XelerGoWallet wallet = (XelerGoWallet) extension.createWallet(walletLogin(server), null);
            ctx.setWallet(wallet);

            TestTransactionDetails details = TestTransactionDetails.buy(
                "term-001",
                "rid-buy-invalid-fallback",
                "USDTTRON",
                new BigDecimal("100000"),
                new BigDecimal("24.12"),
                "TINVALID"
            );

            Map<String, String> customData = extension.onTransactionCreated(details);
            TestSupport.assertTrue(customData != null && customData.isEmpty(),
                "El fallback BUY invalido debe devolver un mapa vacio explicito para no dejar null al framework.");
            TestSupport.assertEquals(Integer.valueOf(0), Integer.valueOf(buyCreates.get()),
                "El fallback BUY invalido no debe despachar HTTP hacia el backend.");
        } finally {
            server.stop(0);
        }
    }

    private static void sendCoinsNeverReturnsNullOnFailurePaths() throws Exception {
        resetExtensionState();
        XelerGoConfig config = XelerGoConfig.fromWalletLogin("xelergo:https:api.example.com:443::cas-key");
        XelerGoWallet wallet = new XelerGoWallet(
            config,
            new XelerGoConfigRegistry(),
            new XelerGoOrderLinkRegistry(),
            TestSupport.logger("test.xelergo.wallet")
        );

        String unsupported = wallet.sendCoins(
            VALID_TRON_ADDRESS,
            new BigDecimal("1"),
            "BTC",
            "rid-unsupported"
        );
        TestSupport.assertTrue(
            unsupported != null && unsupported.startsWith("XELERGO_ERR_"),
            "sendCoins debe devolver un handle no nulo y trazable para crypto no soportada"
        );

        String missingLink = wallet.sendCoins(
            VALID_TRON_ADDRESS,
            new BigDecimal("1"),
            XelerGoConfig.CRYPTO_CURRENCY,
            "rid-missing-link"
        );
        TestSupport.assertTrue(
            missingLink != null && missingLink.startsWith("XELERGO_ERR_"),
            "sendCoins debe devolver un handle no nulo y trazable cuando no existe orden BUY local"
        );
    }

    private static String walletLogin(HttpServer server) {
        return "xelergo:http:127.0.0.1:" + server.getAddress().getPort() + "::cas-key:5000:10000:terminalSerial::15:72";
    }

    private static void sendJson(HttpExchange exchange, int statusCode, String body) throws IOException {
        byte[] response = body.getBytes("UTF-8");
        exchange.getResponseHeaders().set("content-type", "application/json");
        exchange.sendResponseHeaders(statusCode, response.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(response);
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

    private static class TestContext implements IExtensionContext {
        private IWallet wallet;

        void setWallet(IWallet wallet) {
            this.wallet = wallet;
        }

        IWallet getWallet() {
            return wallet;
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
            return getWallet();
        }
    }

    private static final class LazyWalletContext extends TestContext {
        private final XelerGoExtension extension;
        private final String walletLogin;
        private int findBuyWalletCalls;

        private LazyWalletContext(XelerGoExtension extension, String walletLogin) {
            this.extension = extension;
            this.walletLogin = walletLogin;
        }

        @Override
        public IWallet findBuyWallet(String terminalSerialNumber, String cryptoCurrency) {
            findBuyWalletCalls++;
            if (getWallet() == null) {
                setWallet(extension.createWallet(walletLogin, null));
            }
            return getWallet();
        }
    }

    private static final class TestRequest implements ITransactionRequest {
        private final int type;
        private final String terminalSerialNumber;
        private final String remoteTransactionId;
        private final BigDecimal cashAmount;
        private final BigDecimal cryptoAmount;
        private final String cryptoCurrency;
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

        static TestRequest sell(String terminalSerialNumber, String rid, String cryptoCurrency, BigDecimal cashAmount, BigDecimal cryptoAmount) {
            return new TestRequest(TYPE_SELL_CRYPTO, terminalSerialNumber, rid, cryptoCurrency, cashAmount, cryptoAmount, null);
        }

        static TestRequest buy(
            String terminalSerialNumber,
            String rid,
            String cryptoCurrency,
            BigDecimal cashAmount,
            BigDecimal cryptoAmount,
            String cryptoAddress
        ) {
            return new TestRequest(TYPE_BUY_CRYPTO, terminalSerialNumber, rid, cryptoCurrency, cashAmount, cryptoAmount, cryptoAddress);
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
        private final BigDecimal cashAmount;
        private final BigDecimal cryptoAmount;
        private final String cryptoCurrency;
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
            String rid,
            String cryptoCurrency,
            BigDecimal cashAmount,
            BigDecimal cryptoAmount,
            String cryptoAddress
        ) {
            return new TestTransactionDetails(TYPE_BUY_CRYPTO, terminalSerialNumber, rid, cryptoCurrency, cashAmount, cryptoAmount, cryptoAddress);
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
