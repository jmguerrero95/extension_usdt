package com.generalbytes.batm.server.extensions;

import java.math.BigDecimal;

public interface ITransactionPreparation {
    int TYPE_BUY_CRYPTO = 0;
    int TYPE_SELL_CRYPTO = 1;

    int getType();

    String getTerminalSerialNumber();

    String getLocalTransactionId();

    String getCryptoCurrency();

    String getCashCurrency();

    BigDecimal getCashAmount();

    String getCryptoAddress();

    String getIdentityPublicId();

    String getErrorMessage();

    void setErrorMessage(String errorMessage);
}
