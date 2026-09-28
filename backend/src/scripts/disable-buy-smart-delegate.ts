import 'dotenv/config';

import { loadConfig } from '../app/config/env';
import { createAxiosClient } from '../infrastructure/http/axios-factory';
import { ItrxClient } from '../infrastructure/providers/itrx/itrx.client';
import { ItrxService } from '../infrastructure/providers/itrx/itrx.service';

const readNpmOriginalArgs = (): string[] => {
  const raw = process.env['npm_config_argv'];
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as { original?: unknown };
    return Array.isArray(parsed.original)
      ? parsed.original.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
};

const cliArgs = [...process.argv.slice(2), ...readNpmOriginalArgs()];
const hasFlag = (name: string): boolean => {
  const npmConfigValue = process.env[`npm_config_${name.replace(/^--/, '')}`];
  return (
    cliArgs.includes(name) ||
    npmConfigValue === 'true' ||
    (typeof npmConfigValue === 'string' && npmConfigValue.trim() === '')
  );
};

export const main = async (): Promise<void> => {
  const apply = hasFlag('--apply');
  const dryRun = hasFlag('--dry-run') || !apply;
  const config = loadConfig();
  const itrxService = new ItrxService(
    new ItrxClient(
      createAxiosClient(config.providers.itrx.baseUrl, config.providers.itrx.timeoutMs),
      config.providers.itrx.apiKey,
      config.providers.itrx.apiSecret,
    ),
    config,
  );

  const response = await itrxService.querySmartDelegatePolicy({
    receiveAddress: config.tron.buySenderAddress,
  });
  const policies = response.results.filter(
    (policy) => policy.receiveAddress === config.tron.buySenderAddress,
  );
  const activePolicies = policies.filter((policy) => policy.status === 1 && policy.id !== null);

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? 'dry-run' : 'apply',
        receiveAddress: config.tron.buySenderAddress,
        policies: policies.map((policy) => ({
          id: policy.id,
          status: policy.status,
          maxEnergy: policy.maxEnergy,
          active: policy.status === 1,
        })),
        pendingDisableCount: activePolicies.length,
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    return;
  }

  const disabled = [];
  for (const policy of activePolicies) {
    const result = await itrxService.changeSmartDelegatePolicyStatus({
      id: policy.id as number,
      status: 0,
    });
    disabled.push({
      id: policy.id,
      errno: result.errno,
      message: result.message,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: 'apply',
        disabled,
        pendingDisableCount: disabled.length,
      },
      null,
      2,
    ),
  );
};

if ((process.argv[1] ?? '').includes('disable-buy-smart-delegate')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
