package com.generalbytes.batm.server.extensions;

import java.util.Set;

public abstract class AbstractExtension implements IExtension {
    protected IExtensionContext ctx;

    @Override
    public void init(IExtensionContext ctx) {
        this.ctx = ctx;
    }

    @Override
    public Set<String> getSupportedCryptoCurrencies() {
        return null;
    }
}
