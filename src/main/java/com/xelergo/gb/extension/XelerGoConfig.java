package com.xelergo.gb.extension;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

final class XelerGoConfig {
    static final String WALLET_PREFIX = "xelergo";
    static final String CRYPTO_CURRENCY = "USDTTRON";
    static final String ASSET = "USDT";
    static final String NETWORK = "TRON";
    static final String FIAT_CURRENCY = "COP";

    enum TerminalIdMode {
        STATIC,
        TERMINAL_SERIAL
    }

    private final String baseUrl;
    private final String apiKey;
    private final Duration connectTimeout;
    private final Duration readTimeout;
    private final TerminalIdMode terminalIdMode;
    private final String staticTerminalId;
    private final long pollingSeconds;
    private final long lookbackHours;
    private final String configKey;

    private XelerGoConfig(
        String baseUrl,
        String apiKey,
        Duration connectTimeout,
        Duration readTimeout,
        TerminalIdMode terminalIdMode,
        String staticTerminalId,
        long pollingSeconds,
        long lookbackHours
    ) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.apiKey = requireNonBlank(apiKey, "apiKey", XelerGoFailure.CONFIG_API_KEY_EMPTY);
        this.connectTimeout = validateDuration(connectTimeout, "connectTimeout", XelerGoFailure.CONFIG_CONNECT_TIMEOUT_INVALID);
        this.readTimeout = validateDuration(readTimeout, "readTimeout", XelerGoFailure.CONFIG_READ_TIMEOUT_INVALID);
        this.terminalIdMode = terminalIdMode;
        this.staticTerminalId = emptyToNull(staticTerminalId);
        this.pollingSeconds = validateRange(pollingSeconds, 5L, 3600L, "pollingSeconds", XelerGoFailure.CONFIG_POLLING_SECONDS_INVALID);
        this.lookbackHours = validateRange(lookbackHours, 1L, 24L * 30L, "lookbackHours", XelerGoFailure.CONFIG_LOOKBACK_HOURS_INVALID);
        validateCrossFieldRules();
        this.configKey = this.baseUrl + "|" + terminalIdMode + "|" + (this.staticTerminalId == null ? "" : this.staticTerminalId);
    }

    static XelerGoConfig fromWalletLogin(String walletLogin) {
        String normalizedWalletLogin = walletLogin == null ? null : walletLogin.trim();
        if (normalizedWalletLogin == null || normalizedWalletLogin.isEmpty()) {
            throw invalid(XelerGoFailure.CONFIG_WALLET_LOGIN_MISSING, "walletLogin no puede estar vacio");
        }

        List<String> parts = tokenize(normalizedWalletLogin);
        if (parts.isEmpty()) {
            throw invalid(XelerGoFailure.CONFIG_WALLET_LOGIN_MALFORMED, "walletLogin no pudo tokenizarse.");
        }
        String prefix = emptyToNull(parts.get(0));
        if (!WALLET_PREFIX.equalsIgnoreCase(prefix)) {
            throw invalid(
                XelerGoFailure.CONFIG_WALLET_LOGIN_MALFORMED,
                "Prefijo de wallet no soportado. Se espera '" + WALLET_PREFIX + "'."
            );
        }
        if (parts.size() < 6) {
            throw invalid(
                XelerGoFailure.CONFIG_WALLET_LOGIN_MALFORMED,
                "Formato invalido. Se espera xelergo:apiProtocol:apiHost:apiPort:apiBasePath:apiKey[:connectTimeoutMs[:readTimeoutMs[:terminalIdMode[:staticTerminalId[:pollingSeconds[:lookbackHours]]]]]]"
            );
        }

        String protocol = requireNonBlank(token(parts, 1), "apiProtocol", XelerGoFailure.CONFIG_BASE_URL_EMPTY);
        String host = requireNonBlank(token(parts, 2), "apiHost", XelerGoFailure.CONFIG_BASE_URL_EMPTY);
        String port = token(parts, 3);
        String basePath = token(parts, 4);
        String apiKey = requireNonBlank(token(parts, 5), "apiKey", XelerGoFailure.CONFIG_API_KEY_EMPTY);

        long connectTimeoutMs = parseLong(parts, 6, 5000L, "connectTimeoutMs", XelerGoFailure.CONFIG_CONNECT_TIMEOUT_INVALID);
        long readTimeoutMs = parseLong(parts, 7, 10000L, "readTimeoutMs", XelerGoFailure.CONFIG_READ_TIMEOUT_INVALID);
        TerminalIdMode terminalIdMode = parseTerminalIdMode(parts, 8);
        String staticTerminalId = token(parts, 9);
        long pollingSeconds = parseLong(parts, 10, 15L, "pollingSeconds", XelerGoFailure.CONFIG_POLLING_SECONDS_INVALID);
        long lookbackHours = parseLong(parts, 11, 72L, "lookbackHours", XelerGoFailure.CONFIG_LOOKBACK_HOURS_INVALID);

        return new XelerGoConfig(
            buildBaseUrl(protocol, host, port, basePath),
            apiKey,
            Duration.ofMillis(connectTimeoutMs),
            Duration.ofMillis(readTimeoutMs),
            terminalIdMode,
            staticTerminalId,
            pollingSeconds,
            lookbackHours
        );
    }

    String getBaseUrl() {
        return baseUrl;
    }

    String getApiKey() {
        return apiKey;
    }

    Duration getConnectTimeout() {
        return connectTimeout;
    }

    Duration getReadTimeout() {
        return readTimeout;
    }

    TerminalIdMode getTerminalIdMode() {
        return terminalIdMode;
    }

    String getStaticTerminalId() {
        return staticTerminalId;
    }

    long getPollingSeconds() {
        return pollingSeconds;
    }

    long getLookbackHours() {
        return lookbackHours;
    }

    String getConfigKey() {
        return configKey;
    }

    String toSafeLogString() {
        return "baseUrl=" + baseUrl
            + " terminalIdMode=" + terminalIdMode
            + " staticTerminalId=" + (staticTerminalId == null ? "" : staticTerminalId)
            + " pollingSeconds=" + pollingSeconds
            + " lookbackHours=" + lookbackHours;
    }

    private static List<String> tokenize(String walletLogin) {
        return new ArrayList<>(Arrays.asList(walletLogin.split(":", -1)));
    }

    private static String buildBaseUrl(String protocol, String host, String port, String basePath) {
        String normalizedProtocol = requireNonBlank(protocol, "apiProtocol", XelerGoFailure.CONFIG_BASE_URL_EMPTY).toLowerCase();
        if (!"http".equals(normalizedProtocol) && !"https".equals(normalizedProtocol)) {
            throw invalid(XelerGoFailure.CONFIG_INVALID_BASE_URL, "apiProtocol debe ser http o https");
        }
        String normalizedHost = requireNonBlank(host, "apiHost", XelerGoFailure.CONFIG_BASE_URL_EMPTY);
        String normalizedPath = normalizeBasePath(basePath);
        StringBuilder builder = new StringBuilder();
        builder.append(normalizedProtocol).append("://").append(normalizedHost);
        if (port != null && !port.trim().isEmpty()) {
            int parsedPort;
            try {
                parsedPort = Integer.parseInt(port.trim());
            } catch (NumberFormatException e) {
                throw invalid(XelerGoFailure.CONFIG_INVALID_BASE_URL, "apiPort debe ser numerico", e);
            }
            if (parsedPort < 1 || parsedPort > 65535) {
                throw invalid(XelerGoFailure.CONFIG_INVALID_BASE_URL, "apiPort debe estar entre 1 y 65535");
            }
            builder.append(':').append(parsedPort);
        }
        builder.append(normalizedPath);
        return builder.toString();
    }

    private static String normalizeBaseUrl(String value) {
        String trimmed = requireNonBlank(value, "baseUrl", XelerGoFailure.CONFIG_BASE_URL_EMPTY);
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }

    private static String normalizeBasePath(String value) {
        if (value == null || value.trim().isEmpty() || "/".equals(value.trim())) {
            return "";
        }
        String normalized = value.trim();
        if (normalized.contains("://")) {
            throw invalid(XelerGoFailure.CONFIG_INVALID_BASE_URL, "apiBasePath debe ser solo el path base, no una URL completa");
        }
        if (normalized.contains("?") || normalized.contains("#")) {
            throw invalid(XelerGoFailure.CONFIG_INVALID_BASE_URL, "apiBasePath no puede contener query string ni fragment");
        }
        while (normalized.contains("//")) {
            normalized = normalized.replace("//", "/");
        }
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        return normalized.endsWith("/") ? normalized.substring(0, normalized.length() - 1) : normalized;
    }

    private static long parseLong(List<String> parts, int index, long defaultValue, String fieldName, String failureCode) {
        String value = token(parts, index);
        if (value == null || value.isEmpty()) {
            return defaultValue;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw invalid(failureCode, fieldName + " debe ser numerico", e);
        }
    }

    private static TerminalIdMode parseTerminalIdMode(List<String> parts, int index) {
        String value = token(parts, index);
        if (value == null || value.isEmpty()) {
            return TerminalIdMode.TERMINAL_SERIAL;
        }
        if ("static".equalsIgnoreCase(value)) {
            return TerminalIdMode.STATIC;
        }
        if ("terminalSerial".equalsIgnoreCase(value)) {
            return TerminalIdMode.TERMINAL_SERIAL;
        }
        throw invalid(XelerGoFailure.CONFIG_TERMINAL_ID_MODE_INVALID, "terminalIdMode debe ser static o terminalSerial");
    }

    private static String requireNonBlank(String value, String fieldName, String failureCode) {
        if (value == null || value.trim().isEmpty()) {
            throw invalid(failureCode, fieldName + " no puede estar vacio");
        }
        return value.trim();
    }

    private static String emptyToNull(String value) {
        return value == null || value.trim().isEmpty() ? null : value.trim();
    }

    private static Duration validateDuration(Duration value, String fieldName, String failureCode) {
        if (value == null || value.isNegative() || value.isZero()) {
            throw invalid(failureCode, fieldName + " debe ser mayor que cero");
        }
        return value;
    }

    private static long validateRange(long value, long min, long max, String fieldName, String failureCode) {
        if (value < min || value > max) {
            throw invalid(failureCode, fieldName + " debe estar entre " + min + " y " + max);
        }
        return value;
    }

    private void validateCrossFieldRules() {
        if (readTimeout.compareTo(connectTimeout) < 0) {
            throw invalid(XelerGoFailure.CONFIG_READ_TIMEOUT_INVALID, "readTimeout no puede ser menor que connectTimeout");
        }
        if (terminalIdMode == TerminalIdMode.STATIC && staticTerminalId == null) {
            throw invalid(XelerGoFailure.CONFIG_TERMINAL_ID_EMPTY, "staticTerminalId es obligatorio cuando terminalIdMode=static");
        }
    }

    private static String token(List<String> parts, int index) {
        return parts.size() > index ? parts.get(index) : null;
    }

    private static XelerGoConfigException invalid(String failureCode, String message) {
        return new XelerGoConfigException(failureCode, message);
    }

    private static XelerGoConfigException invalid(String failureCode, String message, Throwable cause) {
        return new XelerGoConfigException(failureCode, message, cause);
    }
}
