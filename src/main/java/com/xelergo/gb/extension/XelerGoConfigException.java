package com.xelergo.gb.extension;

final class XelerGoConfigException extends IllegalArgumentException {
    private final String failureCode;

    XelerGoConfigException(String failureCode, String message) {
        super(message);
        this.failureCode = failureCode;
    }

    XelerGoConfigException(String failureCode, String message, Throwable cause) {
        super(message, cause);
        this.failureCode = failureCode;
    }

    String getFailureCode() {
        return failureCode;
    }
}
