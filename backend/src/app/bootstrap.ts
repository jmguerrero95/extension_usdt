import type { FastifyBaseLogger } from 'fastify';
import mongoose from 'mongoose';

import { loadConfig, type AppConfig } from './config/env';
import { createBootContext } from './boot-context';
import { createApp } from './app';
import { createLogger } from '../infrastructure/logger/pino';
import { connectToDatabase, disconnectFromDatabase } from '../infrastructure/db/connection';
import { createAxiosClient } from '../infrastructure/http/axios-factory';
import { TronService } from '../infrastructure/blockchain/tron.service';
import { CryptoCurrencyApiClient } from '../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.client';
import { CryptoCurrencyApiService } from '../infrastructure/providers/cryptocurrencyapi/cryptocurrencyapi.service';
import { ItrxClient } from '../infrastructure/providers/itrx/itrx.client';
import { ItrxService } from '../infrastructure/providers/itrx/itrx.service';
import { MongoOrderRepository } from '../infrastructure/db/repositories/order.mongo-repository';
import { MongoProviderEventRepository } from '../infrastructure/db/repositories/provider-event.mongo-repository';
import { MongoEnergyRequestRepository } from '../infrastructure/db/repositories/energy-request.mongo-repository';
import { MongoForwardRequestRepository } from '../infrastructure/db/repositories/forward-request.mongo-repository';
import { MongoSendRequestRepository } from '../infrastructure/db/repositories/send-request.mongo-repository';
import { MongoOrderStateTransitionRepository } from '../infrastructure/db/repositories/order-state-transition.mongo-repository';
import { MongoOutboxJobRepository } from '../infrastructure/db/repositories/outbox-job.mongo-repository';
import { MongoInternalUserRepository } from '../infrastructure/db/repositories/internal-user.mongo-repository';
import { MongoAdminSessionRepository } from '../infrastructure/db/repositories/admin-session.mongo-repository';
import { MongoAdminAuditLogRepository } from '../infrastructure/db/repositories/admin-audit-log.mongo-repository';
import { MongoOrderNoteRepository } from '../infrastructure/db/repositories/order-note.mongo-repository';
import { MongoSystemSettingRepository } from '../infrastructure/db/repositories/system-setting.mongo-repository';
import { MongoLockService } from '../infrastructure/locks/mongo-lock.service';
import { OutboxService } from '../infrastructure/queue/outbox.service';
import { AuditService } from '../modules/audit/audit.service';
import { PasswordService } from '../modules/auth/password.service';
import { TotpService } from '../modules/auth/totp.service';
import { OrdersService } from '../modules/orders/orders.service';
import { EnergyService } from '../modules/energy/energy.service';
import { ForwardsService } from '../modules/forwards/forwards.service';
import { ProviderEventsService } from '../modules/provider-events/provider-events.service';
import { ReconciliationService } from '../modules/reconciliation/reconciliation.service';
import { AdminAuditService } from '../modules/panel/admin-audit.service';
import { PanelAuthService } from '../modules/panel/panel-auth.service';
import { PanelUsersService } from '../modules/panel/panel-users.service';
import { PanelSettingsService } from '../modules/panel/panel-settings.service';
import { PanelConsoleService } from '../modules/panel/panel-console.service';
import { StorageMaintenanceService } from '../modules/admin/storage-maintenance.service';
import { MongoScheduler } from '../jobs/scheduler';
import { ExternalEffectGuard } from '../jobs/external-effect-guard';
import { OrderModel } from '../infrastructure/db/models/order.model';
import { ProviderEventModel } from '../infrastructure/db/models/provider-event.model';
import { EnergyRequestModel } from '../infrastructure/db/models/energy-request.model';
import { ForwardRequestModel } from '../infrastructure/db/models/forward-request.model';
import { SendRequestModel } from '../infrastructure/db/models/send-request.model';
import { OrderStateTransitionModel } from '../infrastructure/db/models/order-state-transition.model';
import { OutboxJobModel } from '../infrastructure/db/models/outbox-job.model';
import { DistributedLockModel } from '../infrastructure/db/models/distributed-lock.model';
import { InternalUserModel } from '../infrastructure/db/models/internal-user.model';
import { AdminSessionModel } from '../infrastructure/db/models/admin-session.model';
import { AdminAuditLogModel } from '../infrastructure/db/models/admin-audit-log.model';
import { OrderNoteModel } from '../infrastructure/db/models/order-note.model';
import { SystemSettingModel } from '../infrastructure/db/models/system-setting.model';
import {
  ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME,
  planOrderDepositObservedTxidIndexMigration,
} from '../infrastructure/db/indexes/order-deposit-observed-txid-index';

