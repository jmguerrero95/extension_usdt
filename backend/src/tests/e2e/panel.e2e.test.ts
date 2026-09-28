import nock from 'nock';
import request from 'supertest';
import { generateSync } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestApp, clearDatabase, createTestApp } from '../test-helpers';

describe('panel e2e', () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  const loginAndSetupTwoFactor = async () => {
    const agent = request.agent(testApp.app.server);
    const loginResponse = await agent.post('/panel/api/auth/login').send({
      email: testApp.config.panel.bootstrapAdmin.email,
      password: testApp.config.panel.bootstrapAdmin.password,
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.requiresTwoFactorSetup).toBe(true);

    const csrfToken = loginResponse.body.data.csrfToken as string;

    const setupResponse = await agent
      .post('/panel/api/auth/2fa/setup')
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(setupResponse.status).toBe(200);
    const secret = setupResponse.body.data.secret as string;
    const otpCode = generateSync({ secret });

    const confirmResponse = await agent
      .post('/panel/api/auth/2fa/confirm')
      .set('x-csrf-token', csrfToken)
      .send({
        otpCode,
      });

    expect(confirmResponse.status).toBe(200);

    return {
      agent,
      csrfToken,
      secret,
    };
  };

  const performStepUp = async (input: {
    agent: ReturnType<typeof request.agent>;
    csrfToken: string;
    secret: string;
  }) =>
    input.agent.post('/panel/api/auth/step-up').set('x-csrf-token', input.csrfToken).send({
      password: testApp.config.panel.bootstrapAdmin.password,
      otpCode: generateSync({ secret: input.secret }),
    });

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    await testApp.services.panelAuthService.bootstrapAdminIfNeeded();
    nock.cleanAll();
  });

  afterAll(async () => {
    nock.cleanAll();
    await closeTestApp(testApp);
  });

  it('obliga a configurar 2FA antes de permitir el dashboard', async () => {
    const agent = request.agent(testApp.app.server);
    const loginResponse = await agent.post('/panel/api/auth/login').send({
      email: testApp.config.panel.bootstrapAdmin.email,
      password: testApp.config.panel.bootstrapAdmin.password,
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.requiresTwoFactorSetup).toBe(true);

    const blockedDashboard = await agent.get('/panel/api/dashboard');
    expect(blockedDashboard.status).toBe(403);

    const { agent: authenticatedAgent, csrfToken, secret } = await loginAndSetupTwoFactor();
    const meResponse = await authenticatedAgent.get('/panel/api/auth/me');
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.requiresTwoFactorSetup).toBe(false);

    const dashboardResponse = await authenticatedAgent.get('/panel/api/dashboard');
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.data.activeOrders).toBeDefined();

    const stepUpResponse = await performStepUp({
      agent: authenticatedAgent,
      csrfToken,
      secret,
    });

    expect(stepUpResponse.status).toBe(200);
  });

  it('requiere step-up antes de guardar configuración sensible', async () => {
    const { agent, csrfToken, secret } = await loginAndSetupTwoFactor();
    const adminUser = await testApp.services.repositories.internalUserRepository.findByEmail(
      testApp.config.panel.bootstrapAdmin.email as string,
    );
    const sessions = await testApp.services.repositories.adminSessionRepository.listActiveByUserId(
      adminUser?.id as string,
    );
    const currentSession = sessions[0];
    expect(currentSession).toBeDefined();

    await testApp.services.repositories.adminSessionRepository.updateById(
      currentSession?.id as string,
      {
        stepUpVerifiedAt: new Date(Date.now() - testApp.config.panel.stepUpTtlMin * 60_000 - 1_000),
      },
    );

    const forbiddenSave = await agent
      .put('/panel/api/settings')
      .set('x-csrf-token', csrfToken)
      .send({
        items: [
          {
            key: 'ORDER_DEFAULT_PERIOD_MIN',
            value: '90',
          },
        ],
      });

    expect(forbiddenSave.status).toBe(403);

    const stepUpResponse = await performStepUp({
      agent,
      csrfToken,
      secret,
    });

    expect(stepUpResponse.status).toBe(200);

    const saved = await agent
      .put('/panel/api/settings')
      .set('x-csrf-token', csrfToken)
      .send({
        items: [
          {
            key: 'ORDER_DEFAULT_PERIOD_MIN',
            value: '90',
          },
        ],
      });

    expect(saved.status).toBe(200);
    expect(saved.body.data.appliesOnRestart).toBe(true);
  });

  it('exporta reportes PDF usando presets de fecha', async () => {
    const { agent } = await loginAndSetupTwoFactor();

    const response = await agent
      .get('/panel/api/reports/orders/export.pdf')
      .query({
        preset: 'today',
        timezoneOffsetMinutes: 300,
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.body).toBeInstanceOf(Buffer);
    expect(response.body.length).toBeGreaterThan(100);
  });

  it('permite filtrar auditoria por accion', async () => {
    const { agent } = await loginAndSetupTwoFactor();

    const response = await agent.get('/panel/api/audit/logs').query({
      action: 'login_success',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((item: { action: string }) => item.action === 'login_success')).toBe(true);
  });

  it('requiere step-up tambien para acciones manuales sobre ordenes', async () => {
    const { agent, csrfToken, secret } = await loginAndSetupTwoFactor();
    const adminUser = await testApp.services.repositories.internalUserRepository.findByEmail(
      testApp.config.panel.bootstrapAdmin.email as string,
    );
    const sessions = await testApp.services.repositories.adminSessionRepository.listActiveByUserId(
      adminUser?.id as string,
    );
    const currentSession = sessions[0];

    await testApp.services.repositories.adminSessionRepository.updateById(
      currentSession?.id as string,
      {
        stepUpVerifiedAt: new Date(Date.now() - testApp.config.panel.stepUpTtlMin * 60_000 - 1_000),
      },
    );

    const forbidden = await agent
      .post('/panel/api/orders/ord_missing/actions/reconcile')
      .set('x-csrf-token', csrfToken)
      .send({
        reason: 'Verificacion manual',
      });

    expect(forbidden.status).toBe(403);

    const stepUpResponse = await performStepUp({
      agent,
      csrfToken,
      secret,
    });

    expect(stepUpResponse.status).toBe(200);

    const retried = await agent
      .post('/panel/api/orders/ord_missing/actions/reconcile')
      .set('x-csrf-token', csrfToken)
      .send({
        reason: 'Verificacion manual',
      });

    expect(retried.status).toBe(404);
  });

  it('prueba conexion de proveedores desde settings', async () => {
    const { agent, csrfToken, secret } = await loginAndSetupTwoFactor();

    await performStepUp({
      agent,
      csrfToken,
      secret,
    });

    nock(testApp.config.providers.cryptocurrencyapi.baseUrl)
      .get('/api/trx/.status')
      .query((query) => query['key'] === testApp.config.providers.cryptocurrencyapi.apiKey)
      .reply(400, { error: 'missing id' });

    const response = await agent
      .post('/panel/api/settings/test-connection')
      .set('x-csrf-token', csrfToken)
      .send({
        provider: 'cryptocurrencyapi',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.reachable).toBe(true);
  });
});
