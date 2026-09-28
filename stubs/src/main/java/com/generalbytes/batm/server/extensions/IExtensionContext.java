package com.generalbytes.batm.server.extensions;

import java.util.Date;
import java.util.List;
import java.util.Map;

import com.generalbytes.batm.server.extensions.exceptions.UpdateException;

public interface IExtensionContext {
    void addTransactionListener(ITransactionListener listener);

    void addTask(String name, ITask task, Runnable onFinish);

    List<ITerminal> findAllTerminals();

    List<ITransactionDetails> findTransactions(
        String terminalSerialNumber,
        Date serverTimeFrom,
        Date serverTimeTo,
        String previousRID,
        boolean includeBanknotes
    );

    ITransactionDetails updateTransaction(String rid, Integer status, String detail) throws UpdateException;

    ITransactionDetails updateTransaction(String rid, Integer status, String detail, Map<String, String> customData) throws UpdateException;

    ITransactionDetails addTransactionHash(String transactionRemoteId, String transactionHash) throws UpdateException;

    String getConfigProperty(String fileNameInConfigDirectory, String key, String defaultValue);

    IWallet findBuyWallet(String terminalSerialNumber, String cryptoCurrency);
}