export interface ApplicationServices {
  auditService: AuditService;
  adminAuditService: AdminAuditService;
  ordersService: OrdersService;
  energyService: EnergyService;
  forwardsService: ForwardsService;
  providerEventsService: ProviderEventsService;
  reconciliationService: ReconciliationService;
  panelAuthService: PanelAuthService;
  panelUsersService: PanelUsersService;
  panelSettingsService: PanelSettingsService;
  panelConsoleService: PanelConsoleService;
  storageMaintenanceService: StorageMaintenanceService;
  scheduler: MongoScheduler;
  repositories: {
    orderRepository: MongoOrderRepository;
    providerEventRepository: MongoProviderEventRepository;
    energyRequestRepository: MongoEnergyRequestRepository;
    forwardRequestRepository: MongoForwardRequestRepository;
    sendRequestRepository: MongoSendRequestRepository;
    orderStateTransitionRepository: MongoOrderStateTransitionRepository;
    outboxJobRepository: MongoOutboxJobRepository;
    internalUserRepository: MongoInternalUserRepository;
    adminSessionRepository: MongoAdminSessionRepository;
    adminAuditLogRepository: MongoAdminAuditLogRepository;
    orderNoteRepository: MongoOrderNoteRepository;
    systemSettingRepository: MongoSystemSettingRepository;
  };
  providers: {
    cryptoCurrencyApiService: CryptoCurrencyApiService;
    itrxService: ItrxService;
  };
}

export interface BootstrapOptions {
  config?: AppConfig;
  logger?: FastifyBaseLogger;
  connectDb?: boolean;
  startScheduler?: boolean;
}

