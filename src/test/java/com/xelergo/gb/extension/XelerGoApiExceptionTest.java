package com.xelergo.gb.extension;

final class XelerGoApiExceptionTest {
    private XelerGoApiExceptionTest() {
    }

    static void run() {
        classifiesTemporaryErrors();
        classifiesConflictAndUnauthorizedErrors();
    }

    private static void classifiesTemporaryErrors() {
        TestSupport.assertTrue(
            new XelerGoApiException("timeout", 503, "PROVIDER_TIMEOUT", "req-1").isTemporary(),
            "503 debe tratarse como temporal"
        );
        TestSupport.assertTrue(
            !new XelerGoApiException("validation", 422, "VALIDATION_ERROR", "req-2").isTemporary(),
            "422 no debe tratarse como temporal"
        );
    }

    private static void classifiesConflictAndUnauthorizedErrors() {
        TestSupport.assertTrue(
            new XelerGoApiException("conflict", 409, "INVALID_STATE_TRANSITION", "req-3").isConflict(),
            "409 debe clasificarse como conflicto"
        );
        TestSupport.assertTrue(
            new XelerGoApiException("unauthorized", 401, "UNAUTHORIZED", "req-4").isUnauthorized(),
            "401 debe clasificarse como no autorizado"
        );
    }
}
