package com.generalbytes.batm.server.extensions;

public interface ICryptoAddressValidator {
    boolean isAddressValid(String address);

    boolean isPaperWalletSupported();

    boolean mustBeBase58Address();
}
