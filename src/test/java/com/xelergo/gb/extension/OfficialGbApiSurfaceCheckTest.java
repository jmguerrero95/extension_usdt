package com.xelergo.gb.extension;

import com.generalbytes.batm.server.extensions.AbstractExtension;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

final class OfficialGbApiSurfaceCheckTest {
    private OfficialGbApiSurfaceCheckTest() {
    }

    static void run() throws IOException {
        Path repoRoot = resolveRepoRoot();
        if (repoRoot == null) {
            if (Boolean.getBoolean("xelergo.requireOfficialApiSurfaceRepo")) {
                TestSupport.fail("No se encontro el repo oficial batm_public para ejecutar la verificacion de superficie API de GENERAL BYTES.");
            }
            System.out.println("Skipping GENERAL BYTES API surface check: official repository not found.");
            return;
        }

        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionListener.java",
            "default boolean isTransactionPreparationApproved(ITransactionPreparation preparation)");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionListener.java",
            "default ITransactionPreparation overrideTransactionPreparation(ITransactionPreparation preparation)");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionListener.java",
            "default ITransactionRequest overrideTransactionRequest(ITransactionRequest request)");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionPreparation.java",
            "String getLocalTransactionId();");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionListener.java",
            "default Map<String,String> onTransactionCreated(ITransactionDetails transactionDetails)");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionListener.java",
            "default Map<String,String> onTransactionUpdated(ITransactionDetails transactionDetails)");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionDetails.java",
            "boolean isWithdrawn();");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionDetails.java",
            "boolean canBeCashedOut();");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionDetails.java",
            "Map<String, String> getCustomData();");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionDetails.java",
            "String getNameOfCryptoSettingUsed();");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionDetails.java",
            "int STATUS_SELL_PAYMENT_ARRIVED  = 3;");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionDetails.java",
            "int STATUS_BUY_COMPLETED = 1;");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtensionContext.java",
            "ITransactionDetails updateTransaction(String rid, Integer status, String detail, Map<String, String> customData) throws UpdateException;");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtensionContext.java",
            "ITransactionDetails addTransactionHash(String transactionRemoteId, String transactionHash) throws UpdateException;");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtensionContext.java",
            "void addTask(String name, final ITask tt, final Runnable onFinish);");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtensionContext.java",
            "List<ITerminal> findAllTerminals();");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtensionContext.java",
            "List<ITransactionDetails> findTransactions(String terminalSerialNumber, Date serverTimeFrom, Date serverTimeTo, String previousRID, boolean includeBanknotes);");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtensionContext.java",
            "IWallet findBuyWallet(String terminalSerialNumber, String cryptoCurrency);");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtension.java",
            "void deinit();");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtension.java",
            "IExchange createExchange(String exchangeLogin);");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IExtension.java",
            "Set<IRestService> getRestServices();");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/AbstractExtension.java",
            "public abstract class AbstractExtension implements IExtension");
        assertFileContains(repoRoot, "server_extensions_template/src/main/java/com/mygreatcompany/batm/server/extensions/myfirstextension/MyFirstExtension.java",
            "extends AbstractExtension");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/ITransactionListener.java",
            "default boolean isTransactionApproved(ITransactionRequest transactionRequest)");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IGeneratesNewDepositCryptoAddress.java",
            "String generateNewDepositCryptoAddress(String cryptoCurrency, String label);");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IWallet.java",
            "String sendCoins(String destinationAddress, BigDecimal amount, String cryptoCurrency, String description);");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/IQueryableWallet.java",
            "ReceivedAmount getReceivedAmount(String address, String cryptoCurrency);");
        assertFileContains(repoRoot, "server_extensions_api/src/main/java/com/generalbytes/batm/server/extensions/payment/ReceivedAmount.java",
            "public class ReceivedAmount");
        assertFileContains(repoRoot, "server_extensions_template/src/main/resources/batm-extensions.xml",
            "<extension class=");
        TestSupport.assertTrue(
            AbstractExtension.class.equals(XelerGoExtension.class.getSuperclass()),
            "XelerGoExtension debe extender AbstractExtension para alinearse con el template oficial de GENERAL BYTES."
        );
    }

    private static Path resolveRepoRoot() {
        String configured = System.getenv("BATM_PUBLIC_REPO");
        if (configured != null && !configured.trim().isEmpty()) {
            Path configuredPath = Paths.get(configured.trim());
            if (Files.isDirectory(configuredPath)) {
                return configuredPath;
            }
        }

        Path defaultPath = Paths.get("..", "..", "batm_public_official").toAbsolutePath().normalize();
        if (Files.isDirectory(defaultPath)) {
            return defaultPath;
        }
        return null;
    }

    private static void assertFileContains(Path repoRoot, String relativePath, String expectedContent) throws IOException {
        Path file = repoRoot.resolve(relativePath);
        TestSupport.assertTrue(Files.exists(file), "Missing official file: " + relativePath);
        String content = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
        TestSupport.assertTrue(
            content.contains(expectedContent),
            "GB API surface mismatch in: " + relativePath + " expected snippet: " + expectedContent
        );
    }
}
