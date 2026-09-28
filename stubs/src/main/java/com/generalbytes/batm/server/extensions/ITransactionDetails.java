package com.generalbytes.batm.server.extensions;

import java.util.Map;

public interface ITransactionDetails {
    int TYPE_BUY_CRYPTO = 0;
    int TYPE_SELL_CRYPTO = 1;

    int STATUS_BUY_IN_PROGRESS = 0;
    int STATUS_BUY_COMPLETED = 1;
    int STATUS_BUY_ERROR = 2;
    int STATUS_BUY_CANCELED = 3;

    int STATUS_SELL_PAYMENT_REQUESTED = 0;
    int STATUS_SELL_PAYMENT_ARRIVING = 1;
    int STATUS_SELL_ERROR = 2;
    int STATUS_SELL_PAYMENT_ARRIVED = 3;

    int getType();

    String getTerminalSerialNumber();

    String getRemoteTransactionId();

    int getStatus();

    int getErrorCode();

    java.math.BigDecimal getCashAmount();

    String getCashCurrency();

    java.math.BigDecimal getCryptoAmount();

    String getCryptoCurrency();

    String getCryptoAddress();

    String getDetail();

    boolean isWithdrawn();

    boolean canBeCashedOut();

    Map<String, String> getCustomData();
}
