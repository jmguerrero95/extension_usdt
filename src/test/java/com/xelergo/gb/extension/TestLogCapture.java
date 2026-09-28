package com.xelergo.gb.extension;

import java.util.ArrayList;
import java.util.List;

import org.slf4j.LoggerFactory;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

final class TestLogCapture implements AutoCloseable {
    private final Logger logger;
    private final ch.qos.logback.classic.Level previousLevel;
    private final ListAppender<ILoggingEvent> appender;

    private TestLogCapture(String loggerName) {
        this.logger = (Logger) LoggerFactory.getLogger(loggerName);
        this.previousLevel = logger.getLevel();
        this.appender = new ListAppender<ILoggingEvent>();
        this.appender.start();
        logger.addAppender(appender);
        logger.setLevel(ch.qos.logback.classic.Level.ALL);
    }

    static TestLogCapture attachXelerGo() {
        return new TestLogCapture(XelerGoLogger.LOGGER_NAME);
    }

    boolean contains(String token) {
        if (token == null) {
            return false;
        }
        for (ILoggingEvent event : appender.list) {
            if (event.getFormattedMessage().contains(token)) {
                return true;
            }
        }
        return false;
    }

    boolean contains(ch.qos.logback.classic.Level level, String token) {
        if (level == null || token == null) {
            return false;
        }
        for (ILoggingEvent event : appender.list) {
            if (level.equals(event.getLevel()) && event.getFormattedMessage().contains(token)) {
                return true;
            }
        }
        return false;
    }

    int count(String token) {
        if (token == null) {
            return 0;
        }
        int count = 0;
        for (ILoggingEvent event : appender.list) {
            if (event.getFormattedMessage().contains(token)) {
                count++;
            }
        }
        return count;
    }

    int count(ch.qos.logback.classic.Level level, String token) {
        if (level == null || token == null) {
            return 0;
        }
        int count = 0;
        for (ILoggingEvent event : appender.list) {
            if (level.equals(event.getLevel()) && event.getFormattedMessage().contains(token)) {
                count++;
            }
        }
        return count;
    }

    List<String> messages() {
        List<String> messages = new ArrayList<String>();
        for (ILoggingEvent event : appender.list) {
            messages.add(event.getFormattedMessage());
        }
        return messages;
    }

    @Override
    public void close() {
        logger.detachAppender(appender);
        appender.stop();
        logger.setLevel(previousLevel);
    }
}
