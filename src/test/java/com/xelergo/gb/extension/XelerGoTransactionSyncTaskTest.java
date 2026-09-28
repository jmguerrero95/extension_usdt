package com.xelergo.gb.extension;

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

final class XelerGoTransactionSyncTaskTest {
    private XelerGoTransactionSyncTaskTest() {
    }

    static void run() {
        usesDefaultPollingWhileConfigIsNotAvailable();
        skipsSyncStepCleanlyWhenTerminalWalletIsMissing();
        skipsLegacyTerminalWithoutAttemptingCasWalletLookup();
    }

    private static void usesDefaultPollingWhileConfigIsNotAvailable() {
        XelerGoTransactionSyncTask task = new XelerGoTransactionSyncTask(
            new MissingWalletContext("term-sync-missing"),
            new XelerGoConfigRegistry(),
            new XelerGoOrderLinkRegistry(),
            TestSupport.logger(XelerGoLogger.LOGGER_NAME)
        );

        TestSupport.assertEquals(Long.valueOf(15000L), Long.valueOf(task.getShortestTimeForNexStepInvocation()),
            "Debe usar polling por defecto mientras aun no exista config utilizable");
    }

    private static void skipsSyncStepCleanlyWhenTerminalWalletIsMissing() {
        MissingWalletContext ctx = new MissingWalletContext("term-sync-missing");
        XelerGoTransactionSyncTask task = new XelerGoTransactionSyncTask(
            ctx,
            new XelerGoConfigRegistry(),
            new XelerGoOrderLinkRegistry(),
            TestSupport.logger(XelerGoLogger.LOGGER_NAME)
        );

        TestSupport.assertTrue(!task.onDoStep(),
            "Sin wallet utilizable el task debe hacer skip limpio y continuar vivo");
        TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(ctx.findAllTerminalsCalls),
            "Aunque no haya config en memoria, el task debe consultar las terminales reales de CAS");
        TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(ctx.findBuyWalletCalls),
            "La resolucion de config del sync debe intentarse por terminal/CAS y no via primary lazy");
    }

    private static void skipsLegacyTerminalWithoutAttemptingCasWalletLookup() {
        MissingWalletContext ctx = new MissingWalletContext("BT300055_OLD2");
        XelerGoTransactionSyncTask task = new XelerGoTransactionSyncTask(
            ctx,
            new XelerGoConfigRegistry(),
            new XelerGoOrderLinkRegistry(),
            TestSupport.logger(XelerGoLogger.LOGGER_NAME)
        );

        TestSupport.assertTrue(!task.onDoStep(),
            "Una terminal legacy/OLD debe ser ignorada por el sync sin romper el task.");
        TestSupport.assertEquals(Integer.valueOf(1), Integer.valueOf(ctx.findAllTerminalsCalls),
            "El sync igual debe recorrer las terminales devueltas por CAS.");
        TestSupport.assertEquals(Integer.valueOf(0), Integer.valueOf(ctx.findBuyWalletCalls),
            "Una terminal _OLD no debe disparar lookup de wallet en CAS.");
    }

    private static final class MissingWalletContext implements IExtensionContext {
        private final String terminalSerialNumber;
        private int findAllTerminalsCalls;
        private int findBuyWalletCalls;

        private MissingWalletContext(String terminalSerialNumber) {
            this.terminalSerialNumber = terminalSerialNumber;
        }

        @Override
        public void addTransactionListener(ITransactionListener listener) {
        }

        @Override
        public void addTask(String name, ITask task, Runnable onFinish) {
        }

        @Override
        public List<ITerminal> findAllTerminals() {
            findAllTerminalsCalls++;
            return Collections.<ITerminal>singletonList(new TestTerminal(terminalSerialNumber));
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
            return null;
        }
    }

    private static final class TestTerminal implements ITerminal {
        private final String serialNumber;

        private TestTerminal(String serialNumber) {
            this.serialNumber = serialNumber;
        }

        @Override
        public String getSerialNumber() {
            return serialNumber;
        }
    }
}
