package com.xelergo.gb.extension;

final class XelerGoLocalException extends RuntimeException {
    private final String failureClass;
    private final String failureCode;

    XelerGoLocalException(String failureClass, String failureCode, String message) {
        super(message);
        this.failureClass = failureClass;
        this.failureCode = failureCode;
    }

    XelerGoLocalException(String failureClass, String failureCode, String message, Throwable cause) {
        super(message, cause);
        this.failureClass = failureClass;
        this.failureCode = failureCode;
    }

    String getFailureClass() {
        return failureClass;
    }

    String getFailureCode() {
        return failureCode;
    }
}
