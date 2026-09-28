package com.generalbytes.batm.server.extensions.payment;

import java.math.BigDecimal;
import java.util.List;

public class ReceivedAmount {
    public static final ReceivedAmount ZERO = new ReceivedAmount(BigDecimal.ZERO, 0);

    private final BigDecimal totalAmountReceived;
    private final int confirmations;
    private List<String> transactionHashes;

    public ReceivedAmount(BigDecimal totalAmountReceived, int confirmations) {
        this.totalAmountReceived = totalAmountReceived;
        this.confirmations = confirmations;
    }

    public BigDecimal getTotalAmountReceived() {
        return totalAmountReceived;
    }

    public int getConfirmations() {
        return confirmations;
    }

    public List<String> getTransactionHashes() {
        return transactionHashes;
    }

    public void setTransactionHashes(List<String> transactionHashes) {
        this.transactionHashes = transactionHashes;
    }
}
