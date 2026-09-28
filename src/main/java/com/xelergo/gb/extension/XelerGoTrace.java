package com.xelergo.gb.extension;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;

final class XelerGoTrace {
    private final LinkedHashMap<String, String> fields = new LinkedHashMap<String, String>();

    private XelerGoTrace() {
    }

    static XelerGoTrace create() {
        return new XelerGoTrace();
    }

    XelerGoTrace field(String key, Object value) {
        if (key == null || key.trim().isEmpty() || value == null) {
            return this;
        }
        String text = String.valueOf(value);
        if (!text.isEmpty()) {
            fields.put(key, text);
        }
        return this;
    }

    XelerGoTrace fieldIfAbsent(String key, Object value) {
        if (!fields.containsKey(key)) {
            field(key, value);
        }
        return this;
    }

    XelerGoTrace maskedAddress(String key, String address) {
        return field(key, maskAddress(address));
    }

    XelerGoTrace maskedIdentity(String key, String identity) {
        return field(key, maskIdentity(identity));
    }

    void log(Logger logger, XelerGoLogger.Level level) {
        log(logger, level, null);
    }

    void log(Logger logger, XelerGoLogger.Level level, Throwable error) {
        String transactionId = fields.get("transactionId");
        String remoteTransactionId = fields.get("remoteTransactionId");
        if (remoteTransactionId == null && transactionId != null) {
            fields.put("remoteTransactionId", transactionId);
        } else if (transactionId == null && remoteTransactionId != null) {
            fields.put("transactionId", remoteTransactionId);
        }

        String flow = normalizeFlow(fields.get("flow"));
        if (flow != null) {
            fields.put("flow", flow);
        }

        String result = normalizeResult(fields.get("result"));
        if (result != null) {
            fields.put("result", result);
        }

        if (error != null) {
            Throwable rootCause = XelerGoLogger.rootCause(error);
            fieldIfAbsent("exceptionClass", error.getClass().getName())
                .fieldIfAbsent("exceptionMessage", XelerGoLogger.messageOrClass(error))
                .fieldIfAbsent("rootCauseClass", rootCause == null ? null : rootCause.getClass().getName())
                .fieldIfAbsent("rootCauseMessage", XelerGoLogger.messageOrClass(rootCause));
        }

        StringBuilder builder = new StringBuilder("xelergo");
        for (Map.Entry<String, String> entry : fields.entrySet()) {
            builder.append(' ')
                .append(entry.getKey())
                .append('=')
                .append(entry.getValue());
        }
        XelerGoLogger.log(logger, level, builder.toString(), error);
    }

    static String firstNonBlank(String... values) {
        if (values == null) {
            return null;
        }
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return null;
    }

    static String correlationId(String remoteTransactionId, String localTransactionId, String orderId) {
        String value = firstNonBlank(remoteTransactionId, localTransactionId, orderId);
        return value == null ? "unavailable" : value;
    }

    static String reflectString(Object target, String methodName) {
        if (target == null || methodName == null || methodName.trim().isEmpty()) {
            return null;
        }
        try {
            Object value = target.getClass().getMethod(methodName).invoke(target);
            return value == null ? null : String.valueOf(value);
        } catch (ReflectiveOperationException ignored) {
            return null;
        }
    }

    static String maskAddress(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() <= 12) {
            return trimmed;
        }
        return trimmed.substring(0, 6) + "..." + trimmed.substring(trimmed.length() - 6);
    }

    static String maskIdentity(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() <= 8) {
            return trimmed;
        }
        return trimmed.substring(0, 4) + "..." + trimmed.substring(trimmed.length() - 4);
    }

    static String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        if (maxLength < 4) {
            return value.substring(0, maxLength);
        }
        return value.substring(0, maxLength - 3) + "...";
    }

    private static String normalizeFlow(String value) {
        if (value == null) {
            return null;
        }
        if ("SYSTEM".equalsIgnoreCase(value) || "UNKNOWN".equalsIgnoreCase(value)) {
            return "INIT";
        }
        return value.toUpperCase();
    }

    private static String normalizeResult(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim().toLowerCase();
        if (normalized.isEmpty()) {
            return null;
        }
        if ("enter".equals(normalized)
            || "ok".equals(normalized)
            || "reject".equals(normalized)
            || "error".equals(normalized)
            || "dispatch".equals(normalized)
            || "before_dispatch".equals(normalized)
            || "after_dispatch".equals(normalized)
            || "skip".equals(normalized)) {
            return normalized;
        }
        if (normalized.contains("dispatch")) {
            return "dispatch";
        }
        if (normalized.contains("reject") || "rejected".equals(normalized)) {
            return "reject";
        }
        if (normalized.contains("error")
            || normalized.contains("failed")
            || normalized.contains("failure")
            || normalized.contains("unmapped")) {
            return "error";
        }
        if (normalized.contains("skip")
            || normalized.contains("waiting")
            || normalized.contains("unsupported")
            || normalized.contains("missing")
            || normalized.contains("not_found")) {
            return "skip";
        }
        if (normalized.contains("start")
            || normalized.contains("prepare")
            || normalized.contains("resolve_start")
            || normalized.contains("load")) {
            return "enter";
        }
        if (normalized.contains("before")) {
            return "before_dispatch";
        }
        if (normalized.contains("after")) {
            return "after_dispatch";
        }
        return "ok";
    }
}
