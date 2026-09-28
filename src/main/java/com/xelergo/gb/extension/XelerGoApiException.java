package com.xelergo.gb.extension;

final class XelerGoApiException extends Exception {
    private final int httpStatus;
    private final String backendCode;
    private final String backendRequestId;
    private final String failureClass;
    private final String failureCode;
    private final String endpoint;

    XelerGoApiException(String message, int httpStatus, String backendCode, String backendRequestId) {
        this(message, httpStatus, backendCode, backendRequestId, XelerGoFailure.HTTP_STATUS, XelerGoFailure.backendFailureCode(backendCode, httpStatus), null, null);
    }

    XelerGoApiException(
        String message,
        int httpStatus,
        String backendCode,
        String backendRequestId,
        String failureClass,
        String failureCode,
        String endpoint
    ) {
        this(message, httpStatus, backendCode, backendRequestId, failureClass, failureCode, endpoint, null);
    }

    XelerGoApiException(
        String message,
        int httpStatus,
        String backendCode,
        String backendRequestId,
        String failureClass,
        String failureCode,
        String endpoint,
        Throwable cause
    ) {
        super(message, cause);
        this.httpStatus = httpStatus;
        this.backendCode = backendCode;
        this.backendRequestId = backendRequestId;
        this.failureClass = failureClass;
        this.failureCode = failureCode;
        this.endpoint = endpoint;
    }

    XelerGoApiException(String message, Throwable cause) {
        this(message, cause, XelerGoFailure.UNKNOWN, XelerGoFailure.UNKNOWN_RUNTIME_EXCEPTION, null);
    }

    XelerGoApiException(String message, Throwable cause, String failureClass, String failureCode, String endpoint) {
        super(message, cause);
        this.httpStatus = 0;
        this.backendCode = null;
        this.backendRequestId = null;
        this.failureClass = failureClass;
        this.failureCode = failureCode;
        this.endpoint = endpoint;
    }

    int getHttpStatus() {
        return httpStatus;
    }

    String getBackendCode() {
        return backendCode;
    }

    String getBackendRequestId() {
        return backendRequestId;
    }

    String getFailureClass() {
        return failureClass;
    }

    String getFailureCode() {
        return failureCode;
    }

    String getEndpoint() {
        return endpoint;
    }

    boolean isTemporary() {
        return httpStatus == 0 || httpStatus == 429 || httpStatus == 502 || httpStatus == 503 || httpStatus >= 500;
    }

    boolean isConflict() {
        return httpStatus == 409;
    }

    boolean isUnauthorized() {
        return httpStatus == 401 || httpStatus == 403;
    }

    boolean isNotFound() {
        return httpStatus == 404;
    }
}
