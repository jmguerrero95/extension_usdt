package com.xelergo.gb.extension;

final class XelerGoConfigTest {
    private XelerGoConfigTest() {
    }

    static void run() {
        parsesStructuredWalletLogin();
        preservesBlankOptionalFields();
        rejectsMissingWalletLogin();
        rejectsMalformedWalletLogin();
        rejectsEmptyApiKey();
        rejectsEmptyBaseUrlComponents();
        requiresStaticTerminalIdInStaticMode();
        rejectsInvalidTimeoutsAndRanges();
        rejectsInvalidBasePathFormat();
    }

    private static void parsesStructuredWalletLogin() {
        XelerGoConfig config = XelerGoConfig.fromWalletLogin(
            "xelergo:https:api.example.com:443:/backend:secret-key:7000:12000:static:batm-001:20:96"
        );

        TestSupport.assertEquals("https://api.example.com:443/backend", config.getBaseUrl(), "baseUrl");
        TestSupport.assertEquals("secret-key", config.getApiKey(), "apiKey");
        TestSupport.assertEquals(Long.valueOf(7000L), Long.valueOf(config.getConnectTimeout().toMillis()), "connectTimeout");
        TestSupport.assertEquals(Long.valueOf(12000L), Long.valueOf(config.getReadTimeout().toMillis()), "readTimeout");
        TestSupport.assertEquals(XelerGoConfig.TerminalIdMode.STATIC, config.getTerminalIdMode(), "terminalIdMode");
        TestSupport.assertEquals("batm-001", config.getStaticTerminalId(), "staticTerminalId");
        TestSupport.assertEquals(Long.valueOf(20L), Long.valueOf(config.getPollingSeconds()), "pollingSeconds");
        TestSupport.assertEquals(Long.valueOf(96L), Long.valueOf(config.getLookbackHours()), "lookbackHours");
    }

    private static void preservesBlankOptionalFields() {
        XelerGoConfig config = XelerGoConfig.fromWalletLogin(
            "xelergo:https:api.example.com::/api:secret-key:::terminalSerial::15:72"
        );

        TestSupport.assertEquals("https://api.example.com/api", config.getBaseUrl(), "baseUrl without port");
        TestSupport.assertEquals(XelerGoConfig.TerminalIdMode.TERMINAL_SERIAL, config.getTerminalIdMode(), "default terminal mode");
        TestSupport.assertEquals(null, config.getStaticTerminalId(), "blank staticTerminalId should stay null");
    }

    private static void rejectsMissingWalletLogin() {
        assertInvalidConfig(null, XelerGoFailure.CONFIG_WALLET_LOGIN_MISSING, "walletLogin");
    }

    private static void rejectsMalformedWalletLogin() {
        assertInvalidConfig("xelergo:https", XelerGoFailure.CONFIG_WALLET_LOGIN_MALFORMED, "Formato invalido");
    }

    private static void rejectsEmptyApiKey() {
        assertInvalidConfig(
            "xelergo:https:api.example.com:443:/api:",
            XelerGoFailure.CONFIG_API_KEY_EMPTY,
            "apiKey"
        );
    }

    private static void rejectsEmptyBaseUrlComponents() {
        assertInvalidConfig(
            "xelergo::api.example.com:443:/api:secret-key",
            XelerGoFailure.CONFIG_BASE_URL_EMPTY,
            "apiProtocol"
        );
    }

    private static void requiresStaticTerminalIdInStaticMode() {
        assertInvalidConfig(
            "xelergo:https:api.example.com:443:/api:secret-key:5000:10000:static::15:72",
            XelerGoFailure.CONFIG_TERMINAL_ID_EMPTY,
            "staticTerminalId"
        );
    }

    private static void rejectsInvalidTimeoutsAndRanges() {
        assertInvalidConfig(
            "xelergo:https:api.example.com:443:/api:secret-key:10000:5000:terminalSerial::15:72",
            XelerGoFailure.CONFIG_READ_TIMEOUT_INVALID,
            "readTimeout"
        );
        assertInvalidConfig(
            "xelergo:https:api.example.com:70000:/api:secret-key",
            XelerGoFailure.CONFIG_INVALID_BASE_URL,
            "apiPort"
        );
        assertInvalidConfig(
            "xelergo:https:api.example.com:443:/api:secret-key:5000:10000:terminalSerial::1:72",
            XelerGoFailure.CONFIG_POLLING_SECONDS_INVALID,
            "pollingSeconds"
        );
    }

    private static void rejectsInvalidBasePathFormat() {
        assertInvalidConfig(
            "xelergo:https:api.example.com:443:/api?foo=bar:secret-key",
            XelerGoFailure.CONFIG_INVALID_BASE_URL,
            "apiBasePath"
        );
        assertInvalidConfig(
            "xelergo:https:api.example.com:443:/api#frag:secret-key",
            XelerGoFailure.CONFIG_INVALID_BASE_URL,
            "apiBasePath"
        );
    }

    private static void assertInvalidConfig(String walletLogin, String expectedFailureCode, String expectedMessagePart) {
        try {
            XelerGoConfig.fromWalletLogin(walletLogin);
            TestSupport.fail("Se esperaba configuracion invalida");
        } catch (XelerGoConfigException expected) {
            TestSupport.assertEquals(expectedFailureCode, expected.getFailureCode(), "failureCode");
            TestSupport.assertTrue(
                expected.getMessage().contains(expectedMessagePart),
                "El error debe mencionar " + expectedMessagePart
            );
        }
    }
}
