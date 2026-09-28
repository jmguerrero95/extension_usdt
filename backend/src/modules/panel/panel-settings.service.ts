import { AppError } from '../../app/errors/app-error';
import type { AppConfig } from '../../app/config/env';
import type { SystemSetting } from '../../domain/entities/system-setting.entity';
import type { SystemSettingRepository } from '../../domain/repositories/system-setting.repository';
import { decryptText, encryptText } from '../../infrastructure/crypto/encryption';
import { createAxiosClient } from '../../infrastructure/http/axios-factory';
import {
  CryptoCurrencyApiBadResponseError,
  CryptoCurrencyApiTimeoutError,
} from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.errors';
import { CryptoCurrencyApiClient } from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.client';
import { CryptoCurrencyApiService } from '../../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.service';
import { ItrxClient } from '../../infrastructure/providers/itrx/itrx.client';
import { ItrxBadResponseError, ItrxTimeoutError } from '../../infrastructure/providers/itrx/itrx.errors';
import { ItrxService } from '../../infrastructure/providers/itrx/itrx.service';
import {
  PANEL_SETTING_DEFINITIONS,
  applyPanelSettingToConfig,
  coercePanelSettingValue,
  getConfigValueForPanelSetting,
  getPanelSettingDefinition,
} from './panel-settings.catalog';

export class PanelSettingsService {
  public constructor(
    private readonly config: AppConfig,
    private readonly repository: SystemSettingRepository,
  ) {}

  public async listSettings() {
    const overrides = await this.repository.list();
const overridesMap = new Map(overrides.map((item) => [item.key, item]));

    return PANEL_SETTING_DEFINITIONS.map((definition) => {
      const currentValue = getConfigValueForPanelSetting(this.config, definition.key);
      const override = overridesMap.get(definition.key) ?? null;
      const overrideValue = override ? this.readSettingValue(override) : null;

      return {
        key: definition.key,
        label: definition.label,
        category: definition.category,
        description: definition.description,
        type: definition.type,
        isSecret: definition.isSecret,
        appliesOnRestart: definition.appliesOnRestart,
        configured: currentValue !== null,
        currentValueMasked: this.maskValue(definition.isSecret, currentValue),
        overrideValueMasked: this.maskValue(definition.isSecret, overrideValue),
        hasOverride: Boolean(override),
        effectiveSource: override ? 'database_override' : 'env',
        options: definition.options ?? null,
      };
    });
  }

