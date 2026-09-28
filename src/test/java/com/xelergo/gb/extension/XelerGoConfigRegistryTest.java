package com.xelergo.gb.extension;

final class XelerGoConfigRegistryTest {
    private XelerGoConfigRegistryTest() {
    }

    static void run() {
        doesNotThrowWhenMultipleDistinctConfigsExist();
        doesNotFallbackToPrimaryWhenConfigKeyIsMissing();
        returnsNullWhenPrimaryConfigIsNotRegisteredYet();
        returnsShortestPollingAcrossRegisteredConfigs();
    }

    private static void doesNotThrowWhenMultipleDistinctConfigsExist() {
        XelerGoConfigRegistry registry = new XelerGoConfigRegistry();
        registry.register(XelerGoConfig.fromWalletLogin("xelergo:https:api.example.com:443::key-a"));
        registry.register(XelerGoConfig.fromWalletLogin("xelergo:https:api.other.com:443::key-b"));

        TestSupport.assertEquals(null, registry.requirePrimary(),
            "Con multiples configuraciones el registry no debe asumir una primary ni lanzar excepcion");
    }

    private static void doesNotFallbackToPrimaryWhenConfigKeyIsMissing() {
        XelerGoConfigRegistry registry = new XelerGoConfigRegistry();
        XelerGoConfig config = XelerGoConfig.fromWalletLogin("xelergo:https:api.example.com:443::key-a");
        registry.register(config);

        TestSupport.assertEquals(config, registry.getByKey(null), "null key should use single primary config");
        TestSupport.assertEquals(null, registry.getByKey("missing-key"), "missing configKey must not fallback to primary");
    }

    private static void returnsNullWhenPrimaryConfigIsNotRegisteredYet() {
        XelerGoConfigRegistry registry = new XelerGoConfigRegistry();
        TestSupport.assertEquals(null, registry.findPrimary(), "Debe devolver null mientras CAS aun no registro la wallet primaria");
    }

    private static void returnsShortestPollingAcrossRegisteredConfigs() {
        XelerGoConfigRegistry registry = new XelerGoConfigRegistry();
        registry.register(XelerGoConfig.fromWalletLogin("xelergo:https:api.one.example:443::key-a:5000:10000:terminalSerial::30:72"));
        registry.register(XelerGoConfig.fromWalletLogin("xelergo:https:api.two.example:443::key-b:5000:10000:terminalSerial::15:72"));

        TestSupport.assertEquals(Long.valueOf(15000L), Long.valueOf(registry.findShortestPollingMillis(45000L)),
            "El polling del sync debe usar el menor intervalo registrado y no depender de una primary lazy");
    }
}
