import request from 'supertest';
import { generateSync } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestApp, clearDatabase, createTestApp } from '../test-helpers';

describe('admin maintenance e2e', () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  const getResponseData = <T>(response: request.Response): T =>
    (response.body as { data: T }).data;

  const loginAndSetupTwoFactor = async (email?: string, password?: string) => {
    const agent = request.agent(testApp.app.server);
    const loginResponse = await agent.post('/panel/api/auth/login').send({
      email: email ?? testApp.config.panel.bootstrapAdmin.email,
      password: password ?? testApp.config.panel.bootstrapAdmin.password,
    });

    expect(loginResponse.status).toBe(200);

    const csrfToken = getResponseData<{ csrfToken: string }>(loginResponse).csrfToken;

    const setupResponse = await agent
      .post('/panel/api/auth/2fa/setup')
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(setupResponse.status).toBe(200);
    const secret = getResponseData<{ secret: string }>(setupResponse).secret;

    const confirmResponse = await agent
      .post('/panel/api/auth/2fa/confirm')
      .set('x-csrf-token', csrfToken)
      .send({
        otpCode: generateSync({ secret }),
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
    password?: string;
  }) =>
    input.agent.post('/panel/api/auth/step-up').set('x-csrf-token', input.csrfToken).send({
      password: input.password ?? testApp.config.panel.bootstrapAdmin.password,
      otpCode: generateSync({ secret: input.secret }),
    });

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await clearDatabase();
    await testApp.services.panelAuthService.bootstrapAdminIfNeeded();
  });

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  it('bloquea el acceso sin el permiso maintenance:storage', async () => {
    await testApp.services.panelUsersService.createUser({
      email: 'support@example.com',
      displayName: 'Support User',
      role: 'support',
      password: 'SupportPassword123!',
    });

    const { agent, csrfToken, secret } = await loginAndSetupTwoFactor(
      'support@example.com',
      'SupportPassword123!',
    );
    const stepUpResponse = await performStepUp({
      agent,
      csrfToken,
      secret,
      password: 'SupportPassword123!',
    });

    expect(stepUpResponse.status).toBe(200);

    const response = await agent
      .get('/api/v1/admin/maintenance/storage')
      .set('x-csrf-token', csrfToken);

    expect(response.status).toBe(403);
  });
});