  public async upsertSettings(
    items: Array<{
      key: string;
      value: string;
    }>,
    actor: {
      userId: string;
      email: string;
    },
  ) {
    const saved: SystemSetting[] = [];

    for (const item of items) {
      const definition = getPanelSettingDefinition(item.key);
      if (!definition) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: `La clave de configuración ${item.key} no está soportada en el panel.`,
        });
      }

      try {
        const coerced = coercePanelSettingValue(definition, item.value);
        saved.push(
          await this.repository.upsertByKey(item.key, {
            category: definition.category,
            description: definition.description,
            isSecret: definition.isSecret,
            valueEncrypted: definition.isSecret
              ? encryptText(this.config.panel.encryptionSecret, String(coerced))
              : null,
            valuePlain: definition.isSecret ? null : String(coerced),
            updatedByUserId: actor.userId,
            updatedByEmail: actor.email,
          }),
        );
      } catch (error) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: error instanceof Error ? error.message : 'Valor de configuración inválido.',
        });
      }
    }

    return saved.map((setting) => ({
      key: setting.key,
      category: setting.category,
      description: setting.description,
      isSecret: setting.isSecret,
      hasValue: Boolean(setting.valuePlain || setting.valueEncrypted),
      updatedAt: setting.updatedAt.toISOString(),
    }));
  }

  public async testConnection(input: {
    provider: 'cryptocurrencyapi' | 'itrx';
    items?: Array<{
      key: string;
      value: string;
    }>;
  }) {
    const effectiveConfig = await this.buildEffectiveConfig(input.items ?? []);

    if (input.provider === 'cryptocurrencyapi') {
      const service = new CryptoCurrencyApiService(
        new CryptoCurrencyApiClient(
          createAxiosClient(
            effectiveConfig.providers.cryptocurrencyapi.baseUrl,
            effectiveConfig.providers.cryptocurrencyapi.timeoutMs,
          ),
          effectiveConfig.providers.cryptocurrencyapi.apiKey,
        ),
        effectiveConfig,
      );

      try {
        await service.getRequestStatus({
          label: 'panel-connection-test',
        });

        return {
          provider: input.provider,
          ok: true,
          reachable: true,
          authenticated: true,
          message: 'CryptoCurrencyAPI respondio correctamente.',
        };
      } catch (error) {
        if (error instanceof CryptoCurrencyApiBadResponseError) {
          const status = this.extractStatusCode(error.details);
          const authenticated = status === null ? false : ![401, 403].includes(status);

          return {
            provider: input.provider,
            ok: authenticated,
            reachable: true,
            authenticated,
            message: authenticated
              ? 'CryptoCurrencyAPI respondio, aunque rechazo la validacion funcional.'
              : 'CryptoCurrencyAPI fue alcanzable pero rechazo las credenciales o la solicitud.',
            providerStatus: status,
          };
        }

        if (error instanceof CryptoCurrencyApiTimeoutError) {
          return {
            provider: input.provider,
            ok: false,
            reachable: false,
            authenticated: false,
            message: 'CryptoCurrencyAPI no respondio dentro del timeout configurado.',
          };
        }

        return {
          provider: input.provider,
          ok: false,
          reachable: false,
          authenticated: false,
          message: 'No fue posible comunicarse con CryptoCurrencyAPI.',
        };
      }
    }

    const service = new ItrxService(
      new ItrxClient(
        createAxiosClient(
          effectiveConfig.providers.itrx.baseUrl,
          effectiveConfig.providers.itrx.timeoutMs,
        ),
        effectiveConfig.providers.itrx.apiKey,
        effectiveConfig.providers.itrx.apiSecret,
      ),
      effectiveConfig,
    );

    try {
      await service.estimateEnergyForUsdtTransfer({
        toAddress: effectiveConfig.tron.forwardTargetAddress,
      });

      return {
        provider: input.provider,
        ok: true,
        reachable: true,
        authenticated: true,
        message: 'iTRX respondio correctamente.',
      };
    } catch (error) {
      if (error instanceof ItrxBadResponseError) {
        const status = this.extractStatusCode(error.details);
        const authenticated = status === null ? false : ![401, 403].includes(status);

        return {
          provider: input.provider,
          ok: authenticated,
          reachable: true,
          authenticated,
          message: authenticated
            ? 'iTRX respondio, aunque rechazo la validacion funcional.'
            : 'iTRX fue alcanzable pero rechazo las credenciales o la solicitud.',
          providerStatus: status,
        };
      }

      if (error instanceof ItrxTimeoutError) {
        return {
          provider: input.provider,
          ok: false,
          reachable: false,
          authenticated: false,
          message: 'iTRX no respondio dentro del timeout configurado.',
        };
      }

      return {
        provider: input.provider,
        ok: false,
        reachable: false,
        authenticated: false,
        message: 'No fue posible comunicarse con iTRX.',
      };
    }
  }

  public async applyRuntimeOverrides(config: AppConfig): Promise<void> {
    const overrides = await this.repository.list();
    for (const override of overrides) {
      const definition = getPanelSettingDefinition(override.key);
      if (!definition) {
        continue;
      }

      const rawValue = this.readSettingValue(override);
      if (rawValue === null) {
        continue;
      }

      applyPanelSettingToConfig(
        config,
        override.key,
        coercePanelSettingValue(definition, rawValue),
      );
    }
  }

  private async buildEffectiveConfig(
    items: Array<{
      key: string;
      value: string;
    }>,
  ): Promise<AppConfig> {
    const effectiveConfig = structuredClone(this.config);
    await this.applyRuntimeOverrides(effectiveConfig);

    for (const item of items) {
      const definition = getPanelSettingDefinition(item.key);
      if (!definition) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          message: `La clave de configuracion ${item.key} no esta soportada en el panel.`,
        });
      }

      applyPanelSettingToConfig(
        effectiveConfig,
        item.key,
        coercePanelSettingValue(definition, item.value),
      );
    }

    return effectiveConfig;
  }

  private extractStatusCode(details: unknown): number | null {
    if (
      details &&
      typeof details === 'object' &&
      'status' in details &&
      typeof (details as { status?: unknown }).status === 'number'
    ) {
      return (details as { status: number }).status;
    }

    return null;
  }

  private readSettingValue(setting: SystemSetting): string | null {
    if (setting.isSecret) {
      return setting.valueEncrypted
        ? decryptText(this.config.panel.encryptionSecret, setting.valueEncrypted)
        : null;
    }

    return setting.valuePlain;
  }

  private maskValue(
    isSecret: boolean,
    value: string | number | boolean | null,
  ): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (!isSecret) {
      return String(value);
    }

    const stringValue = String(value);
    return stringValue.length <= 6
      ? '******'
      : `${stringValue.slice(0, 2)}******${stringValue.slice(-2)}`;
  }
}
