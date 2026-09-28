package com.xelergo.gb.extension;

import org.slf4j.Logger;

final class XelerGoLogger {
    static final String LOGGER_NAME = "batm.master.xelergo";

    enum Level {
        TRACE,
        DEBUG,
        INFO,
        WARN,
        ERROR
    }

    private XelerGoLogger() {
    }

    static void log(Logger logger, Level level, String message) {
        log(logger, level, message, null);
    }

    static void log(Logger logger, Level level, String message, Throwable error) {
        if (logger == null || message == null) {
            return;
        }
        Level safeLevel = level == null ? Level.INFO : level;
        switch (safeLevel) {
            case TRACE:
                if (error == null) {
                    logger.trace(message);
                } else {
                    logger.trace(message, error);
                }
                break;
            case DEBUG:
                if (error == null) {
                    logger.debug(message);
                } else {
                    logger.debug(message, error);
                }
                break;
            case WARN:
                if (error == null) {
                    logger.warn(message);
                } else {
                    logger.warn(message, error);
                }
                break;
            case ERROR:
                if (error == null) {
                    logger.error(message);
                } else {
                    logger.error(message, error);
                }
                break;
            case INFO:
            default:
                if (error == null) {
                    logger.info(message);
                } else {
                    logger.info(message, error);
                }
                break;
        }
    }

    static Throwable rootCause(Throwable error) {
        if (error == null) {
            return null;
        }
        Throwable current = error;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current;
    }

    static String messageOrClass(Throwable error) {
        if (error == null) {
            return null;
        }
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? error.getClass().getName() : message;
    }
}
