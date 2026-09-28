package com.xelergo.gb.extension;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import javax.net.ssl.SSLException;

import org.slf4j.Logger;

final class XelerGoApiClient {
    private static final String CAS_API_PREFIX = "/api/v1/cas";

    private final XelerGoConfig config;
    private final Logger log;

    XelerGoApiClient(XelerGoConfig config, Logger log) {
        this.config = config;
        this.log = log;
    }

    CreateSellOrderResponse createSellOrder(
        String externalRef,
        String terminalId,
        BigDecimal fiatAmount,
        BigDecimal cryptoAmountExpected
    ) throws XelerGoApiException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("asset", XelerGoConfig.ASSET);
        body.put("network", XelerGoConfig.NETWORK);
        body.put("fiatCurrency", XelerGoConfig.FIAT_CURRENCY);
        body.put("fiatAmount", fiatAmount);
        body.put("cryptoAmountExpected", cryptoAmountExpected);
        body.put("externalRef", externalRef);
        body.put("terminalId", terminalId);

        String endpoint = "POST /api/v1/cas/sell-orders";
        ApiEnvelope envelope = sendJson("POST", "/api/v1/cas/sell-orders", XelerGoJson.stringify(body), externalRef);
        try {
            Map<String, Object> data = envelope.requireData(endpoint);
            return new CreateSellOrderResponse(
                requiredString(data, "orderId", XelerGoFailure.RESPONSE_MISSING_ORDER_ID, endpoint, envelope),
                requiredString(data, "status", XelerGoFailure.RESPONSE_MISSING_STATUS, endpoint, envelope),
                requiredString(data, "depositAddress", XelerGoFailure.RESPONSE_MISSING_DEPOSIT_ADDRESS, endpoint, envelope),
                requiredString(data, "qrPayload", XelerGoFailure.RESPONSE_MISSING_QR_PAYLOAD, endpoint, envelope),
                requiredString(data, "expiresAt", XelerGoFailure.RESPONSE_MISSING_EXPIRES_AT, endpoint, envelope),
                envelope.getRequestId()
            );
        } catch (XelerGoApiException error) {
            logResponseMappingFailure("SELL", "precreate_http", externalRef, "/api/v1/cas/sell-orders", error);
            throw error;
        }
    }

    CreateBuyOrderResponse createBuyOrder(
        String externalRef,
        String terminalId,
        BigDecimal fiatAmount,
        BigDecimal cryptoAmountToSend,
        String customerDestinationAddress
    ) throws XelerGoApiException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("asset", XelerGoConfig.ASSET);
        body.put("network", XelerGoConfig.NETWORK);
        body.put("fiatCurrency", XelerGoConfig.FIAT_CURRENCY);
        body.put("fiatAmount", fiatAmount);
        body.put("cryptoAmountToSend", cryptoAmountToSend);
        body.put("customerDestinationAddress", customerDestinationAddress);
        body.put("externalRef", externalRef);
        body.put("terminalId", terminalId);

        String endpoint = "POST /api/v1/cas/buy-orders";
        ApiEnvelope envelope = sendJson("POST", "/api/v1/cas/buy-orders", XelerGoJson.stringify(body), externalRef);
        try {
            Map<String, Object> data = envelope.requireData(endpoint);
            return new CreateBuyOrderResponse(
                requiredString(data, "orderId", XelerGoFailure.RESPONSE_MISSING_ORDER_ID, endpoint, envelope),
                requiredString(data, "status", XelerGoFailure.RESPONSE_MISSING_STATUS, endpoint, envelope),
                stringValue(data.get("type")),
                stringValue(data.get("customerDestinationAddress")),
                decimalValue(data.get("cryptoAmountToSend"), "cryptoAmountToSend", endpoint, envelope),
                envelope.getRequestId()
            );
        } catch (XelerGoApiException error) {
            logResponseMappingFailure("BUY", "precreate_http", externalRef, "/api/v1/cas/buy-orders", error);
            throw error;
        }
    }

    OrderStatusResponse getSellOrder(String orderId) throws XelerGoApiException {
        String endpoint = "GET /api/v1/cas/sell-orders/" + orderId;
        ApiEnvelope envelope = sendJson("GET", "/api/v1/cas/sell-orders/" + orderId, null, orderId);
        try {
            return OrderStatusResponse.fromSell(envelope.requireData(endpoint), envelope, endpoint);
        } catch (XelerGoApiException error) {
            logResponseMappingFailure("SELL", "order_status_http", orderId, "/api/v1/cas/sell-orders/" + orderId, error);
            throw error;
        }
    }

    OrderStatusResponse getBuyOrder(String orderId) throws XelerGoApiException {
        String endpoint = "GET /api/v1/cas/buy-orders/" + orderId;
        ApiEnvelope envelope = sendJson("GET", "/api/v1/cas/buy-orders/" + orderId, null, orderId);
        try {
            return OrderStatusResponse.fromBuy(envelope.requireData(endpoint), envelope, endpoint);
        } catch (XelerGoApiException error) {
            logResponseMappingFailure("BUY", "order_status_http", orderId, "/api/v1/cas/buy-orders/" + orderId, error);
            throw error;
        }
    }

    Object getSellTimeline(String orderId) throws XelerGoApiException {
        ApiEnvelope envelope = sendJson("GET", "/api/v1/cas/sell-orders/" + orderId + "/timeline", null, orderId);
        return envelope.getData();
    }

    Object getBuyTimeline(String orderId) throws XelerGoApiException {
        ApiEnvelope envelope = sendJson("GET", "/api/v1/cas/buy-orders/" + orderId + "/timeline", null, orderId);
        return envelope.getData();
    }

    void cancelSellOrder(String orderId) throws XelerGoApiException {
        sendJson("POST", "/api/v1/cas/sell-orders/" + orderId + "/cancel", "{}", orderId);
    }

    void cancelBuyOrder(String orderId) throws XelerGoApiException {
        sendJson("POST", "/api/v1/cas/buy-orders/" + orderId + "/cancel", "{}", orderId);
    }

    void completeSellPayout(String orderId, String casTransactionId, String terminalId) throws XelerGoApiException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("casTransactionId", casTransactionId);
        if (terminalId != null && !terminalId.trim().isEmpty()) {
            body.put("terminalId", terminalId);
        }
        sendJson(
            "POST",
            "/api/v1/cas/sell-orders/" + orderId + "/complete-payout",
            XelerGoJson.stringify(body),
            orderId
        );
    }

    private ApiEnvelope sendJson(String method, String path, String body, String correlationValue) throws XelerGoApiException {
        String requestId = "gbext-" + UUID.randomUUID();
        URI requestUri = resolveUri(path);
        String flow = flowFromPath(path);
        String stage = stageFromPath(method, path);
        String endpoint = method.toUpperCase() + " " + requestUri.getPath();
        long startedAt = System.currentTimeMillis();
        HttpURLConnection connection = null;
        boolean requestAttempted = true;
        boolean requestDispatched = false;
        boolean responseReceived = false;
        String responseBody = null;
        httpTrace(flow, stage, correlationValue, requestId, requestUri)
            .field("backendBaseUrl", config.getBaseUrl())
            .field("requestAttempted", requestAttempted)
            .field("requestDispatched", requestDispatched)
            .field("responseReceived", responseReceived)
            .field("connectTimeoutMs", config.getConnectTimeout().toMillis())
            .field("readTimeoutMs", config.getReadTimeout().toMillis())
            .field("result", "enter")
            .log(log, XelerGoLogger.Level.INFO);
        try {
            connection = (HttpURLConnection) new URL(requestUri.toString()).openConnection();
            connection.setConnectTimeout(toIntMillis(config.getConnectTimeout()));
            connection.setReadTimeout(toIntMillis(config.getReadTimeout()));
            connection.setRequestMethod(method.toUpperCase());
            connection.setRequestProperty("accept", "application/json");
            connection.setRequestProperty("content-type", "application/json");
            connection.setRequestProperty("user-agent", "XelerGo-GB-Extension/1.0");
            connection.setRequestProperty("x-api-key", config.getApiKey());
            connection.setRequestProperty("x-request-id", requestId);
            connection.setUseCaches(false);
            connection.setDoInput(true);

            httpTrace(flow, stage, correlationValue, requestId, requestUri)
                .field("backendBaseUrl", config.getBaseUrl())
                .field("requestAttempted", requestAttempted)
                .field("requestDispatched", requestDispatched)
                .field("responseReceived", false)
                .field("connectTimeoutMs", config.getConnectTimeout().toMillis())
                .field("readTimeoutMs", config.getReadTimeout().toMillis())
                .field("result", "before_dispatch")
                .log(log, XelerGoLogger.Level.INFO);

            if ("POST".equalsIgnoreCase(method)) {
                byte[] requestBody = (body == null ? "{}" : body).getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Length", String.valueOf(requestBody.length));
                try (OutputStream outputStream = connection.getOutputStream()) {
                    outputStream.write(requestBody);
                    outputStream.flush();
                }
                requestDispatched = true;
            } else {
                requestDispatched = true;
            }

            httpTrace(flow, stage, correlationValue, requestId, requestUri)
                .field("backendBaseUrl", config.getBaseUrl())
                .field("requestAttempted", requestAttempted)
                .field("requestDispatched", requestDispatched)
                .field("responseReceived", false)
                .field("result", "dispatch")
                .log(log, XelerGoLogger.Level.INFO);

            int statusCode = connection.getResponseCode();
            responseReceived = true;
            responseBody = readResponseBody(connection, statusCode);
            long elapsed = System.currentTimeMillis() - startedAt;
            httpTrace(flow, stage, correlationValue, requestId, requestUri)
                .field("backendBaseUrl", config.getBaseUrl())
                .field("requestAttempted", true)
                .field("requestDispatched", true)
                .field("responseReceived", true)
                .field("status", statusCode)
                .field("responseBody", XelerGoTrace.truncate(responseBody, 240))
                .field("durationMs", elapsed)
                .field("result", "after_dispatch")
                .log(log, statusCode >= 500 ? XelerGoLogger.Level.WARN : XelerGoLogger.Level.INFO);
            try {
                ApiEnvelope envelope = ApiEnvelope.fromResponse(statusCode, responseBody, endpoint);
                httpTrace(flow, stage, correlationValue, requestId, requestUri)
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("requestAttempted", true)
                    .field("requestDispatched", true)
                    .field("responseReceived", true)
                    .field("status", statusCode)
                    .field("backendRequestId", envelope.getRequestId())
                    .field("durationMs", elapsed)
                    .field("result", "ok")
                    .log(log, XelerGoLogger.Level.INFO);
                return envelope;
            } catch (XelerGoApiException e) {
                httpTrace(flow, stage, correlationValue, requestId, requestUri)
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("requestAttempted", true)
                    .field("requestDispatched", true)
                    .field("responseReceived", true)
                    .field("status", statusCode)
                    .field("durationMs", elapsed)
                    .field("backendCode", e.getBackendCode())
                    .field("backendRequestId", e.getBackendRequestId())
                    .field("failureClass", e.getFailureClass())
                    .field("failureCode", e.getFailureCode())
                    .field("failureReason", e.getMessage())
                    .field("responseBody", XelerGoTrace.truncate(responseBody, 240))
                    .field("result", "error")
                    .log(log, resolveLogLevel(e), e);
                throw e;
            } catch (RuntimeException e) {
                XelerGoApiException wrapped = new XelerGoApiException(
                    "Respuesta JSON invalida desde " + endpoint + ".",
                    statusCode,
                    null,
                    null,
                    XelerGoFailure.RESPONSE_SCHEMA,
                    XelerGoFailure.RESPONSE_INVALID_JSON,
                    endpoint,
                    e
                );
                httpTrace(flow, stage, correlationValue, requestId, requestUri)
                    .field("backendBaseUrl", config.getBaseUrl())
                    .field("requestAttempted", true)
                    .field("requestDispatched", true)
                    .field("responseReceived", true)
                    .field("status", statusCode)
                    .field("durationMs", elapsed)
                    .field("failureClass", wrapped.getFailureClass())
                    .field("failureCode", wrapped.getFailureCode())
                    .field("failureReason", wrapped.getMessage())
                    .field("responseBody", XelerGoTrace.truncate(responseBody, 240))
                    .field("result", "error")
                    .log(log, XelerGoLogger.Level.ERROR, e);
                throw wrapped;
            }
        } catch (UnknownHostException e) {
            throw logAndWrapNetworkError(flow, stage, correlationValue, requestId, requestUri, startedAt,
                requestAttempted, requestDispatched, responseReceived, XelerGoFailure.NETWORK,
                XelerGoFailure.NETWORK_DNS_FAILURE,
                "No se pudo resolver el host del backend para " + endpoint + ".", e, responseBody);
        } catch (SSLException e) {
            throw logAndWrapNetworkError(flow, stage, correlationValue, requestId, requestUri, startedAt,
                requestAttempted, requestDispatched, responseReceived, XelerGoFailure.NETWORK,
                XelerGoFailure.NETWORK_TLS_FAILURE,
                "Fallo TLS/SSL llamando a " + endpoint + ".", e, responseBody);
        } catch (SocketTimeoutException e) {
            throw logAndWrapNetworkError(flow, stage, correlationValue, requestId, requestUri, startedAt,
                requestAttempted, requestDispatched, responseReceived, XelerGoFailure.TIMEOUT,
                requestDispatched ? XelerGoFailure.NETWORK_READ_TIMEOUT : XelerGoFailure.NETWORK_CONNECT_TIMEOUT,
                requestDispatched
                    ? "Timeout esperando respuesta de " + endpoint + "."
                    : "Timeout abriendo conexion hacia " + endpoint + ".",
                e, responseBody);
        } catch (NoRouteToHostException e) {
            throw logAndWrapNetworkError(flow, stage, correlationValue, requestId, requestUri, startedAt,
                requestAttempted, requestDispatched, responseReceived, XelerGoFailure.NETWORK,
                XelerGoFailure.NETWORK_CONNECT_FAILURE,
                "No existe ruta al backend para " + endpoint + ".", e, responseBody);
        } catch (ConnectException e) {
            throw logAndWrapNetworkError(flow, stage, correlationValue, requestId, requestUri, startedAt,
                requestAttempted, requestDispatched, responseReceived, XelerGoFailure.NETWORK,
                XelerGoFailure.NETWORK_CONNECT_FAILURE,
                "No fue posible abrir conexion hacia " + endpoint + ".", e, responseBody);
        } catch (IOException e) {
            throw logAndWrapNetworkError(flow, stage, correlationValue, requestId, requestUri, startedAt,
                requestAttempted, requestDispatched, responseReceived, XelerGoFailure.NETWORK,
                XelerGoFailure.NETWORK_IO_FAILURE,
                "Error de red/E/S llamando a " + endpoint + ".", e, responseBody);
        } catch (RuntimeException e) {
            XelerGoApiException wrapped = new XelerGoApiException(
                "Fallo inesperado antes de completar " + endpoint + ".",
                e,
                XelerGoFailure.PRE_HTTP,
                XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION,
                endpoint
            );
            httpTrace(flow, stage, correlationValue, requestId, requestUri)
                .field("backendBaseUrl", config.getBaseUrl())
                .field("requestAttempted", requestAttempted)
                .field("requestDispatched", requestDispatched)
                .field("responseReceived", responseReceived)
                .field("durationMs", System.currentTimeMillis() - startedAt)
                .field("failureClass", wrapped.getFailureClass())
                .field("failureCode", wrapped.getFailureCode())
                .field("failureReason", wrapped.getMessage())
                .field("result", "error")
                .log(log, XelerGoLogger.Level.ERROR, e);
            throw wrapped;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private XelerGoApiException logAndWrapNetworkError(
        String flow,
        String stage,
        String correlationValue,
        String requestId,
        URI requestUri,
        long startedAt,
        boolean requestAttempted,
        boolean requestDispatched,
        boolean responseReceived,
        String failureClass,
        String failureCode,
        String message,
        IOException error,
        String responseBody
    ) {
        XelerGoApiException wrapped = new XelerGoApiException(message, error, failureClass, failureCode, requestUri.getPath());
        httpTrace(flow, stage, correlationValue, requestId, requestUri)
            .field("backendBaseUrl", config.getBaseUrl())
            .field("requestAttempted", requestAttempted)
            .field("requestDispatched", requestDispatched)
            .field("responseReceived", responseReceived)
            .field("durationMs", System.currentTimeMillis() - startedAt)
            .field("failureClass", failureClass)
            .field("failureCode", failureCode)
            .field("failureReason", message)
            .field("responseBody", XelerGoTrace.truncate(responseBody, 240))
            .field("result", "error")
            .log(log, resolveLogLevel(wrapped), error);
        return wrapped;
    }

    private void logResponseMappingFailure(
        String flow,
        String stage,
        String correlationValue,
        String backendPath,
        XelerGoApiException error
    ) {
        if (error == null || !XelerGoFailure.RESPONSE_SCHEMA.equals(error.getFailureClass())) {
            return;
        }
        XelerGoTrace.create()
            .field("flow", flow)
            .field("stage", stage)
            .field("correlationId", XelerGoTrace.firstNonBlank(correlationValue, error.getBackendRequestId()))
            .field("backendBaseUrl", config.getBaseUrl())
            .field("backendPath", backendPath)
            .field("backendRequestId", error.getBackendRequestId())
            .field("requestAttempted", true)
            .field("requestDispatched", true)
            .field("responseReceived", error.getHttpStatus() > 0)
            .field("status", error.getHttpStatus())
            .field("failureClass", error.getFailureClass())
            .field("failureCode", error.getFailureCode())
            .field("failureReason", error.getMessage())
            .field("result", "error")
            .log(log, resolveLogLevel(error), error);
    }

    private URI resolveUri(String path) throws XelerGoApiException {
        try {
            URI baseUri = URI.create(config.getBaseUrl());
            String resolvedPath = mergePathsDeduplicating(baseUri.getPath(), path);
            StringBuilder url = new StringBuilder();
            url.append(baseUri.getScheme()).append("://").append(baseUri.getAuthority()).append(resolvedPath);
            return URI.create(url.toString());
        } catch (IllegalArgumentException e) {
            throw new XelerGoApiException(
                "Configuracion invalida al resolver " + path + ". Revise apiProtocol, apiHost, apiPort y apiBasePath.",
                0,
                null,
                null,
                XelerGoFailure.CONFIG,
                XelerGoFailure.CONFIG_INVALID_BASE_URL,
                path,
                e
            );
        }
    }

    private static String mergePathsDeduplicating(String basePath, String requestPath) {
        List<String> baseSegments = splitSegments(basePath);
        List<String> requestSegments = splitSegments(requestPath);
        int maxOverlap = Math.min(baseSegments.size(), requestSegments.size());
        int overlap = 0;
        for (int candidate = maxOverlap; candidate > 0; candidate--) {
            boolean matches = true;
            for (int index = 0; index < candidate; index++) {
                String left = baseSegments.get(baseSegments.size() - candidate + index);
                String right = requestSegments.get(index);
                if (!left.equals(right)) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                overlap = candidate;
                break;
            }
        }

        List<String> merged = new ArrayList<>(baseSegments);
        merged.addAll(requestSegments.subList(overlap, requestSegments.size()));
        if (merged.isEmpty()) {
            return CAS_API_PREFIX;
        }
        return "/" + String.join("/", merged);
    }

    private static List<String> splitSegments(String path) {
        if (path == null || path.trim().isEmpty() || "/".equals(path.trim())) {
            return Collections.emptyList();
        }
        String[] rawSegments = path.split("/");
        List<String> segments = new ArrayList<>();
        for (String segment : rawSegments) {
            if (!segment.isEmpty()) {
                segments.add(segment);
            }
        }
        return segments;
    }

    private static int toIntMillis(Duration duration) {
        long value = duration.toMillis();
        if (value > Integer.MAX_VALUE) {
            return Integer.MAX_VALUE;
        }
        return (int) value;
    }

    private static String readResponseBody(HttpURLConnection connection, int statusCode) throws IOException {
        InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (stream == null) {
            return "{}";
        }
        try (InputStream inputStream = stream) {
            byte[] buffer = new byte[4096];
            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }
            return new String(outputStream.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static String requiredString(
        Map<String, Object> data,
        String field,
        String failureCode,
        String endpoint,
        ApiEnvelope envelope
    ) throws XelerGoApiException {
        String value = stringValue(data.get(field));
        if (value == null || value.isEmpty()) {
            throw new XelerGoApiException(
                "Falta el campo requerido " + field + " en " + endpoint + ".",
                envelope.getHttpStatus(),
                null,
                envelope.getRequestId(),
                XelerGoFailure.RESPONSE_SCHEMA,
                failureCode,
                endpoint
            );
        }
        return value;
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static BigDecimal decimalValue(
        Object value,
        String field,
        String endpoint,
        ApiEnvelope envelope
    ) throws XelerGoApiException {
        if (value == null) {
            return null;
        }
        try {
            return new BigDecimal(String.valueOf(value));
        } catch (NumberFormatException e) {
            throw new XelerGoApiException(
                "El campo " + field + " tiene un valor decimal invalido en " + endpoint + ".",
                envelope.getHttpStatus(),
                null,
                envelope.getRequestId(),
                XelerGoFailure.RESPONSE_SCHEMA,
                XelerGoFailure.RESPONSE_INVALID_DECIMAL,
                endpoint,
                e
            );
        }
    }

    private static XelerGoTrace httpTrace(
        String flow,
        String stage,
        String correlationValue,
        String requestId,
        URI requestUri
    ) {
        int port = requestUri.getPort() >= 0
            ? requestUri.getPort()
            : ("https".equalsIgnoreCase(requestUri.getScheme()) ? 443 : 80);
        return XelerGoTrace.create()
            .field("flow", flow)
            .field("stage", stage)
            .field("correlationId", XelerGoTrace.firstNonBlank(correlationValue, requestId))
            .field("backendHost", requestUri.getHost())
            .field("backendPort", port)
            .field("backendPath", requestUri.getPath())
            .field("requestId", requestId);
    }

    private static String flowFromPath(String path) {
        if (path != null && path.contains("/sell-orders")) {
            return "SELL";
        }
        if (path != null && path.contains("/buy-orders")) {
            return "BUY";
        }
        return "SYSTEM";
    }

    private static String stageFromPath(String method, String path) {
        if ("POST".equalsIgnoreCase(method) && path.endsWith("/complete-payout")) {
            return "complete_payout_http";
        }
        if ("POST".equalsIgnoreCase(method) && path.endsWith("/cancel")) {
            return "cancel_http";
        }
        if ("GET".equalsIgnoreCase(method) && path.endsWith("/timeline")) {
            return "timeline_http";
        }
        if ("GET".equalsIgnoreCase(method)) {
            return "order_status_http";
        }
        return "precreate_http";
    }

    private static XelerGoLogger.Level resolveLogLevel(XelerGoApiException error) {
        if (error.isUnauthorized()) {
            return XelerGoLogger.Level.ERROR;
        }
        if (XelerGoFailure.RESPONSE_SCHEMA.equals(error.getFailureClass())) {
            return XelerGoLogger.Level.ERROR;
        }
        if (error.isTemporary() || error.isConflict()) {
            return XelerGoLogger.Level.WARN;
        }
        return XelerGoLogger.Level.WARN;
    }

    static final class CreateSellOrderResponse {
        private final String orderId;
        private final String status;
        private final String depositAddress;
        private final String qrPayload;
        private final String expiresAt;
        private final String requestId;

        CreateSellOrderResponse(String orderId, String status, String depositAddress, String qrPayload, String expiresAt, String requestId) {
            this.orderId = orderId;
            this.status = status;
            this.depositAddress = depositAddress;
            this.qrPayload = qrPayload;
            this.expiresAt = expiresAt;
            this.requestId = requestId;
        }

        String getOrderId() {
            return orderId;
        }

        String getStatus() {
            return status;
        }

        String getDepositAddress() {
            return depositAddress;
        }

        String getQrPayload() {
            return qrPayload;
        }

        String getExpiresAt() {
            return expiresAt;
        }

        String getRequestId() {
            return requestId;
        }
    }

    static final class CreateBuyOrderResponse {
        private final String orderId;
        private final String status;
        private final String type;
        private final String customerDestinationAddress;
        private final BigDecimal cryptoAmountToSend;
        private final String requestId;

        CreateBuyOrderResponse(String orderId, String status, String type, String customerDestinationAddress, BigDecimal cryptoAmountToSend, String requestId) {
            this.orderId = orderId;
            this.status = status;
            this.type = type;
            this.customerDestinationAddress = customerDestinationAddress;
            this.cryptoAmountToSend = cryptoAmountToSend;
            this.requestId = requestId;
        }

        String getOrderId() {
            return orderId;
        }

        String getStatus() {
            return status;
        }

        String getType() {
            return type;
        }

        String getCustomerDestinationAddress() {
            return customerDestinationAddress;
        }

        BigDecimal getCryptoAmountToSend() {
            return cryptoAmountToSend;
        }

        String getRequestId() {
            return requestId;
        }
    }

    static final class OrderStatusResponse {
        private final String orderId;
        private final String status;
        private final String type;
        private final BigDecimal cryptoAmountExpected;
        private final BigDecimal cryptoAmountReceived;
        private final BigDecimal cryptoAmountToSend;
        private final String depositAddress;
        private final String customerDestinationAddress;
        private final String providerRequestId;
        private final String txid;
        private final Boolean manualReviewRequired;
        private final String lastErrorCode;
        private final String lastErrorMessage;
        private final String updatedAt;
        private final String requestId;

        OrderStatusResponse(
            String orderId,
            String status,
            String type,
            BigDecimal cryptoAmountExpected,
            BigDecimal cryptoAmountReceived,
            BigDecimal cryptoAmountToSend,
            String depositAddress,
            String customerDestinationAddress,
            String providerRequestId,
            String txid,
            Boolean manualReviewRequired,
            String lastErrorCode,
            String lastErrorMessage,
            String updatedAt,
            String requestId
        ) {
            this.orderId = orderId;
            this.status = status;
            this.type = type;
            this.cryptoAmountExpected = cryptoAmountExpected;
            this.cryptoAmountReceived = cryptoAmountReceived;
            this.cryptoAmountToSend = cryptoAmountToSend;
            this.depositAddress = depositAddress;
            this.customerDestinationAddress = customerDestinationAddress;
            this.providerRequestId = providerRequestId;
            this.txid = txid;
            this.manualReviewRequired = manualReviewRequired;
            this.lastErrorCode = lastErrorCode;
            this.lastErrorMessage = lastErrorMessage;
            this.updatedAt = updatedAt;
            this.requestId = requestId;
        }

        static OrderStatusResponse fromSell(Map<String, Object> data, ApiEnvelope envelope, String endpoint) throws XelerGoApiException {
            return new OrderStatusResponse(
                requiredString(data, "orderId", XelerGoFailure.RESPONSE_MISSING_ORDER_ID, endpoint, envelope),
                requiredString(data, "status", XelerGoFailure.RESPONSE_MISSING_STATUS, endpoint, envelope),
                "SELL",
                decimalValue(data.get("cryptoAmountExpected"), "cryptoAmountExpected", endpoint, envelope),
                decimalValue(data.get("cryptoAmountReceived"), "cryptoAmountReceived", endpoint, envelope),
                null,
                stringValue(data.get("depositAddress")),
                null,
                null,
                stringValue(data.get("forwardTxid")),
                booleanValue(data.get("manualReviewRequired")),
                stringValue(data.get("lastErrorCode")),
                stringValue(data.get("lastErrorMessage")),
                stringValue(data.get("updatedAt")),
                envelope.getRequestId()
            );
        }

        static OrderStatusResponse fromBuy(Map<String, Object> data, ApiEnvelope envelope, String endpoint) throws XelerGoApiException {
            return new OrderStatusResponse(
                requiredString(data, "orderId", XelerGoFailure.RESPONSE_MISSING_ORDER_ID, endpoint, envelope),
                requiredString(data, "status", XelerGoFailure.RESPONSE_MISSING_STATUS, endpoint, envelope),
                stringValue(data.get("type")),
                null,
                null,
                decimalValue(data.get("cryptoAmountToSend"), "cryptoAmountToSend", endpoint, envelope),
                null,
                stringValue(data.get("customerDestinationAddress")),
                stringValue(data.get("providerRequestId")),
                stringValue(data.get("sendTxid")),
                booleanValue(data.get("manualReviewRequired")),
                stringValue(data.get("lastErrorCode")),
                stringValue(data.get("lastErrorMessage")),
                stringValue(data.get("updatedAt")),
                envelope.getRequestId()
            );
        }

        String getOrderId() {
            return orderId;
        }

        String getStatus() {
            return status;
        }

        String getType() {
            return type;
        }

        BigDecimal getCryptoAmountExpected() {
            return cryptoAmountExpected;
        }

        BigDecimal getCryptoAmountReceived() {
            return cryptoAmountReceived;
        }

        BigDecimal getCryptoAmountToSend() {
            return cryptoAmountToSend;
        }

        String getDepositAddress() {
            return depositAddress;
        }

        String getCustomerDestinationAddress() {
            return customerDestinationAddress;
        }

        String getProviderRequestId() {
            return providerRequestId;
        }

        String getTxid() {
            return txid;
        }

        Boolean getManualReviewRequired() {
            return manualReviewRequired;
        }

        String getLastErrorCode() {
            return lastErrorCode;
        }

        String getLastErrorMessage() {
            return lastErrorMessage;
        }

        String getUpdatedAt() {
            return updatedAt;
        }

        String getRequestId() {
            return requestId;
        }
    }

    static final class ApiEnvelope {
        private final int httpStatus;
        private final boolean success;
        private final Object data;
        private final String requestId;

        private ApiEnvelope(int httpStatus, boolean success, Object data, String requestId) {
            this.httpStatus = httpStatus;
            this.success = success;
            this.data = data;
            this.requestId = requestId;
        }

        static ApiEnvelope fromResponse(int httpStatus, String rawBody, String endpoint) throws XelerGoApiException {
            try {
                Map<String, Object> json = XelerGoJson.parseObject(rawBody == null || rawBody.isEmpty() ? "{}" : rawBody);
                Map<String, Object> meta = mapValue(json.get("meta"));
                String requestId = meta == null ? null : stringValue(meta.get("requestId"));
                boolean success = Boolean.TRUE.equals(json.get("success"));
                if (!success) {
                    Map<String, Object> error = mapValue(json.get("error"));
                    String code = error == null ? null : stringValue(error.get("code"));
                    String message = error == null ? "Error desconocido del backend." : stringValue(error.get("message"));
                    throw new XelerGoApiException(
                        message == null || message.trim().isEmpty() ? "Error desconocido del backend." : message,
                        httpStatus,
                        code,
                        requestId,
                        failureClassForStatus(httpStatus, code),
                        XelerGoFailure.backendFailureCode(code, httpStatus),
                        endpoint
                    );
                }
                return new ApiEnvelope(httpStatus, true, json.get("data"), requestId);
            } catch (XelerGoApiException e) {
                throw e;
            } catch (RuntimeException e) {
                throw new XelerGoApiException(
                    "Respuesta JSON invalida desde " + endpoint + ".",
                    httpStatus,
                    null,
                    null,
                    XelerGoFailure.RESPONSE_SCHEMA,
                    XelerGoFailure.RESPONSE_INVALID_JSON,
                    endpoint,
                    e
                );
            }
        }

        Object getData() {
            return data;
        }

        Map<String, Object> requireData(String endpoint) throws XelerGoApiException {
            Map<String, Object> map = mapValue(data);
            if (map == null) {
                throw new XelerGoApiException(
                    "La respuesta exitosa de " + endpoint + " no contiene data objeto.",
                    httpStatus,
                    null,
                    requestId,
                    XelerGoFailure.RESPONSE_SCHEMA,
                    XelerGoFailure.RESPONSE_MISSING_DATA,
                    endpoint
                );
            }
            return map;
        }

        int getHttpStatus() {
            return httpStatus;
        }

        String getRequestId() {
            return requestId;
        }

        @SuppressWarnings("unchecked")
        private static Map<String, Object> mapValue(Object value) {
            return value instanceof Map ? (Map<String, Object>) value : null;
        }

        private static String failureClassForStatus(int httpStatus, String backendCode) {
            if (httpStatus == 401 || httpStatus == 403) {
                return XelerGoFailure.CONFIG;
            }
            if (httpStatus == 409) {
                return XelerGoFailure.STATE;
            }
            if (backendCode != null && backendCode.toUpperCase().contains("VALIDATION")) {
                return XelerGoFailure.VALIDATION;
            }
            if (httpStatus >= 400 && httpStatus < 500) {
                return XelerGoFailure.BUSINESS_RULE;
            }
            return XelerGoFailure.HTTP_STATUS;
        }
    }

    private static Boolean booleanValue(Object value) {
        return value instanceof Boolean ? (Boolean) value : null;
    }
}
