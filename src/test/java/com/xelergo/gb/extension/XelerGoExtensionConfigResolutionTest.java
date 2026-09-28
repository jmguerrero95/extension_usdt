package com.xelergo.gb.extension;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;

import com.generalbytes.batm.server.extensions.IExtensionContext;
import com.generalbytes.batm.server.extensions.ITask;
import com.generalbytes.batm.server.extensions.ITerminal;
import com.generalbytes.batm.server.extensions.ITransactionDetails;
import com.generalbytes.batm.server.extensions.ITransactionListener;
import com.generalbytes.batm.server.extensions.IWallet;
import com.generalbytes.batm.server.extensions.exceptions.UpdateException;

final class XelerGoExtensionConfigResolutionTest {
    private XelerGoExtensionConfigResolutionTest() {
    }

    static void run() throws Exception {
        resolvesConfigFromCasWalletWhenPrimaryConfigIsMissing();
        resolvesConfigFromCasWalletWhenRegistryIsAmbiguous();
        resolvesConfigFromCasWalletEvenWhenSingleRegistryConfigExistsForAnotherTerminal();
    }

    private static void resolvesConfigFromCasWalletWhenPrimaryConfigIsMissing() throws Exception {
        resetExtensionRegistry();

        XelerGoConfig config = XelerGoConfig.fromWalletLogin("xelergo:https:api.example.com:443::key-a");
        XelerGoWallet wallet = new XelerGoWallet(
            config,
            new XelerGoConfigRegistry(),
            new XelerGoOrderLinkRegistry(),
            TestSupport.logger("test.xelergo.config-resolution")
        );
        FakeExtensionContext ctx = new FakeExtensionContext(wallet);
        XelerGoExtension extension = new XelerGoExtension();
        extension.init(ctx);

        Method method = XelerGoExtension.class.getDeclaredMethod("resolveConfigForTerminal", String.class);
        method.setAccessible(true);
        XelerGoConfig resolved = (XelerGoConfig) method.invoke(extension, "terminal-001");

        TestSupport.assertEquals(config.getConfigKey(), resolved.getConfigKey(),
            "Debe resolver la misma configuracion publicada por la wallet en CAS");
        TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(ctx.findBuyWalletCalls),
            "Debe consultar la wallet en CAS cuando CONFIGS aun no tenga primaria");
    }

    private static void resolvesConfigFromCasWalletWhenRegistryIsAmbiguous() throws Exception {
        resetExtensionRegistry();

        Field configsField = XelerGoExtension.class.getDeclaredField("CONFIGS");
        configsField.setAccessible(true);
        XelerGoConfigRegistry extensionRegistry = (XelerGoConfigRegistry) configsField.get(null);
        extensionRegistry.register(XelerGoConfig.fromWalletLogin("xelergo:https:api.one.example:443::key-one"));
        extensionRegistry.register(XelerGoConfig.fromWalletLogin("xelergo:https:api.two.example:443::key-two"));

        XelerGoConfig terminalConfig = XelerGoConfig.fromWalletLogin("xelergo:https:api.terminal.example:443::key-terminal");
        XelerGoWallet wallet = new XelerGoWallet(
            terminalConfig,
            new XelerGoConfigRegistry(),
            new XelerGoOrderLinkRegistry(),
            TestSupport.logger("test.xelergo.config-resolution")
        );
        FakeExtensionContext ctx = new FakeExtensionContext(wallet);
        XelerGoExtension extension = new XelerGoExtension();
        extension.init(ctx);

        Method method = XelerGoExtension.class.getDeclaredMethod("resolveConfigForTerminal", String.class);
        method.setAccessible(true);
        XelerGoConfig resolved = (XelerGoConfig) method.invoke(extension, "terminal-ambiguous");

        TestSupport.assertEquals(terminalConfig.getConfigKey(), resolved.getConfigKey(),
            "Con registro ambiguo debe resolver la config real desde la wallet de CAS para la terminal");
        TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(ctx.findBuyWalletCalls),
            "Debe consultar a CAS para evitar asumir una primaria incorrecta");
    }

    private static void resolvesConfigFromCasWalletEvenWhenSingleRegistryConfigExistsForAnotherTerminal() throws Exception {
        resetExtensionRegistry();

        Field configsField = XelerGoExtension.class.getDeclaredField("CONFIGS");
        configsField.setAccessible(true);
        XelerGoConfigRegistry extensionRegistry = (XelerGoConfigRegistry) configsField.get(null);
        extensionRegistry.register(XelerGoConfig.fromWalletLogin("xelergo:https:api.cached.example:443::key-cached"));

        XelerGoConfig terminalConfig = XelerGoConfig.fromWalletLogin("xelergo:https:api.real-terminal.example:443::key-terminal");
        XelerGoWallet wallet = new XelerGoWallet(
            terminalConfig,
            new XelerGoConfigRegistry(),
            new XelerGoOrderLinkRegistry(),
            TestSupport.logger("test.xelergo.config-resolution")
        );
        FakeExtensionContext ctx = new FakeExtensionContext(wallet);
        XelerGoExtension extension = new XelerGoExtension();
        extension.init(ctx);

        Method method = XelerGoExtension.class.getDeclaredMethod("resolveConfigForTerminal", String.class);
        method.setAccessible(true);
        XelerGoConfig resolved = (XelerGoConfig) method.invoke(extension, "terminal-real");

        TestSupport.assertEquals(terminalConfig.getConfigKey(), resolved.getConfigKey(),
            "La extension no debe reutilizar una single primary cacheada si la terminal real en CAS apunta a otra config");
        TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(ctx.findBuyWalletCalls),
            "Incluso con una sola config cacheada debe consultar a CAS para resolver por terminal");
    }

    private static void resetExtensionRegistry() throws Exception {
        Field configsField = XelerGoExtension.class.getDeclaredField("CONFIGS");
        configsField.setAccessible(true);
        Object registry = configsField.get(null);

        Field mapField = XelerGoConfigRegistry.class.getDeclaredField("configs");
        mapField.setAccessible(true);
        ((Map<?, ?>) mapField.get(registry)).clear();

        Field primaryField = XelerGoConfigRegistry.class.getDeclaredField("primary");
        primaryField.setAccessible(true);
        primaryField.set(registry, null);
    }

    private static final class FakeExtensionContext implements IExtensionContext {
        private final IWallet wallet;
        private int findBuyWalletCalls;

        private FakeExtensionContext(IWallet wallet) {
            this.wallet = wallet;
        }

        @Override
        public void addTransactionListener(ITransactionListener listener) {
        }

        @Override
        public void addTask(String name, ITask task, Runnable onFinish) {
        }

        @Override
        public List<ITerminal> findAllTerminals() {
            return Collections.emptyList();
        }

        @Override
        public List<ITransactionDetails> findTransactions(
            String terminalSerialNumber,
            Date serverTimeFrom,
            Date serverTimeTo,
            String previousRID,
            boolean includeBanknotes
        ) {
            return Collections.emptyList();
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail) throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails updateTransaction(String rid, Integer status, String detail, Map<String, String> customData)
            throws UpdateException {
            return null;
        }

        @Override
        public ITransactionDetails addTransactionHash(String transactionRemoteId, String transactionHash) throws UpdateException {
            return null;
        }

        @Override
        public String getConfigProperty(String fileNameInConfigDirectory, String key, String defaultValue) {
            return defaultValue;
        }

        @Override
        public IWallet findBuyWallet(String terminalSerialNumber, String cryptoCurrency) {
            findBuyWalletCalls++;
            return wallet;
        }
    }
}
