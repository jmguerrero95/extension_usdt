package com.generalbytes.batm.server.extensions;

import com.generalbytes.batm.server.extensions.payment.ReceivedAmount;

public interface IQueryableWallet {
    ReceivedAmount getReceivedAmount(String address, String cryptoCurrency);
}
