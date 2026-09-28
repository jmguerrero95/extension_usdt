package com.xelergo.gb.extension;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class XelerGoConfigRegistry {
    private static final Logger LOG = LoggerFactory.getLogger(XelerGoLogger.LOGGER_NAME);

    private final Map<String, XelerGoConfig> configs = new ConcurrentHashMap<String, XelerGoConfig>();
    private volatile XelerGoConfig primary;

    void register(XelerGoConfig config) {
        if (config == null) {
            XelerGoTrace.create()
                .field("flow", "INIT")
                .field("stage", "config_registry_register")
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_INVALID_WALLET_LOGIN)
                .field("failureReason", "Se intento registrar una configuracion nula en el registry.")
                .field("result", "error")
                .log(LOG, XelerGoLogger.Level.ERROR);
            return;
        }

        XelerGoConfig previous = configs.put(config.getConfigKey(), config);
        primary = config;
        XelerGoTrace.create()
            .field("flow", "INIT")
            .field("stage", "config_registry_register")
            .field("backendBaseUrl", config.getBaseUrl())
            .field("terminalIdMode", config.getTerminalIdMode())
            .field("configKey", config.getConfigKey())
            .field("registrySize", configs.size())
            .field("result", previous == null ? "ok" : "reuse")
            .log(LOG, previous == null ? XelerGoLogger.Level.INFO : XelerGoLogger.Level.DEBUG);
    }

    XelerGoConfig findByKey(String configKey) {
        if (configKey == null) {
            XelerGoTrace.create()
                .field("flow", "INIT")
                .field("stage", "config_registry_find_by_key")
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_PRIMARY_NOT_REGISTERED)
                .field("failureReason", "No se proporciono configKey al consultar el registry.")
                .field("result", "skip")
                .log(LOG, XelerGoLogger.Level.DEBUG);
            return null;
        }

        XelerGoConfig config = configs.get(configKey);
        XelerGoTrace.create()
            .field("flow", "INIT")
            .field("stage", "config_registry_find_by_key")
            .field("configKey", configKey)
            .field("backendBaseUrl", config == null ? null : config.getBaseUrl())
            .field("result", config == null ? "skip" : "ok")
            .log(LOG, config == null ? XelerGoLogger.Level.DEBUG : XelerGoLogger.Level.INFO);
        return config;
    }

    XelerGoConfig findPrimary() {
        if (configs.isEmpty()) {
            XelerGoTrace.create()
                .field("flow", "INIT")
                .field("stage", "config_registry_find_primary")
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_PRIMARY_NOT_REGISTERED)
                .field("failureReason", "Todavia no existe ninguna configuracion XelerGo registrada en memoria.")
                .field("registrySize", configs.size())
                .field("result", "skip")
                .log(LOG, XelerGoLogger.Level.DEBUG);
            return null;
        }
        if (configs.size() > 1) {
            XelerGoTrace.create()
                .field("flow", "INIT")
                .field("stage", "config_registry_find_primary")
                .field("registrySize", configs.size())
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_REGISTRY_AMBIGUOUS)
                .field("failureReason", "Hay multiples configuraciones XelerGo registradas; no existe una primary confiable.")
                .field("result", "skip")
                .log(LOG, XelerGoLogger.Level.DEBUG);
            return null;
        }

        XelerGoConfig resolved = primary;
        if (resolved == null) {
            for (XelerGoConfig candidate : configs.values()) {
                resolved = candidate;
                break;
            }
            primary = resolved;
        }
        if (resolved == null) {
            XelerGoTrace.create()
                .field("flow", "INIT")
                .field("stage", "config_registry_find_primary")
                .field("failureClass", XelerGoFailure.CONFIG)
                .field("failureCode", XelerGoFailure.CONFIG_PRIMARY_NOT_REGISTERED)
                .field("failureReason", "El registry contiene entradas, pero no fue posible resolver una configuracion unica.")
                .field("registrySize", configs.size())
                .field("result", "skip")
                .log(LOG, XelerGoLogger.Level.DEBUG);
            return null;
        }

        XelerGoTrace.create()
            .field("flow", "INIT")
            .field("stage", "config_registry_find_primary")
            .field("backendBaseUrl", resolved.getBaseUrl())
            .field("configKey", resolved.getConfigKey())
            .field("registrySize", configs.size())
            .field("result", "ok")
            .log(LOG, XelerGoLogger.Level.DEBUG);
        return resolved;
    }

    XelerGoConfig findLatest() {
        if (primary == null && configs.size() == 1) {
            return findPrimary();
        }
        return primary;
    }

    boolean hasMultipleConfigurations() {
        return configs.size() > 1;
    }

    XelerGoConfig getByKey(String configKey) {
        if (configKey == null) {
            return findPrimary();
        }
        return findByKey(configKey);
    }

    XelerGoConfig requirePrimary() {
        return findPrimary();
    }

    long findShortestPollingMillis(long defaultValue) {
        long shortest = defaultValue;
        boolean found = false;
        for (XelerGoConfig config : configs.values()) {
            if (config == null) {
                continue;
            }
            long candidate = config.getPollingSeconds() * 1000L;
            if (!found || candidate < shortest) {
                shortest = candidate;
                found = true;
            }
        }
        return found ? shortest : defaultValue;
    }

    int size() {
        return configs.size();
    }
}
