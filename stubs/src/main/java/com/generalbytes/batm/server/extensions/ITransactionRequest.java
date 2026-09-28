package com.generalbytes.batm.server.extensions;

import java.math.BigDecimal;

public interface ITransactionRequest {
    int TYPE_BUY_CRYPTO = 0;
    int TYPE_SELL_CRYPTO = 1;

    int getType();

    String getTerminalSerialNumber();

    String getRemoteTransactionId();

    BigDecimal getCashAmount();

    String getCashCurrency();

    BigDecimal getCryptoAmount();

    String getCryptoCurrency();

    String getCryptoAddress();

    String getErrorMessage();

    void setErrorMessage(String errorMessage);
}
