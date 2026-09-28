package com.xelergo.gb.extension;

import java.util.Locale;
import java.util.regex.Pattern;

final class XelerGoTerminalSerials {
    private static final Pattern LEGACY_SERIAL_PATTERN = Pattern.compile(".*_OLD\\d*$", Pattern.CASE_INSENSITIVE);

    private XelerGoTerminalSerials() {
    }

    static String invalidReasonForCasLookup(String terminalSerialNumber) {
        String serial = trimToNull(terminalSerialNumber);
        if (serial == null) {
            return "terminalSerialNumber no puede estar vacio para resolver config via CAS.";
        }
        if (LEGACY_SERIAL_PATTERN.matcher(serial).matches()) {
            return "terminalSerialNumber corresponde a un alias legacy/OLD y no debe usarse para lookup de wallet en CAS.";
        }
        return null;
    }

    static boolean isFrameworkInvalidSerial(Throwable error) {
        String message = frameworkInvalidSerialMessage(error);
        return message != null;
    }

    static String frameworkInvalidSerialMessage(Throwable error) {
        Throwable root = XelerGoLogger.rootCause(error);
        String message = root == null ? null : root.getMessage();
        if (message == null) {
            return null;
        }
        String normalized = message.toLowerCase(Locale.US);
        if (normalized.contains("invalid terminal serial number")) {
            return message;
        }
        return null;
    }

    static String trimToNull(String value) {
        return value == null || value.trim().isEmpty() ? null : value.trim();
    }
}
