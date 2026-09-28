package com.generalbytes.batm.server.extensions;

public interface IGeneratesNewDepositCryptoAddress {
    String generateNewDepositCryptoAddress(String cryptoCurrency, String label);
}
