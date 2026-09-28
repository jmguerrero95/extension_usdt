package com.generalbytes.batm.server.extensions;

import java.math.BigDecimal;
import java.util.Set;

public interface IWallet {
    String getCryptoAddress(String cryptoCurrency);

    Set<String> getCryptoCurrencies();

    String getPreferredCryptoCurrency();

    BigDecimal getCryptoBalance(String cryptoCurrency);

    String sendCoins(String destinationAddress, BigDecimal amount, String cryptoCurrency, String description);
}