export const bootstrapApplication = async (options: BootstrapOptions = {}) => {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config);
  const bootContext = createBootContext();

  if (options.connectDb !== false) {
    await connectToDatabase(config);
    const database = mongoose.connection.db as NonNullable<typeof mongoose.connection.db>;
    const ordersCollectionExists =
      (await database
        .listCollections({ name: OrderModel.collection.collectionName }, { nameOnly: true })
        .toArray()).length > 0;

    if (ordersCollectionExists) {
      const orderDepositIndexPlan = await planOrderDepositObservedTxidIndexMigration(
        OrderModel.collection,
      );
      if (orderDepositIndexPlan.duplicates.length > 0) {
        throw new Error(
          `No se pudo iniciar porque existen ${orderDepositIndexPlan.duplicates.length} depositObservedTxid duplicados. Ejecuta npm run orders:migrate-deposit-index -- --dry-run y resuelve los conflictos antes de arrancar.`,
        );
      }

      if (orderDepositIndexPlan.incompatibleIndexNames.length > 0) {
        throw new Error(
          `No se pudo iniciar porque la coleccion orders tiene indices incompatibles sobre depositObservedTxid. Ejecuta npm run orders:migrate-deposit-index -- --dry-run y luego npm run orders:migrate-deposit-index -- --apply para crear ${ORDER_DEPOSIT_OBSERVED_TXID_INDEX_NAME}.`,
        );
      }
    }

    await Promise.all([
      OrderModel.init(),
      ProviderEventModel.init(),
      EnergyRequestModel.init(),
      ForwardRequestModel.init(),
      SendRequestModel.init(),
      OrderStateTransitionModel.init(),
      OutboxJobModel.init(),
      DistributedLockModel.init(),
      InternalUserModel.init(),
      AdminSessionModel.init(),
      AdminAuditLogModel.init(),
      OrderNoteModel.init(),
      SystemSettingModel.init(),
    ]);
  }

  const orderRepository = new MongoOrderRepository();
  const providerEventRepository = new MongoProviderEventRepository();
  const energyRequestRepository = new MongoEnergyRequestRepository();
  const forwardRequestRepository = new MongoForwardRequestRepository();
  const sendRequestRepository = new MongoSendRequestRepository();
  const orderStateTransitionRepository = new MongoOrderStateTransitionRepository();
  const outboxJobRepository = new MongoOutboxJobRepository();
  const internalUserRepository = new MongoInternalUserRepository();
  const adminSessionRepository = new MongoAdminSessionRepository();
  const adminAuditLogRepository = new MongoAdminAuditLogRepository();
  const orderNoteRepository = new MongoOrderNoteRepository();
  const systemSettingRepository = new MongoSystemSettingRepository();
  const lockService = new MongoLockService(config.locks.ttlSec);
  const outboxService = new OutboxService(outboxJobRepository, bootContext);
  const passwordService = new PasswordService();
  const totpService = new TotpService(config.panel.totpIssuer);
  const panelSettingsService = new PanelSettingsService(config, systemSettingRepository);

  await panelSettingsService.applyRuntimeOverrides(config);

  const cryptoCurrencyApiService = new CryptoCurrencyApiService(
    new CryptoCurrencyApiClient(
      createAxiosClient(
        config.providers.cryptocurrencyapi.baseUrl,
        config.providers.cryptocurrencyapi.timeoutMs,
      ),
      config.providers.cryptocurrencyapi.apiKey,
    ),
    config,
  );

  const tronService = new TronService(
    createAxiosClient(
      TronService.baseUrl,
      config.providers.cryptocurrencyapi.timeoutMs,
    ),
  );

  const itrxService = new ItrxService(
    new ItrxClient(
      createAxiosClient(config.providers.itrx.baseUrl, config.providers.itrx.timeoutMs),
      config.providers.itrx.apiKey,
      config.providers.itrx.apiSecret,
    ),
    config,
  );

  const auditService = new AuditService(orderStateTransitionRepository, providerEventRepository);
  const adminAuditService = new AdminAuditService(adminAuditLogRepository);
  const ordersService = new OrdersService(
    orderRepository,
    auditService,
    outboxService,
    cryptoCurrencyApiService,
    config,
    logger,
    bootContext,
  );
  const externalEffectGuard = new ExternalEffectGuard({
    logger,
    lockService,
    outboxJobRepository,
    orderRepository,
  });
  const energyService = new EnergyService(
    config,
    energyRequestRepository,
    ordersService,
    itrxService,
    tronService,
    outboxService,
    lockService,
    logger,
    externalEffectGuard,
  );
  const forwardsService = new ForwardsService(
    config,
    forwardRequestRepository,
    sendRequestRepository,
    ordersService,
    cryptoCurrencyApiService,
    tronService,
    outboxService,
    lockService,
    logger,
    externalEffectGuard,
  );
  const providerEventsService = new ProviderEventsService(
    config,
    providerEventRepository,
    ordersService,
    energyService,
    forwardsService,
    cryptoCurrencyApiService,
    itrxService,
    tronService,
    outboxService,
    logger,
  );
  const reconciliationService = new ReconciliationService(
    config,
    orderRepository,
    providerEventRepository,
    ordersService,
    outboxService,
    energyService,
    forwardsService,
    tronService,
    lockService,
    logger,
    bootContext,
  );
  const panelAuthService = new PanelAuthService(
    config,
    internalUserRepository,
    adminSessionRepository,
    passwordService,
    totpService,
    adminAuditService,
  );
  const panelUsersService = new PanelUsersService(
    internalUserRepository,
    adminSessionRepository,
    passwordService,
    panelAuthService,
  );
  const panelConsoleService = new PanelConsoleService(
    auditService,
    adminAuditService,
    ordersService,
    energyService,
    forwardsService,
    reconciliationService,
    orderNoteRepository,
    providerEventRepository,
    energyRequestRepository,
    forwardRequestRepository,
    sendRequestRepository,
  );
  const storageMaintenanceService = new StorageMaintenanceService(config);

  await panelAuthService.bootstrapAdminIfNeeded();

  const scheduler = new MongoScheduler({
    config,
    logger,
    outboxJobRepository,
    ordersService,
    energyService,
    forwardsService,
    providerEventsService,
    reconciliationService,
    lockService,
    bootContext,
  });

  const services: ApplicationServices = {
    auditService,
    adminAuditService,
    ordersService,
    energyService,
    forwardsService,
    providerEventsService,
    reconciliationService,
    panelAuthService,
    panelUsersService,
    panelSettingsService,
    panelConsoleService,
    storageMaintenanceService,
    scheduler,
    repositories: {
      orderRepository,
      providerEventRepository,
      energyRequestRepository,
      forwardRequestRepository,
      sendRequestRepository,
      orderStateTransitionRepository,
      outboxJobRepository,
      internalUserRepository,
      adminSessionRepository,
      adminAuditLogRepository,
      orderNoteRepository,
      systemSettingRepository,
    },
    providers: {
      cryptoCurrencyApiService,
      itrxService,
    },
  };

  const app = await createApp({
    config,
    logger,
    services,
  });

  if (options.startScheduler ?? config.scheduler.enabled) {
    await scheduler.start();
  }

  storageMaintenanceService.startAutomaticCleanup();

  app.addHook('onClose', async () => {
    storageMaintenanceService.stopAutomaticCleanup();
    await scheduler.stop();
    if (options.connectDb !== false) {
      await disconnectFromDatabase();
    }
  });

  return {
    app,
    services,
    config,
    logger,
  };
};
