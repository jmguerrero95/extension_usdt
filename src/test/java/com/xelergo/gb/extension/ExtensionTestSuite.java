package com.xelergo.gb.extension;

public class ExtensionTestSuite {
    public static void main(String[] args) throws Exception {
        XelerGoConfigTest.run();
        XelerGoConfigRegistryTest.run();
        TronAddressValidatorTest.run();
        XelerGoTransactionSyncTaskTest.run();
        XelerGoExtensionConfigResolutionTest.run();
        XelerGoExtensionCashierFlowTest.run();
        XelerGoObservabilityLoggingTest.run();
        XelerGoStatusMapperTest.run();
        XelerGoApiExceptionTest.run();
        XelerGoExtensionLifecycleTest.run();
        XelerGoApiClientTest.run();
        OfficialGbApiSurfaceCheckTest.run();
        System.out.println("All extension tests passed.");
    }
}
