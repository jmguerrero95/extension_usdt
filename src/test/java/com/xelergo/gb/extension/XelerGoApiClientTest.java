package com.xelergo.gb.extension;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

final class XelerGoApiClientTest {
    private XelerGoApiClientTest() {
    }

    static void run() throws Exception {
        createSellOrderParsesEnvelope();
        supportsCommonApiBasePathVariantsWithoutDuplicatingSegments();
        buyOrderErrorsPropagateBackendMetadata();
        malformedSellResponseIsClassifiedAsSchemaError();
        completeSellPayoutSendsCorrelationPayload();
    }

    private static void createSellOrderParsesEnvelope() throws Exception {
        AtomicReference<String> seenApiKey = new AtomicReference<>();
        AtomicReference<String> seenRequestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/sell-orders", exchange -> {
            seenApiKey.set(exchange.getRequestHeaders().getFirst("x-api-key"));
            seenRequestBody.set(TestSupport.readUtf8(exchange.getRequestBody()));
            sendJson(
                exchange,
                201,
                "{\"success\":true,\"data\":{\"orderId\":\"ord_123\",\"status\":\"WAITING_DEPOSIT\",\"depositAddress\":\"T1234567890123456789012345678901234\",\"qrPayload\":\"tron:T123?token=USDT\",\"expiresAt\":\"2026-03-31T18:20:00.000Z\"},\"meta\":{\"requestId\":\"req-123\"}}"
            );
        });
        server.start();
        try {
            XelerGoConfig config = XelerGoConfig.fromWalletLogin(
                "xelergo:http:127.0.0.1:" + server.getAddress().getPort() + "::cas-key:5000:10000:terminalSerial::15:72"
            );
            XelerGoApiClient client = new XelerGoApiClient(config, TestSupport.logger("test.xelergo"));
            XelerGoApiClient.CreateSellOrderResponse response = client.createSellOrder(
                "rid-1",
                "batm-001",
                new BigDecimal("100000"),
                new BigDecimal("24.12")
            );

            TestSupport.assertEquals("cas-key", seenApiKey.get(), "x-api-key header");
            TestSupport.assertTrue(seenRequestBody.get().contains("\"externalRef\":\"rid-1\""), "externalRef must be sent");
            TestSupport.assertTrue(seenRequestBody.get().contains("\"terminalId\":\"batm-001\""), "terminalId must be sent");
            TestSupport.assertEquals("ord_123", response.getOrderId(), "orderId");
            TestSupport.assertEquals("WAITING_DEPOSIT", response.getStatus(), "status");
            TestSupport.assertEquals("req-123", response.getRequestId(), "requestId");
        } finally {
            server.stop(0);
        }
    }

    private static void buyOrderErrorsPropagateBackendMetadata() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/buy-orders", exchange -> sendJson(
            exchange,
            422,
            "{\"success\":false,\"error\":{\"code\":\"VALIDATION_ERROR\",\"message\":\"Direccion invalida\",\"details\":null},\"meta\":{\"requestId\":\"req-422\"}}"
        ));
        server.start();
        try {
            XelerGoConfig config = XelerGoConfig.fromWalletLogin(
                "xelergo:http:127.0.0.1:" + server.getAddress().getPort() + "::cas-key"
            );
            XelerGoApiClient client = new XelerGoApiClient(config, TestSupport.logger("test.xelergo"));
            try {
                client.createBuyOrder("rid-2", "batm-001", new BigDecimal("100000"), new BigDecimal("24.12"), "T1234567890123456789012345678901234");
                TestSupport.fail("Se esperaba XelerGoApiException");
            } catch (XelerGoApiException expected) {
                TestSupport.assertEquals("VALIDATION_ERROR", expected.getBackendCode(), "backendCode");
                TestSupport.assertEquals("req-422", expected.getBackendRequestId(), "backendRequestId");
                TestSupport.assertEquals(Integer.valueOf(422), Integer.valueOf(expected.getHttpStatus()), "httpStatus");
            }
        } finally {
            server.stop(0);
        }
    }

    private static void supportsCommonApiBasePathVariantsWithoutDuplicatingSegments() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/sell-orders", exchange -> sendJson(
            exchange,
            201,
            "{\"success\":true,\"data\":{\"orderId\":\"ord_overlap\",\"status\":\"WAITING_DEPOSIT\",\"depositAddress\":\"T1234567890123456789012345678901234\",\"qrPayload\":\"tron:T123?token=USDT\",\"expiresAt\":\"2026-03-31T18:20:00.000Z\"},\"meta\":{\"requestId\":\"req-overlap\"}}"
        ));
        server.start();
        try {
            int port = server.getAddress().getPort();
            assertCreateSellOrderWorks("xelergo:http:127.0.0.1:" + port + "::cas-key");
            assertCreateSellOrderWorks("xelergo:http:127.0.0.1:" + port + ":/:cas-key");
            assertCreateSellOrderWorks("xelergo:http:127.0.0.1:" + port + ":/api:cas-key");
            assertCreateSellOrderWorks("xelergo:http:127.0.0.1:" + port + ":/api/v1/cas:cas-key");
        } finally {
            server.stop(0);
        }
    }

    private static void malformedSellResponseIsClassifiedAsSchemaError() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/sell-orders", exchange -> sendJson(
            exchange,
            201,
            "{\"success\":true,\"data\":{\"orderId\":\"ord_bad\",\"status\":\"WAITING_DEPOSIT\",\"qrPayload\":\"tron:T123?token=USDT\",\"expiresAt\":\"2026-03-31T18:20:00.000Z\"},\"meta\":{\"requestId\":\"req-bad\"}}"
        ));
        server.start();
        try {
            XelerGoConfig config = XelerGoConfig.fromWalletLogin(
                "xelergo:http:127.0.0.1:" + server.getAddress().getPort() + "::cas-key"
            );
            XelerGoApiClient client = new XelerGoApiClient(config, TestSupport.logger("test.xelergo"));
            try {
                client.createSellOrder("rid-bad", "batm-001", new BigDecimal("100000"), new BigDecimal("24.12"));
                TestSupport.fail("Se esperaba error de schema");
            } catch (XelerGoApiException expected) {
                TestSupport.assertEquals(XelerGoFailure.RESPONSE_SCHEMA, expected.getFailureClass(), "failureClass");
                TestSupport.assertEquals(XelerGoFailure.RESPONSE_MISSING_DEPOSIT_ADDRESS, expected.getFailureCode(), "failureCode");
            }
        } finally {
            server.stop(0);
        }
    }

    private static void completeSellPayoutSendsCorrelationPayload() throws Exception {
        AtomicReference<String> seenRequestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/cas/sell-orders/ord_123/complete-payout", exchange -> {
            seenRequestBody.set(TestSupport.readUtf8(exchange.getRequestBody()));
            sendJson(
                exchange,
                200,
                "{\"success\":true,\"data\":{\"orderId\":\"ord_123\",\"status\":\"COMPLETED\",\"updatedAt\":\"2026-03-31T18:20:00.000Z\"},\"meta\":{\"requestId\":\"req-complete\"}}"
            );
        });
        server.start();
        try {
            XelerGoConfig config = XelerGoConfig.fromWalletLogin(
                "xelergo:http:127.0.0.1:" + server.getAddress().getPort() + "::cas-key"
            );
            XelerGoApiClient client = new XelerGoApiClient(config, TestSupport.logger("test.xelergo"));
            client.completeSellPayout("ord_123", "rid-123", "batm-001");

            TestSupport.assertTrue(
                seenRequestBody.get().contains("\"casTransactionId\":\"rid-123\""),
                "Debe enviar casTransactionId"
            );
            TestSupport.assertTrue(
                seenRequestBody.get().contains("\"terminalId\":\"batm-001\""),
                "Debe enviar terminalId cuando existe"
            );
        } finally {
            server.stop(0);
        }
    }

    private static void sendJson(HttpExchange exchange, int statusCode, String body) throws IOException {
        byte[] response = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("content-type", "application/json");
        exchange.sendResponseHeaders(statusCode, response.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(response);
        }
    }

    private static void assertCreateSellOrderWorks(String walletLogin) throws Exception {
        XelerGoConfig config = XelerGoConfig.fromWalletLogin(walletLogin);
        XelerGoApiClient client = new XelerGoApiClient(config, TestSupport.logger("test.xelergo"));
        XelerGoApiClient.CreateSellOrderResponse response = client.createSellOrder(
            "rid-overlap",
            "batm-001",
            new BigDecimal("100000"),
            new BigDecimal("24.12")
        );
        TestSupport.assertEquals("ord_overlap", response.getOrderId(), "orderId for " + walletLogin);
    }
}
