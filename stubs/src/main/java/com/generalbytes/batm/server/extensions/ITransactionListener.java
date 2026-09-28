package com.generalbytes.batm.server.extensions;

import java.util.Map;

public interface ITransactionListener {
    default boolean isTransactionPreparationApproved(ITransactionPreparation preparation) {
        return true;
    }

    default ITransactionPreparation overrideTransactionPreparation(ITransactionPreparation preparation) {
        return preparation;
    }

    default ITransactionRequest overrideTransactionRequest(ITransactionRequest request) {
        return request;
    }

    default boolean isTransactionApproved(ITransactionRequest transactionRequest) {
        return true;
    }

    default Map<String, String> onTransactionCreated(ITransactionDetails transactionDetails) {
        return null;
    }

    default Map<String, String> onTransactionUpdated(ITransactionDetails transactionDetails) {
        return null;
    }
}
