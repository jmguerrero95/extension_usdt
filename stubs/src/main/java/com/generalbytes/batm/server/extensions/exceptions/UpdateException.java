package com.generalbytes.batm.server.extensions.exceptions;

public class UpdateException extends Exception {
    public UpdateException() {
    }

    public UpdateException(String message) {
        super(message);
    }

    public UpdateException(String message, Throwable cause) {
        super(message, cause);
    }
}
