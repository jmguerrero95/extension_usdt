package com.xelergo.gb.extension;

final class TerminalIdResolver {
    private TerminalIdResolver() {
    }

    static String resolve(XelerGoConfig config, String terminalSerialNumber) {
        if (config.getTerminalIdMode() == XelerGoConfig.TerminalIdMode.STATIC && config.getStaticTerminalId() != null) {
            return config.getStaticTerminalId();
        }
        if (terminalSerialNumber != null && !terminalSerialNumber.trim().isEmpty()) {
            return terminalSerialNumber.trim();
        }
        return config.getStaticTerminalId();
    }
}
