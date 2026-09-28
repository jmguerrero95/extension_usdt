package com.generalbytes.batm.server.extensions;

import java.util.Set;

public interface IExtension {
    String getName();

    void init(IExtensionContext ctx);

    default void deinit() {
    }

    default IWallet createWallet(String walletLogin, String tunnelPassword) {
        return null;
    }

    default ICryptoAddressValidator createAddressValidator(String cryptoCurrency) {
        return null;
    }

    default Set<String> getSupportedCryptoCurrencies() {
        return null;
    }
}
