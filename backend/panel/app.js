const state = {
  me: null,
  csrfToken: null,
  currentView: 'dashboard',
  selectedOrderId: null,
  sidebarOpen: false,
};

const app = document.getElementById('app');

const viewDefinitions = [
  { id: 'dashboard', label: 'Dashboard', permission: 'dashboard:view' },
  { id: 'orders', label: 'Órdenes', permission: 'orders:view' },
  { id: 'audit', label: 'Auditoría', permission: 'audit:view' },
  { id: 'events', label: 'Eventos', permission: 'audit:view' },
  { id: 'reports', label: 'Reportes', permission: 'reports:view' },
  { id: 'settings', label: 'Configuración', permission: 'settings:view' },
  { id: 'users', label: 'Usuarios', permission: 'users:view' },
  { id: 'profile', label: 'Perfil', permission: 'profile:manage' },
];

const actionPermissions = {
  reconcile: 'orders:reconcile',
  'retry-energy': 'orders:retry-energy',
  'retry-buy-energy': 'orders:retry-energy',
  'retry-forward': 'orders:retry-forward',
  'retry-send': 'orders:retry-send',
  'mark-manual-review': 'orders:manual-review',
  'clear-manual-review': 'orders:clear-manual-review',
  cancel: 'orders:cancel',
  'complete-manually': 'orders:complete-manually',
};

const sensitiveActions = new Set([
  'reconcile',
  'retry-energy',
  'retry-buy-energy',
  'retry-forward',
  'retry-send',
  'mark-manual-review',
  'clear-manual-review',
  'cancel',
  'complete-manually',
  'settings-save',
  'settings-test',
  'user-create',
  'user-update',
  'user-reset-password',
  'user-reset-2fa',
  'close-other-sessions',
  'password-change',
  'reconfigure-2fa',
]);

const doubleConfirmationActions = new Set([
  'cancel',
  'complete-manually',
  'clear-manual-review',
  'settings-save',
  'user-reset-password',
  'user-reset-2fa',
]);

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatMoney = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

const formatUsdt = (value) =>
  new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(Number(value ?? 0));

const formatDate = (value) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const formatDateInputValue = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const buildLoader = (message = 'Cargando informacion...') => `
  <div class="loading-state">
    <span class="spinner" aria-hidden="true"></span>
    <span>${escapeHtml(message)}</span>
  </div>
`;

const buildEmptyState = (title, description) => `
  <div class="empty-state strong">
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(description)}</span>
  </div>
`;

const buildQueryParams = (formData, options = {}) => {
  const params = new URLSearchParams();
  const timezoneOffsetMinutes = String(new Date().getTimezoneOffset());

  if (!formData) {
    if (options.includeTimezone) {
      params.set('timezoneOffsetMinutes', timezoneOffsetMinutes);
    }
    return params;
  }

  for (const [key, value] of formData.entries()) {
    if (!value) {
      continue;
    }

    if (key === 'preset' && String(value) !== 'custom') {
      params.set(key, String(value));
      continue;
    }

    if (key === 'dateFrom' || key === 'dateTo') {
      params.set(key, new Date(String(value)).toISOString());
      continue;
    }

    params.set(key, String(value));
  }

  if (options.includeTimezone) {
    params.set('timezoneOffsetMinutes', timezoneOffsetMinutes);
  }

  return params;
};

const getTrendMarkup = (trend, suffix = '') => {
  if (!trend) {
    return '';
  }

  const symbol =
    trend.direction === 'up' ? '&uarr;' : trend.direction === 'down' ? '&darr;' : '&rarr;';
  const className =
    trend.direction === 'up'
      ? 'trend-up'
      : trend.direction === 'down'
        ? 'trend-down'
        : 'trend-flat';

  return `<span class="trend-chip ${className}">${symbol} ${escapeHtml(Math.abs(trend.delta))}${suffix}</span>`;
};

const passwordStrengthMessage =
  'Usa al menos 12 caracteres con mayusculas, minusculas, numeros y simbolos.';

const isStrongPassword = (value) =>
  typeof value === 'string' &&
  value.length >= 12 &&
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /\d/.test(value) &&
  /[^A-Za-z0-9]/.test(value);

const hasPermission = (permission) =>
  Boolean(state.me?.user?.permissions?.includes(permission));

async function api(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };

  if (options.method && options.method !== 'GET' && state.csrfToken) {
    headers['x-csrf-token'] = state.csrfToken;
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });

  if (response.headers.get('content-type')?.includes('text/csv')) {
    return response.text();
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? 'La operación no pudo completarse.';
    const error = new Error(message);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload?.data;
}

function setHash(viewId) {
  if (location.hash !== `#${viewId}`) {
    location.hash = viewId;
  }
}

function resolveCurrentView() {
  const hashView = location.hash.replace('#', '').trim();
  const allowedViews = viewDefinitions
    .filter((item) => hasPermission(item.permission))
    .map((item) => item.id);

  if (hashView && allowedViews.includes(hashView)) {
    state.currentView = hashView;
    return;
  }

  state.currentView = allowedViews[0] ?? 'profile';
  setHash(state.currentView);
}

function renderTopbar(title, description, actions = '') {
  document.getElementById('page-topbar').innerHTML = `
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
    </div>
    <div class="topbar-actions">
      ${actions}
      <button class="btn-ghost" id="logout-button">Cerrar sesión</button>
    </div>
  `;

  document.getElementById('logout-button').addEventListener('click', async () => {
    await api('/panel/api/auth/logout', { method: 'POST' });
    state.me = null;
    state.csrfToken = null;
    renderLogin();
  });
}

function syncSidebarState() {
  const shell = document.querySelector('.app-shell');
  const toggle = document.getElementById('sidebar-toggle');

  if (!shell) {
    document.body.classList.remove('panel-sidebar-open');
    return;
  }

  shell.classList.toggle('sidebar-open', state.sidebarOpen);
  document.body.classList.toggle('panel-sidebar-open', state.sidebarOpen);

  if (toggle) {
    toggle.setAttribute('aria-expanded', state.sidebarOpen ? 'true' : 'false');
    toggle.setAttribute('aria-label', state.sidebarOpen ? 'Cerrar menu lateral' : 'Abrir menu lateral');
  }
}

function setSidebarOpen(nextValue) {
  state.sidebarOpen = Boolean(nextValue);
  syncSidebarState();
}

function showTransientMessage(kind, message) {
  const flash = document.getElementById('flash-messages');
  if (!flash) {
    return;
  }

  flash.innerHTML = `
    <div class="${kind === 'error' ? 'error-state' : 'notice'}">${escapeHtml(message)}</div>
  `;
  setTimeout(() => {
    if (flash) {
      flash.innerHTML = '';
    }
  }, 4000);
}

function renderLogin(errorMessage = null) {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <section class="login-hero">
          <div>
            <small>GENERAL BYTES CAS Wallet</small>
            <h1>Panel interno de operaciones</h1>
          </div>
          <p>
            Consola segura para soporte, operaciones y administración del backend BUY/SELL.
            Todas las acciones sensibles quedan auditadas y protegidas por roles, sesión y 2FA.
          </p>
          <ul>
            <li>Revisión operativa de órdenes, eventos y conflictos.</li>
            <li>Reintentos seguros, reconciliación y seguimiento completo.</li>
            <li>Gestión interna de usuarios, configuración y reportes.</li>
          </ul>
        </section>
        <section class="login-panel">
          <h2>Ingreso interno</h2>
          <p class="muted">
            Ingresa con tu correo, contraseña y código del autenticador. Si es tu primer acceso,
            el sistema te pedirá configurar 2FA antes de habilitar el panel.
          </p>
          ${errorMessage ? `<div class="error-state">${escapeHtml(errorMessage)}</div>` : ''}
          <form id="login-form" class="stack">
            <div class="field">
              <label for="email">Correo</label>
              <input id="email" name="email" type="email" autocomplete="username" required />
            </div>
            <div class="field">
              <label for="password">Contraseña</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required />
            </div>
            <div class="field">
              <label for="otpCode">Código 2FA</label>
              <input id="otpCode" name="otpCode" type="text" inputmode="numeric" autocomplete="one-time-code" />
            </div>
            <button class="btn" type="submit">Entrar al panel</button>
          </form>
        </section>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      const result = await api('/panel/api/auth/login', {
        method: 'POST',
        body: {
          email: form.get('email'),
          password: form.get('password'),
          otpCode: form.get('otpCode') || undefined,
        },
      });

      state.me = result;
      state.csrfToken = result.csrfToken;

      if (result.requiresTwoFactorSetup) {
        renderTwoFactorSetup();
        return;
      }

      renderShell();
      await renderCurrentView();
    } catch (error) {
      renderLogin(error.message);
    }
  });
}

async function renderTwoFactorSetup() {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <section class="login-hero">
          <div>
            <small>2FA obligatorio</small>
            <h1>Configura tu autenticador</h1>
          </div>
          <p>
            Este panel exige doble factor para cualquier usuario interno. Escanea el QR con tu
            app de autenticación y confirma el primer código antes de continuar.
          </p>
          <div id="two-factor-setup-box" class="notice">Generando configuración segura…</div>
        </section>
        <section class="login-panel">
          <h2>Activar 2FA</h2>
          <form id="two-factor-confirm-form" class="stack hidden">
            <div id="qr-container" class="qr-box"></div>
            <div class="field">
              <label>URL OTPAuth</label>
              <textarea id="otpAuthUrl" readonly></textarea>
            </div>
            <div class="field">
              <label>Secret manual</label>
              <input id="manualSecret" readonly />
            </div>
            <div class="field">
              <label for="confirmOtpCode">Código generado</label>
              <input id="confirmOtpCode" name="confirmOtpCode" type="text" inputmode="numeric" required />
            </div>
            <button class="btn" type="submit">Confirmar y entrar</button>
          </form>
        </section>
      </div>
    </div>
  `;

  try {
    const setup = await api('/panel/api/auth/2fa/setup', { method: 'POST' });
    document.getElementById('two-factor-setup-box').innerHTML =
      '<strong>Escanea el QR y confirma el código.</strong><span class="muted">No cierres esta ventana hasta completar la activación.</span>';
    document.getElementById('qr-container').innerHTML = `<img alt="QR 2FA" src="${setup.qrDataUrl}" />`;
    document.getElementById('otpAuthUrl').value = setup.otpAuthUrl;
    document.getElementById('manualSecret').value = setup.secret;
    document.getElementById('two-factor-confirm-form').classList.remove('hidden');
  } catch (error) {
    document.getElementById('two-factor-setup-box').innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
    return;
  }

  document
    .getElementById('two-factor-confirm-form')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = document.getElementById('confirmOtpCode').value.trim();

      try {
        const result = await api('/panel/api/auth/2fa/confirm', {
          method: 'POST',
          body: { otpCode: code },
        });

        state.me = {
          ...state.me,
          user: result.user,
          requiresTwoFactorSetup: result.requiresTwoFactorSetup,
        };
        renderShell();
        await renderCurrentView();
      } catch (error) {
        showTransientMessage('error', error.message);
      }
    });
}

function renderShell() {
  resolveCurrentView();
  const nav = viewDefinitions
    .filter((item) => hasPermission(item.permission))
    .map(
      (item) => `
        <button class="nav-button ${item.id === state.currentView ? 'active' : ''}" data-view="${item.id}">
          ${escapeHtml(item.label)}
        </button>
      `,
    )
    .join('');

  app.innerHTML = `
    <div class="app-shell">
      <button class="sidebar-overlay" id="sidebar-overlay" type="button" aria-label="Cerrar menu lateral"></button>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-mobile-head">
          <div class="brand">
            <small>Operaciones internas</small>
            <strong>GENERAL BYTES CAS Wallet</strong>
          </div>
          <button class="sidebar-close" id="sidebar-close" type="button" aria-label="Cerrar menu lateral">&times;</button>
        </div>
        <nav class="sidebar-nav">${nav}</nav>
        <div class="sidebar-footer">
          <span>${escapeHtml(state.me.user.role)}</span>
          <strong>${escapeHtml(state.me.user.displayName)}</strong>
          <span>${escapeHtml(state.me.user.email)}</span>
        </div>
      </aside>
      <main class="main">
        <div class="main-utility-bar">
          <div class="main-utility-brand">
            <small>Operaciones internas</small>
            <strong>GENERAL BYTES CAS Wallet</strong>
          </div>
          <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-expanded="false">
            <span class="hamburger-icon" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>
        </div>
        <div id="page-topbar" class="topbar"></div>
        <div id="flash-messages" class="stack"></div>
        <div id="page-content" class="stack"></div>
      </main>
    </div>
  `;

  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    setSidebarOpen(!state.sidebarOpen);
  });
  document.getElementById('sidebar-close')?.addEventListener('click', () => {
    setSidebarOpen(false);
  });
  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    setSidebarOpen(false);
  });

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.currentView = button.dataset.view;
      state.sidebarOpen = false;
      setHash(state.currentView);
      renderShell();
      await renderCurrentView();
    });
  });

  syncSidebarState();
}

async function renderCurrentView() {
  const content = document.getElementById('page-content');
  content.innerHTML = `<div class="card"><div class="card-content">${buildLoader()}</div></div>`;

  switch (state.currentView) {
    case 'dashboard':
      await renderDashboardView();
      break;
    case 'orders':
      await renderOrders();
      break;
    case 'audit':
      await renderAuditView();
      break;
    case 'events':
      await renderEvents();
      break;
    case 'reports':
      await renderReportsView();
      break;
    case 'settings':
      await renderSettingsView();
      break;
    case 'users':
      await renderUsers();
      break;
    case 'profile':
    default:
      await renderProfileView();
      break;
  }
}

function renderStatusBadge(status, manualReviewRequired) {
  const kind =
    manualReviewRequired || String(status).includes('ERROR')
      ? 'danger'
      : String(status).includes('READY') || status === 'WAITING_DEPOSIT'
        ? 'info'
        : status === 'COMPLETED'
          ? 'ok'
          : 'warn';
  return `<span class="badge ${kind}">${escapeHtml(status)}${manualReviewRequired ? ' · manual' : ''}</span>`;
}

async function renderDashboard() {
  renderTopbar('Dashboard operativo', 'Resumen instantáneo de órdenes, alertas y cola operativa.');
  const data = await api('/panel/api/dashboard');
  const metrics = [
    ['Órdenes activas', data.activeOrders, 'En procesamiento o pendientes'],
    ['Errores abiertos', data.errorOrders, 'Retryable o revisión manual'],
    ['Revisión manual', data.manualReviewOrders, 'Casos detenidos por control'],
    ['BUY del día', data.buyToday, `${formatUsdt(data.volumeBoughtUsdt)} USDT enviados`],
    ['SELL del día', data.sellToday, `${formatUsdt(data.volumeSoldUsdt)} USDT detectados`],
    ['Completadas hoy', data.completedToday, 'Cerradas exitosamente'],
    ['Expiradas hoy', data.expiredToday, 'Sin continuación automática'],
    ['Webhooks rechazados', data.rejectedWebhooks, 'Pendientes de revisar'],
  ];

  document.getElementById('page-content').innerHTML = `
    <section class="grid card-grid">
      ${metrics
        .map(
          ([label, value, subtext]) => `
            <article class="card metric-card">
              <div class="card-content">
                <div class="metric-label">${escapeHtml(label)}</div>
                <div class="metric-value">${escapeHtml(value)}</div>
                <div class="metric-subtext">${escapeHtml(subtext)}</div>
              </div>
            </article>
          `,
        )
        .join('')}
    </section>
    <section class="split-layout">
      <article class="card">
        <div class="card-content">
          <div class="section-header">
            <div>
              <h2>Volumen del día</h2>
              <p>Vista financiera operativa en COP y USDT.</p>
            </div>
          </div>
          <div class="detail-grid">
            <div class="detail-item"><span>Volumen BUY COP</span><strong>${formatMoney(data.volumeBoughtFiat)}</strong></div>
            <div class="detail-item"><span>Volumen SELL COP</span><strong>${formatMoney(data.volumeSoldFiat)}</strong></div>
            <div class="detail-item"><span>USDT enviados BUY</span><strong>${formatUsdt(data.volumeBoughtUsdt)}</strong></div>
            <div class="detail-item"><span>USDT recibidos SELL</span><strong>${formatUsdt(data.volumeSoldUsdt)}</strong></div>
            <div class="detail-item"><span>Reconciliaciones pendientes</span><strong>${escapeHtml(data.pendingReconciliations)}</strong></div>
          </div>
        </div>
      </article>
      <article class="card">
        <div class="card-content">
          <div class="section-header">
            <div>
              <h2>Alertas recientes</h2>
              <p>Órdenes que merecen atención inmediata.</p>
            </div>
          </div>
          <div class="stack">
            ${
              data.recentAlerts.length
                ? data.recentAlerts
                    .map(
                      (alert) => `
                        <div class="notice">
                          <strong>${escapeHtml(alert.orderId)} · ${escapeHtml(alert.type)} · ${escapeHtml(alert.status)}</strong>
                          <div class="muted">${escapeHtml(alert.lastErrorCode ?? 'Sin código')} · ${escapeHtml(alert.lastErrorMessage ?? 'Sin mensaje')}</div>
                          <div class="muted">${escapeHtml(alert.terminalId ?? 'Sin terminal')} · ${formatDate(alert.updatedAt)}</div>
                        </div>
                      `,
                    )
                    .join('')
                : '<div class="empty-state">No hay alertas recientes.</div>'
            }
          </div>
        </div>
      </article>
    </section>
  `;
}

function buildOrdersFiltersHtml() {
  return `
    <form id="orders-filters" class="filters">
      <div class="field"><label>Búsqueda</label><input name="q" placeholder="orderId, ref, txid, address..." /></div>
      <div class="field">
        <label>Tipo</label>
        <select name="type">
          <option value="">Todos</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </div>
      <div class="field"><label>Estado</label><input name="status" placeholder="WAITING_DEPOSIT, COMPLETED..." /></div>
      <div class="field"><label>Terminal</label><input name="terminalId" /></div>
      <div class="field">
        <label>Manual review</label>
        <select name="manualReviewRequired">
          <option value="">Todos</option>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      </div>
      <div class="field"><label>Desde</label><input type="datetime-local" name="dateFrom" /></div>
      <div class="field"><label>Hasta</label><input type="datetime-local" name="dateTo" /></div>
      <div class="field" style="flex:0 0 auto; align-self:end;">
        <button class="btn-secondary" type="submit">Buscar</button>
      </div>
    </form>
  `;
}

async function renderOrders() {
  renderTopbar(
    'Órdenes',
    'Búsqueda, seguimiento y acciones manuales sobre BUY y SELL con trazabilidad completa.',
  );

  document.getElementById('page-content').innerHTML = `
    <section class="card">
      <div class="card-content">
        ${buildOrdersFiltersHtml()}
      </div>
    </section>
    <section class="orders-layout">
      <article class="card orders-list-panel">
        <div class="card-content stack">
          <div class="section-header">
            <div>
              <h2>Listado paginado</h2>
              <p>Selecciona una orden para ver detalle, timeline, eventos y acciones disponibles.</p>
            </div>
          </div>
          <div id="orders-table-container" class="orders-table-container"></div>
        </div>
      </article>
      <article class="card orders-detail-panel">
        <div class="card-content">
          <div id="order-detail-container" class="order-detail-container empty-state">Selecciona una orden para abrir su detalle.</div>
        </div>
      </article>
    </section>
  `;

  document
    .getElementById('orders-filters')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      await loadOrders(new FormData(event.currentTarget));
    });

  await loadOrders();
}

async function loadOrders(formData = null) {
  const params = new URLSearchParams();
  if (formData) {
    for (const [key, value] of formData.entries()) {
      if (value) {
        const normalized =
          key === 'dateFrom' || key === 'dateTo'
            ? new Date(String(value)).toISOString()
            : String(value);
        params.append(key, normalized);
      }
    }
  }

  const result = await api(`/panel/api/orders?${params.toString()}`);
  const container = document.getElementById('orders-table-container');
  container.innerHTML = `
    <div class="muted">Total: ${escapeHtml(result.total)}</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Orden</th>
            <th>Tipo</th>
            <th>Estado</th>
            <th>Terminal</th>
            <th>Fiat</th>
            <th>Crypto</th>
            <th>Actualizada</th>
          </tr>
        </thead>
        <tbody>
          ${
            result.items.length
              ? result.items
                  .map(
                    (order) => `
                      <tr data-order-id="${escapeHtml(order.orderId)}">
                        <td><strong>${escapeHtml(order.orderId)}</strong><div class="muted">${escapeHtml(order.externalRef ?? 'Sin ref')}</div></td>
                        <td>${escapeHtml(order.type)}</td>
                        <td>${renderStatusBadge(order.status, order.manualReviewRequired)}</td>
                        <td>${escapeHtml(order.terminalId ?? '—')}</td>
                        <td>${formatMoney(order.fiatAmount)}</td>
                        <td>${formatUsdt(order.cryptoAmountToSend ?? order.cryptoAmountReceived ?? order.cryptoAmountExpected ?? 0)}</td>
                        <td>${formatDate(order.updatedAt)}</td>
                      </tr>
                    `,
                  )
                  .join('')
              : '<tr><td colspan="7"><div class="empty-state">No hay órdenes con esos filtros.</div></td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('[data-order-id]').forEach((row) => {
    row.addEventListener('click', async () => {
      state.selectedOrderId = row.dataset.orderId;
      await loadOrderDetail(state.selectedOrderId);
    });
  });

  if (state.selectedOrderId) {
    await loadOrderDetail(state.selectedOrderId);
  }
}

function buildOrderActionButtons(order) {
  const buttons = [];
  const definitions = [
    ['reconcile', 'Reconciliar ahora'],
    [order.type === 'BUY' ? 'retry-buy-energy' : 'retry-energy', 'Reintentar energía'],
    [order.type === 'BUY' ? 'retry-send' : 'retry-forward', order.type === 'BUY' ? 'Reintentar send' : 'Reintentar forward'],
    ['mark-manual-review', 'Marcar revisión manual'],
    ['clear-manual-review', 'Quitar revisión manual'],
    ['cancel', 'Cancelar orden'],
    ['complete-manually', 'Cerrar manualmente'],
  ];

  for (const [action, label] of definitions) {
    const permission = actionPermissions[action];
    if (!permission || !hasPermission(permission)) continue;
    buttons.push(
      `<button class="${action === 'cancel' || action === 'complete-manually' ? 'btn-danger' : 'btn-secondary'}" data-action="${action}" data-order-id="${escapeHtml(order.orderId)}">${escapeHtml(label)}</button>`,
    );
  }

  return buttons.join('');
}

async function loadOrderDetail(orderId) {
  try {
    const detail = await api(`/panel/api/orders/${orderId}`);
    const container = document.getElementById('order-detail-container');
    container.className = 'stack order-detail-shell';
    container.innerHTML = `
      <div class="section-header">
        <div>
          <h2>${escapeHtml(detail.order.orderId)}</h2>
          <p>${escapeHtml(detail.order.type)} · ${escapeHtml(detail.order.status)}</p>
        </div>
        <div class="pill-row">${buildOrderActionButtons(detail.order)}</div>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><span>Fiat</span><strong>${formatMoney(detail.order.fiatAmount)}</strong></div>
        <div class="detail-item"><span>Crypto esperado</span><strong>${formatUsdt(detail.order.cryptoAmountExpected ?? 0)}</strong></div>
        <div class="detail-item"><span>Crypto recibido</span><strong>${formatUsdt(detail.order.cryptoAmountReceived ?? 0)}</strong></div>
        <div class="detail-item"><span>Crypto a enviar</span><strong>${formatUsdt(detail.order.cryptoAmountToSend ?? 0)}</strong></div>
        <div class="detail-item"><span>Dirección depósito</span><strong class="code">${escapeHtml(detail.order.depositAddress ?? '—')}</strong></div>
        <div class="detail-item"><span>Dirección destino</span><strong class="code">${escapeHtml(detail.order.customerDestinationAddress ?? '—')}</strong></div>
        <div class="detail-item"><span>Wallet emisora</span><strong class="code">${escapeHtml(detail.order.buySenderAddress ?? '—')}</strong></div>
        <div class="detail-item"><span>Forward / Send request</span><strong class="code">${escapeHtml(detail.order.providerForwardRequestId ?? detail.order.providerSendRequestId ?? '—')}</strong></div>
      </div>
      <div class="card"><div class="card-content">
        <div class="section-header"><div><h3>Timeline</h3><p>Transiciones y eventos recibidos.</p></div></div>
        <div class="timeline">
          ${
            detail.timeline.length
              ? detail.timeline
                  .map(
                    (item) => `
                      <div class="timeline-item">
                        <strong>${escapeHtml(item.summary)}</strong>
                        <span>${formatDate(item.occurredAt)}</span>
                        <code>${escapeHtml(JSON.stringify(item.details))}</code>
                      </div>
                    `,
                  )
                  .join('')
              : '<div class="empty-state">Sin timeline registrado.</div>'
          }
        </div>
      </div></div>
      <div class="card"><div class="card-content">
        <div class="section-header"><div><h3>Eventos y requests</h3><p>Webhooks, energía, forward/send y reintentos.</p></div></div>
        <div class="stack">
          <div class="notice"><strong>Energy request</strong><div class="code">${escapeHtml(JSON.stringify(detail.energyRequest ?? null))}</div></div>
          <div class="notice"><strong>Forward request</strong><div class="code">${escapeHtml(JSON.stringify(detail.forwardRequest ?? null))}</div></div>
          <div class="notice"><strong>Send request</strong><div class="code">${escapeHtml(JSON.stringify(detail.sendRequest ?? null))}</div></div>
          <div class="notice"><strong>Correlación</strong><div class="code">${escapeHtml(JSON.stringify(detail.correlation))}</div></div>
        </div>
      </div></div>
      <div class="card"><div class="card-content stack">
        <div class="section-header"><div><h3>Notas internas</h3><p>Registro operativo y escalaciones.</p></div></div>
        <form id="order-note-form" class="stack">
          <div class="field"><label>Nota</label><textarea name="note" required></textarea></div>
          <div class="inline-form">
            <label><input type="checkbox" name="escalation" /> Escalar a supervisor</label>
            <button class="btn-secondary" type="submit">Guardar nota</button>
          </div>
        </form>
        <div class="stack">
          ${
            detail.notes.length
              ? detail.notes
                  .map(
                    (note) => `
                      <div class="notice">
                        <strong>${escapeHtml(note.authorDisplayName)} · ${escapeHtml(note.authorRole)}</strong>
                        <div>${escapeHtml(note.note)}</div>
                        <div class="muted">${formatDate(note.createdAt)}${note.escalation ? ' · escalado' : ''}</div>
                      </div>
                    `,
                  )
                  .join('')
              : '<div class="empty-state">Sin notas operativas todavía.</div>'
          }
        </div>
      </div></div>
    `;

    container.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        await handleOrderAction(orderId, button.dataset.action);
      });
    });

    document
      .getElementById('order-note-form')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await api(`/panel/api/orders/${orderId}/notes`, {
          method: 'POST',
          body: {
            note: form.get('note'),
            escalation: form.get('escalation') === 'on',
          },
        });
        showTransientMessage('success', 'Nota agregada a la orden.');
        await loadOrderDetail(orderId);
      });
  } catch (error) {
    document.getElementById('order-detail-container').innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

async function requestStepUpIfNeeded(actionId) {
  if (!sensitiveActions.has(actionId)) {
    return;
  }

  const values = await openModal({
    title: 'Reautenticación fuerte',
    description: 'Esta acción requiere validar nuevamente tu contraseña y código 2FA.',
    fields: [
      { name: 'password', label: 'Contraseña actual', type: 'password', required: true },
      { name: 'otpCode', label: 'Código 2FA', required: true },
    ],
    confirmLabel: 'Validar',
  });

  await api('/panel/api/auth/step-up', {
    method: 'POST',
    body: values,
  });

  showTransientMessage('success', 'Reautenticacion fuerte validada.');
}

async function handleOrderAction(orderId, action) {
  await requestStepUpIfNeeded(action);
  const values = await openModal({
    title: 'Acción manual sobre orden',
    description: 'Debes registrar un motivo claro. Todas las acciones quedan auditadas.',
    fields: [{ name: 'reason', label: 'Motivo', type: 'textarea', required: true }],
    confirmLabel: 'Ejecutar acción',
    danger: ['cancel', 'complete-manually'].includes(action),
  });

  if (doubleConfirmationActions.has(action)) {
    const confirmation = await openModal({
      title: 'Confirmacion final',
      description:
        'Esta accion es sensible. Confirma escribiendo CONFIRMAR para continuar.',
      fields: [{ name: 'confirmation', label: 'Escribe CONFIRMAR', required: true }],
      confirmLabel: 'Confirmar accion',
      danger: true,
    });

    if (String(confirmation.confirmation).trim().toUpperCase() !== 'CONFIRMAR') {
      throw new Error('La confirmacion final no coincide.');
    }
  }

  await api(`/panel/api/orders/${orderId}/actions/${action}`, {
    method: 'POST',
    body: values,
  });
  showTransientMessage('success', `Acción ${action} aplicada sobre ${orderId}.`);
  await loadOrderDetail(orderId);
}

async function renderAudit() {
  renderTopbar('Auditoría interna', 'Accesos, cambios sensibles y trazabilidad operativa del panel.');
  const data = await api('/panel/api/audit/logs');
  document.getElementById('page-content').innerHTML = `
    <section class="card"><div class="card-content stack">
      <div class="section-header"><div><h2>Logs de auditoría</h2><p>Últimos eventos registrados por el panel.</p></div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Categoría</th><th>Acción</th><th>Actor</th><th>Target</th><th>IP</th></tr></thead>
          <tbody>
            ${
              data.length
                ? data
                    .map(
                      (log) => `
                        <tr>
                          <td>${formatDate(log.createdAt)}</td>
                          <td>${escapeHtml(log.category)}</td>
                          <td>${escapeHtml(log.action)}</td>
                          <td>${escapeHtml(log.actorEmail ?? 'Sistema')}</td>
                          <td>${escapeHtml(log.targetType ?? '—')} · ${escapeHtml(log.targetId ?? '—')}</td>
                          <td>${escapeHtml(log.ipAddress ?? '—')}</td>
                        </tr>
                      `,
                    )
                    .join('')
                : '<tr><td colspan="6"><div class="empty-state">Sin actividad auditada todavía.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div></section>
  `;
}

async function renderEvents() {
  renderTopbar('Eventos de proveedores', 'Webhooks y callbacks recibidos, con foco en rechazados o pendientes.');
  const events = await api('/panel/api/provider-events');
  document.getElementById('page-content').innerHTML = `
    <section class="card"><div class="card-content stack">
      <div class="section-header"><div><h2>Eventos recientes</h2><p>Inspección operativa de CryptoCurrencyAPI e iTRX.</p></div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Tipo</th><th>Orden</th><th>Procesado</th><th>Firma</th></tr></thead>
          <tbody>
            ${
              events.length
                ? events
                    .map(
                      (event) => `
                        <tr>
                          <td>${formatDate(event.createdAt)}</td>
                          <td>${escapeHtml(event.provider)}</td>
                          <td>${escapeHtml(event.eventType)}</td>
                          <td>${escapeHtml(event.orderId ?? '—')}</td>
                          <td>${renderStatusBadge(event.processed ? 'PROCESSED' : 'REJECTED', !event.processed)}</td>
                          <td>${escapeHtml(String(event.signatureValid ?? 'n/a'))}</td>
                        </tr>
                      `,
                    )
                    .join('')
                : '<tr><td colspan="6"><div class="empty-state">No hay eventos disponibles.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div></section>
  `;
}

async function renderReports() {
  renderTopbar(
    'Reportes',
    'Consulta por rango y exportación CSV. Para PDF se recomienda usar “Imprimir / Guardar como PDF” del navegador.',
    `<button class="btn-secondary" id="print-report">Imprimir / PDF</button>`,
  );
  document.getElementById('page-content').innerHTML = `
    <section class="card"><div class="card-content stack">
      <form id="report-filters" class="filters">
        <div class="field"><label>Desde</label><input type="datetime-local" name="dateFrom" /></div>
        <div class="field"><label>Hasta</label><input type="datetime-local" name="dateTo" /></div>
        <div class="field"><label>Tipo</label><select name="type"><option value="">Todos</option><option value="BUY">BUY</option><option value="SELL">SELL</option></select></div>
        <div class="field"><label>Estado</label><input name="status" /></div>
        <div class="field"><label>Terminal</label><input name="terminalId" /></div>
        <div class="field" style="flex:0 0 auto; align-self:end;"><button class="btn-secondary" type="submit">Generar</button></div>
        <div class="field" style="flex:0 0 auto; align-self:end;"><button class="btn" type="button" id="export-csv">Exportar CSV</button></div>
      </form>
      <div id="report-result"></div>
    </div></section>
  `;

  document.getElementById('print-report').addEventListener('click', () => window.print());
  document.getElementById('report-filters').addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadReport(new FormData(event.currentTarget));
  });
  document.getElementById('export-csv').addEventListener('click', async () => {
    const form = new FormData(document.getElementById('report-filters'));
    const params = new URLSearchParams();
    for (const [key, value] of form.entries()) {
      if (value) {
        params.append(
          key,
          key.includes('date') ? new Date(String(value)).toISOString() : String(value),
        );
      }
    }
    const csv = await api(`/panel/api/reports/orders/export.csv?${params.toString()}`);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'operaciones.csv';
    link.click();
    URL.revokeObjectURL(url);
  });

  await loadReport();
}

async function loadReport(formData = null) {
  const params = new URLSearchParams();
  if (formData) {
    for (const [key, value] of formData.entries()) {
      if (value) {
        params.append(
          key,
          key.includes('date') ? new Date(String(value)).toISOString() : String(value),
        );
      }
    }
  }

  const report = await api(`/panel/api/reports/orders?${params.toString()}`);
  document.getElementById('report-result').innerHTML = `
    <div class="grid card-grid">
      <article class="card metric-card"><div class="card-content"><div class="metric-label">Total</div><div class="metric-value">${escapeHtml(report.summary.total)}</div><div class="metric-subtext">Órdenes encontradas</div></div></article>
      <article class="card metric-card"><div class="card-content"><div class="metric-label">BUY</div><div class="metric-value">${escapeHtml(report.summary.buyCount)}</div><div class="metric-subtext">${formatMoney(report.summary.totalFiatBuy)}</div></div></article>
      <article class="card metric-card"><div class="card-content"><div class="metric-label">SELL</div><div class="metric-value">${escapeHtml(report.summary.sellCount)}</div><div class="metric-subtext">${formatMoney(report.summary.totalFiatSell)}</div></div></article>
      <article class="card metric-card"><div class="card-content"><div class="metric-label">Completadas</div><div class="metric-value">${escapeHtml(report.summary.completed)}</div><div class="metric-subtext">Fallidas: ${escapeHtml(report.summary.failed)}</div></div></article>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Orden</th><th>Tipo</th><th>Estado</th><th>Fiat</th><th>Crypto</th><th>Terminal</th><th>Fecha</th></tr></thead>
        <tbody>
          ${
            report.rows.length
              ? report.rows
                  .map(
                    (row) => `
                      <tr>
                        <td>${escapeHtml(row.orderId)}</td>
                        <td>${escapeHtml(row.type)}</td>
                        <td>${renderStatusBadge(row.status, row.manualReviewRequired)}</td>
                        <td>${formatMoney(row.fiatAmount)}</td>
                        <td>${formatUsdt(row.cryptoAmountToSend ?? row.cryptoAmountReceived ?? row.cryptoAmountExpected ?? 0)}</td>
                        <td>${escapeHtml(row.terminalId ?? '—')}</td>
                        <td>${formatDate(row.createdAt)}</td>
                      </tr>
                    `,
                  )
                  .join('')
              : '<tr><td colspan="7"><div class="empty-state">No hay datos para ese rango.</div></td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;
}

async function renderSettings() {
  renderTopbar('Configuración', 'Overrides operativos almacenados de forma segura. Los cambios aplican tras reiniciar.', `<button class="btn" id="save-settings">Guardar cambios</button>`);
  const settings = await api('/panel/api/settings');
  document.getElementById('page-content').innerHTML = `
    <section class="card"><div class="card-content stack">
      <div class="notice">
        El core actual sigue arrancando desde <code>.env</code>. Este panel guarda overrides seguros en Mongo y el backend los aplica automáticamente en el siguiente reinicio controlado.
      </div>
      <form id="settings-form" class="stack">
        ${settings
          .map(
            (setting) => `
              <div class="detail-item">
                <div class="section-header">
                  <div>
                    <h3>${escapeHtml(setting.label)}</h3>
                    <p>${escapeHtml(setting.description)}</p>
                  </div>
                  <span class="badge ${setting.isSecret ? 'warn' : 'info'}">${escapeHtml(setting.category)}</span>
                </div>
                <div class="detail-grid">
                  <div class="detail-item"><span>Valor actual</span><strong class="code">${escapeHtml(setting.currentValueMasked ?? 'No definido')}</strong></div>
                  <div class="detail-item"><span>Override BD</span><strong class="code">${escapeHtml(setting.overrideValueMasked ?? 'Sin override')}</strong></div>
                  <div class="field">
                    <label>Nuevo valor</label>
                    ${
                      setting.options
                        ? `<select name="${escapeHtml(setting.key)}"><option value="">Sin cambio</option>${setting.options
                            .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
                            .join('')}</select>`
                        : `<input name="${escapeHtml(setting.key)}" placeholder="${setting.isSecret ? 'Ingresar nuevo secreto' : 'Sin cambio'}" />`
                    }
                  </div>
                </div>
              </div>
            `,
          )
          .join('')}
      </form>
    </div></section>
  `;

  document.getElementById('save-settings').addEventListener('click', async () => {
    await requestStepUpIfNeeded('settings-save');
    const form = new FormData(document.getElementById('settings-form'));
    const items = [];
    for (const [key, value] of form.entries()) {
      if (String(value).trim() !== '') {
        items.push({ key, value: String(value) });
      }
    }
    if (!items.length) {
      showTransientMessage('error', 'No hay cambios para guardar.');
      return;
    }

    await api('/panel/api/settings', { method: 'PUT', body: { items } });
    showTransientMessage('success', 'Configuración guardada. Se aplicará tras reiniciar la app.');
    await renderSettings();
  });
}

async function renderUsers() {
  renderTopbar('Usuarios internos', 'Gestión de acceso, roles y recuperación controlada de cuentas.', `<button class="btn" id="new-user-button">Crear usuario</button>`);
  const users = await api('/panel/api/users');
  document.getElementById('page-content').innerHTML = `
    <section class="card"><div class="card-content stack">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>2FA</th><th>Último acceso</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${users
              .map(
                (user) => `
                  <tr>
                    <td>${escapeHtml(user.email)}</td>
                    <td>${escapeHtml(user.displayName)}</td>
                    <td>${escapeHtml(user.role)}</td>
                    <td>${renderStatusBadge(user.twoFactorEnabled ? 'ENABLED' : 'PENDING_SETUP', !user.twoFactorEnabled)}</td>
                    <td>${formatDate(user.lastLoginAt)}</td>
                    <td>${renderStatusBadge(user.active ? 'ACTIVE' : 'INACTIVE', !user.active)}</td>
                    <td class="pill-row">
                      <button class="btn-secondary" data-user-action="edit" data-user-id="${user.id}">Editar</button>
                      <button class="btn-secondary" data-user-action="reset-password" data-user-id="${user.id}">Reset password</button>
                      <button class="btn-danger" data-user-action="reset-2fa" data-user-id="${user.id}">Reset 2FA</button>
                    </td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div></section>
  `;

  document.getElementById('new-user-button').addEventListener('click', async () => {
    await requestStepUpIfNeeded('user-create');
    const values = await openModal({
      title: 'Crear usuario interno',
      description: 'Se creará con 2FA pendiente y contraseña temporal robusta.',
      fields: [
        { name: 'email', label: 'Correo', required: true },
        { name: 'displayName', label: 'Nombre visible', required: true },
        { name: 'role', label: 'Rol', type: 'select', options: ['support', 'operations', 'supervisor', 'admin'], required: true },
        { name: 'password', label: 'Contraseña inicial', type: 'password', required: true },
      ],
      confirmLabel: 'Crear usuario',
    });
    if (!isStrongPassword(values.password)) {
      throw new Error(passwordStrengthMessage);
    }
    await api('/panel/api/users', { method: 'POST', body: values });
    showTransientMessage('success', 'Usuario creado.');
    await renderUsers();
  });

  document.querySelectorAll('[data-user-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.userAction;
      const userId = button.dataset.userId;

      if (action === 'edit') {
        await requestStepUpIfNeeded('user-update');
        const target = users.find((user) => user.id === userId);
        const values = await openModal({
          title: 'Editar usuario',
          description: 'Ajusta rol, nombre o estado.',
          fields: [
            { name: 'displayName', label: 'Nombre visible', required: true, value: target.displayName },
            { name: 'role', label: 'Rol', type: 'select', options: ['support', 'operations', 'supervisor', 'admin'], required: true, value: target.role },
            { name: 'active', label: 'Activo', type: 'select', options: ['true', 'false'], required: true, value: String(target.active) },
          ],
          confirmLabel: 'Guardar cambios',
        });
        await api(`/panel/api/users/${userId}`, {
          method: 'PATCH',
          body: { ...values, active: values.active === 'true' },
        });
      }

      if (action === 'reset-password') {
        await requestStepUpIfNeeded('user-reset-password');
        const values = await openModal({
          title: 'Reset de contraseña',
          description: 'La cuenta perderá sus sesiones activas y quedará obligada a reconfigurar acceso.',
          fields: [{ name: 'newPassword', label: 'Nueva contraseña temporal', type: 'password', required: true }],
          confirmLabel: 'Resetear',
          danger: true,
        });
        if (!isStrongPassword(values.newPassword)) {
          throw new Error(passwordStrengthMessage);
        }
        await api(`/panel/api/users/${userId}/reset-password`, { method: 'POST', body: values });
      }

      if (action === 'reset-2fa') {
        await requestStepUpIfNeeded('user-reset-2fa');
        await api(`/panel/api/users/${userId}/reset-2fa`, { method: 'POST' });
      }

      showTransientMessage('success', 'Cambio aplicado sobre el usuario.');
      await renderUsers();
    });
  });
}

async function renderProfile() {
  renderTopbar('Perfil y seguridad', 'Cuenta interna, sesiones y actividad reciente.');
  const [sessions, activity] = await Promise.all([
    api('/panel/api/auth/sessions'),
    api('/panel/api/profile/activity'),
  ]);

  document.getElementById('page-content').innerHTML = `
    <section class="grid">
      <article class="card"><div class="card-content stack">
        <div class="section-header"><div><h2>Tu cuenta</h2><p>Datos actuales y controles personales.</p></div></div>
        <div class="detail-grid">
          <div class="detail-item"><span>Nombre</span><strong>${escapeHtml(state.me.user.displayName)}</strong></div>
          <div class="detail-item"><span>Correo</span><strong>${escapeHtml(state.me.user.email)}</strong></div>
          <div class="detail-item"><span>Rol</span><strong>${escapeHtml(state.me.user.role)}</strong></div>
          <div class="detail-item"><span>2FA</span><strong>${state.me.user.twoFactorEnabled ? 'Activo' : 'Pendiente'}</strong></div>
        </div>
        <div class="toolbar">
          <button class="btn-secondary" id="change-password-button">Cambiar contraseña</button>
          <button class="btn-secondary" id="start-2fa-button">Regenerar 2FA</button>
          <button class="btn-ghost" id="close-other-sessions-button">Cerrar otras sesiones</button>
        </div>
      </div></article>
      <article class="card"><div class="card-content stack">
        <div class="section-header"><div><h2>Sesiones activas</h2><p>Control de sesiones abiertas del usuario actual.</p></div></div>
        <div class="stack">
          ${
            sessions.length
              ? sessions
                  .map(
                    (session) => `
                      <div class="notice">
                        <strong>${session.current ? 'Sesión actual' : 'Sesión abierta'}</strong>
                        <div class="muted">${escapeHtml(session.ipAddress ?? 'IP desconocida')} · ${escapeHtml(session.userAgent ?? 'Sin user-agent')}</div>
                        <div class="muted">${formatDate(session.lastSeenAt)} · expira ${formatDate(session.expiresAt)}</div>
                      </div>
                    `,
                  )
                  .join('')
              : '<div class="empty-state">No se encontraron sesiones activas.</div>'
          }
        </div>
      </div></article>
      <article class="card"><div class="card-content stack">
        <div class="section-header"><div><h2>Actividad reciente de seguridad</h2><p>Últimos eventos auth y security del usuario.</p></div></div>
        <div class="stack">
          ${
            activity.length
              ? activity
                  .map(
                    (item) => `
                      <div class="notice">
                        <strong>${escapeHtml(item.action)}</strong>
                        <div class="muted">${formatDate(item.createdAt)} · ${escapeHtml(item.ipAddress ?? '—')}</div>
                      </div>
                    `,
                  )
                  .join('')
              : '<div class="empty-state">Sin actividad reciente.</div>'
          }
        </div>
      </div></article>
    </section>
  `;

  document.getElementById('change-password-button').addEventListener('click', async () => {
    const values = await openModal({
      title: 'Cambiar contraseña',
      description: 'La contraseña nueva debe ser robusta y puedes cerrar las demás sesiones al guardarla.',
      fields: [
        { name: 'currentPassword', label: 'Contraseña actual', type: 'password', required: true },
        { name: 'newPassword', label: 'Nueva contraseña', type: 'password', required: true },
        { name: 'revokeOtherSessions', label: 'Cerrar otras sesiones', type: 'select', options: ['true', 'false'], required: true, value: 'true' },
      ],
      confirmLabel: 'Actualizar contraseña',
    });
    await api('/panel/api/auth/password/change', {
      method: 'POST',
      body: { ...values, revokeOtherSessions: values.revokeOtherSessions === 'true' },
    });
    showTransientMessage('success', 'Contraseña actualizada.');
    await renderProfile();
  });

  document.getElementById('start-2fa-button').addEventListener('click', async () => {
    await requestStepUpIfNeeded('settings-save');
    await renderTwoFactorSetup();
  });

  document.getElementById('close-other-sessions-button').addEventListener('click', async () => {
    await api('/panel/api/auth/sessions/close-others', { method: 'POST' });
    showTransientMessage('success', 'Las demás sesiones fueron cerradas.');
    await renderProfile();
  });
}

function buildFieldHtml(field) {
  if (field.type === 'textarea') {
    return `<textarea name="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}>${escapeHtml(field.value ?? '')}</textarea>`;
  }

  if (field.type === 'select') {
    return `
      <select name="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}>
        ${field.options
          .map(
            (option) =>
              `<option value="${escapeHtml(option)}" ${String(field.value ?? '') === option ? 'selected' : ''}>${escapeHtml(option)}</option>`,
          )
          .join('')}
      </select>
    `;
  }

  return `<input name="${escapeHtml(field.name)}" type="${field.type ?? 'text'}" value="${escapeHtml(field.value ?? '')}" ${field.required ? 'required' : ''} />`;
}

function openModal({ title, description, fields, confirmLabel, danger = false }) {
  return new Promise((resolve, reject) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${escapeHtml(description)}</p>
        <form id="modal-form" class="stack">
          ${fields
            .map(
              (field) => `
                <div class="field">
                  <label>${escapeHtml(field.label)}</label>
                  ${buildFieldHtml(field)}
                </div>
              `,
            )
            .join('')}
          <div class="modal-actions">
            <button type="button" class="btn-ghost" id="modal-cancel">Cancelar</button>
            <button type="submit" class="${danger ? 'btn-danger' : 'btn'}">${escapeHtml(confirmLabel)}</button>
          </div>
        </form>
      </div>
    `;

    const close = () => backdrop.remove();
    backdrop.querySelector('#modal-cancel').addEventListener('click', () => {
      close();
      reject(new Error('Operación cancelada por el usuario.'));
    });
    backdrop.querySelector('#modal-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const values = {};
      for (const [key, value] of form.entries()) {
        values[key] = String(value);
      }
      close();
      resolve(values);
    });

    document.body.appendChild(backdrop);
  });
}

async function downloadFile(path, filename, accept = 'application/octet-stream') {
  const response = await fetch(path, {
    method: 'GET',
    headers: {
      Accept: accept,
    },
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? 'No fue posible generar la exportacion.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function renderDashboardView() {
  renderTopbar('Dashboard operativo', 'Resumen instantaneo de ordenes, alertas y cola operativa.');
  const data = await api('/panel/api/dashboard');
  const metrics = [
    {
      label: 'Ordenes activas',
      value: data.activeOrders,
      subtext: 'Pendientes o en ejecucion',
      tone: 'info',
    },
    {
      label: 'Errores abiertos',
      value: data.errorOrders,
      subtext: 'Retryable o revision manual',
      tone: data.errorOrders > 0 ? 'danger' : 'neutral',
    },
    {
      label: 'Revision manual',
      value: data.manualReviewOrders,
      subtext: 'Casos detenidos por control',
      tone: data.manualReviewOrders > 0 ? 'warn' : 'neutral',
    },
    {
      label: 'BUY de hoy',
      value: data.buyToday,
      subtext: `${formatUsdt(data.volumeBoughtUsdt)} USDT enviados`,
      tone: 'neutral',
      trend: data.comparisons?.buyToday,
    },
    {
      label: 'SELL de hoy',
      value: data.sellToday,
      subtext: `${formatUsdt(data.volumeSoldUsdt)} USDT detectados`,
      tone: 'neutral',
      trend: data.comparisons?.sellToday,
    },
    {
      label: 'Completadas hoy',
      value: data.completedToday,
      subtext: 'Cierre exitoso',
      tone: 'ok',
      trend: data.comparisons?.completedToday,
    },
    {
      label: 'Expiradas hoy',
      value: data.expiredToday,
      subtext: 'Sin continuacion automatica',
      tone: data.expiredToday > 0 ? 'warn' : 'neutral',
    },
    {
      label: 'Webhooks rechazados',
      value: data.rejectedWebhooks,
      subtext: 'Pendientes de revisar',
      tone: data.rejectedWebhooks > 0 ? 'danger' : 'neutral',
    },
  ];

  document.getElementById('page-content').innerHTML = `
    <section class="grid card-grid">
      ${metrics
        .map(
          (metric) => `
            <article class="card metric-card ${metric.tone !== 'neutral' ? `metric-card-${metric.tone}` : ''}">
              <div class="card-content">
                <div class="metric-header">
                  <div class="metric-label">${escapeHtml(metric.label)}</div>
                  ${getTrendMarkup(metric.trend)}
                </div>
                <div class="metric-value">${escapeHtml(metric.value)}</div>
                <div class="metric-subtext">${escapeHtml(metric.subtext)}</div>
              </div>
            </article>
          `,
        )
        .join('')}
    </section>
    <section class="split-layout">
      <article class="card">
        <div class="card-content stack">
          <div class="section-header">
            <div>
              <h2>Volumen y comparativa</h2>
              <p>Hoy contra ayer con tendencia basica.</p>
            </div>
          </div>
          <div class="detail-grid">
            <div class="detail-item">
              <span>Volumen BUY COP</span>
              <strong>${formatMoney(data.volumeBoughtFiat)}</strong>
              ${getTrendMarkup(data.comparisons?.volumeBoughtFiat, ' COP')}
            </div>
            <div class="detail-item">
              <span>Volumen SELL COP</span>
              <strong>${formatMoney(data.volumeSoldFiat)}</strong>
              ${getTrendMarkup(data.comparisons?.volumeSoldFiat, ' COP')}
            </div>
            <div class="detail-item"><span>USDT BUY</span><strong>${formatUsdt(data.volumeBoughtUsdt)}</strong></div>
            <div class="detail-item"><span>USDT SELL</span><strong>${formatUsdt(data.volumeSoldUsdt)}</strong></div>
            <div class="detail-item"><span>Reconciliaciones pendientes</span><strong>${escapeHtml(data.pendingReconciliations)}</strong></div>
          </div>
        </div>
      </article>
      <article class="card">
        <div class="card-content stack">
          <div class="section-header">
            <div>
              <h2>Alertas recientes</h2>
              <p>Ordenes que requieren atencion inmediata.</p>
            </div>
          </div>
          ${
            data.recentAlerts.length
              ? data.recentAlerts
                  .map(
                    (alert) => `
                      <div class="notice notice-alert">
                        <strong>${escapeHtml(alert.orderId)} | ${escapeHtml(alert.type)} | ${escapeHtml(alert.status)}</strong>
                        <div class="muted">${escapeHtml(alert.lastErrorCode ?? 'Sin codigo')} | ${escapeHtml(alert.lastErrorMessage ?? 'Sin mensaje')}</div>
                        <div class="muted">${escapeHtml(alert.terminalId ?? 'Sin terminal')} | ${formatDate(alert.updatedAt)}</div>
                      </div>
                    `,
                  )
                  .join('')
              : buildEmptyState('Sin alertas recientes', 'No hay ordenes criticas en este momento.')
          }
        </div>
      </article>
    </section>
  `;
}

async function renderAuditView() {
  renderTopbar('Auditoria interna', 'Accesos, cambios sensibles y trazabilidad operativa del panel.');
  document.getElementById('page-content').innerHTML = `
    <section class="card">
      <div class="card-content stack">
        <form id="audit-filters" class="filters">
          <div class="field">
            <label>Categoria</label>
            <select name="category">
              <option value="">Todas</option>
              <option value="auth">auth</option>
              <option value="security">security</option>
              <option value="orders">orders</option>
              <option value="settings">settings</option>
              <option value="users">users</option>
              <option value="reports">reports</option>
            </select>
          </div>
          <div class="field"><label>Accion</label><input name="action" placeholder="order_action_cancel, login_success..." /></div>
          <div class="field"><label>Usuario</label><input name="actorUserId" placeholder="ID de usuario" /></div>
          <div class="field"><label>Orden</label><input name="orderId" placeholder="ord_..." /></div>
          <div class="field"><label>Desde</label><input type="datetime-local" name="dateFrom" /></div>
          <div class="field"><label>Hasta</label><input type="datetime-local" name="dateTo" /></div>
          <div class="field" style="flex:0 0 auto; align-self:end;">
            <button class="btn-secondary" type="submit">Filtrar</button>
          </div>
        </form>
        <div id="audit-result">${buildLoader('Cargando auditoria...')}</div>
      </div>
    </section>
  `;

  document.getElementById('audit-filters').addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadAuditLogsView(new FormData(event.currentTarget));
  });

  await loadAuditLogsView();
}

async function loadAuditLogsView(formData = null) {
  const params = buildQueryParams(formData);
  const data = await api(`/panel/api/audit/logs?${params.toString()}`);

  document.getElementById('audit-result').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Categoria</th>
            <th>Accion</th>
            <th>Usuario</th>
            <th>Estado</th>
            <th>Target</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          ${
            data.length
              ? data
                  .map(
                    (log) => `
                      <tr>
                        <td>${formatDate(log.createdAt)}</td>
                        <td>${escapeHtml(log.category)}</td>
                        <td><strong>${escapeHtml(log.action)}</strong><div class="muted">${escapeHtml(log.metadata?.reason ?? '')}</div></td>
                        <td>${escapeHtml(log.actorEmail ?? 'Sistema')}</td>
                        <td>${escapeHtml(log.metadata?.previousStatus ?? '—')} -> ${escapeHtml(log.metadata?.newStatus ?? '—')}</td>
                        <td>${escapeHtml(log.targetType ?? '—')} | ${escapeHtml(log.targetId ?? '—')}</td>
                        <td>${escapeHtml(log.ipAddress ?? '—')}</td>
                      </tr>
                    `,
                  )
                  .join('')
              : `<tr><td colspan="7">${buildEmptyState('Sin resultados', 'No hay eventos de auditoria con esos filtros.')}</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

async function renderReportsView() {
  renderTopbar(
    'Reportes',
    'Consulta por rango, resumen agregado y exportacion CSV o PDF.',
  );

  document.getElementById('page-content').innerHTML = `
    <section class="card">
      <div class="card-content stack">
        <form id="report-filters" class="filters">
          <div class="field">
            <label>Preset</label>
            <select name="preset" id="report-preset">
              <option value="today">Hoy</option>
              <option value="week">Esta semana</option>
              <option value="month">Este mes</option>
              <option value="year">Este ano</option>
              <option value="custom">Rango personalizado</option>
            </select>
          </div>
          <div class="field"><label>Desde</label><input type="datetime-local" name="dateFrom" id="report-date-from" disabled /></div>
          <div class="field"><label>Hasta</label><input type="datetime-local" name="dateTo" id="report-date-to" disabled /></div>
          <div class="field"><label>Tipo</label><select name="type"><option value="">Todos</option><option value="BUY">BUY</option><option value="SELL">SELL</option></select></div>
          <div class="field"><label>Estado</label><input name="status" placeholder="COMPLETED, ERROR_RETRYABLE..." /></div>
          <div class="field"><label>Terminal</label><input name="terminalId" placeholder="batm-001" /></div>
          <div class="field" style="flex:0 0 auto; align-self:end;"><button class="btn-secondary" type="submit">Generar</button></div>
          <div class="field" style="flex:0 0 auto; align-self:end;"><button class="btn" type="button" id="export-csv">Exportar CSV</button></div>
          <div class="field" style="flex:0 0 auto; align-self:end;"><button class="btn" type="button" id="export-pdf">Exportar PDF</button></div>
        </form>
        <div id="report-result">${buildLoader('Generando reporte...')}</div>
      </div>
    </section>
  `;

  const toggleReportRange = () => {
    const preset = document.getElementById('report-preset').value;
    const custom = preset === 'custom';
    document.getElementById('report-date-from').disabled = !custom;
    document.getElementById('report-date-to').disabled = !custom;
  };

  document.getElementById('report-preset').addEventListener('change', toggleReportRange);
  toggleReportRange();

  document.getElementById('report-filters').addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadReportView(new FormData(event.currentTarget));
  });

  document.getElementById('export-csv').addEventListener('click', async () => {
    const params = buildQueryParams(new FormData(document.getElementById('report-filters')), {
      includeTimezone: true,
    });
    await downloadFile(
      `/panel/api/reports/orders/export.csv?${params.toString()}`,
      'operaciones.csv',
      'text/csv',
    );
  });

  document.getElementById('export-pdf').addEventListener('click', async () => {
    const params = buildQueryParams(new FormData(document.getElementById('report-filters')), {
      includeTimezone: true,
    });
    await downloadFile(
      `/panel/api/reports/orders/export.pdf?${params.toString()}`,
      'operaciones.pdf',
      'application/pdf',
    );
  });

  await loadReportView();
}

async function loadReportView(formData = null) {
  const params = buildQueryParams(formData, { includeTimezone: true });
  if (!params.has('preset')) {
    params.set('preset', 'today');
  }

  const report = await api(`/panel/api/reports/orders?${params.toString()}`);
  document.getElementById('report-result').innerHTML = `
    <div class="report-summary">
      <div class="grid card-grid">
        <article class="card metric-card"><div class="card-content"><div class="metric-label">Total</div><div class="metric-value">${escapeHtml(report.summary.total)}</div><div class="metric-subtext">${escapeHtml(report.filters.presetLabel)}</div></div></article>
        <article class="card metric-card"><div class="card-content"><div class="metric-label">BUY</div><div class="metric-value">${escapeHtml(report.summary.buyCount)}</div><div class="metric-subtext">${formatMoney(report.summary.totalFiatBuy)}</div></div></article>
        <article class="card metric-card"><div class="card-content"><div class="metric-label">SELL</div><div class="metric-value">${escapeHtml(report.summary.sellCount)}</div><div class="metric-subtext">${formatMoney(report.summary.totalFiatSell)}</div></div></article>
        <article class="card metric-card"><div class="card-content"><div class="metric-label">Completadas</div><div class="metric-value">${escapeHtml(report.summary.completed)}</div><div class="metric-subtext">Fallidas ${escapeHtml(report.summary.failed)}</div></div></article>
      </div>
      <div class="notice">
        <strong>Filtros aplicados</strong>
        <div class="muted">Rango: ${escapeHtml(report.filters.dateFrom ?? 'sin inicio')} | ${escapeHtml(report.filters.dateTo ?? 'sin fin')}</div>
        <div class="muted">Tipo: ${escapeHtml(report.filters.type ?? 'todos')} | Estado: ${escapeHtml(report.filters.status ?? 'todos')} | Terminal: ${escapeHtml(report.filters.terminalId ?? 'todas')}</div>
        <div class="muted">USDT enviados BUY: ${formatUsdt(report.summary.totalUsdtSent)} | USDT recibidos SELL: ${formatUsdt(report.summary.totalUsdtReceived)} | Promedio min: ${escapeHtml(report.summary.averageProcessingMinutes ?? 'n/a')}</div>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Orden</th>
            <th>Tipo</th>
            <th>Estado</th>
            <th>Montos</th>
            <th>Direcciones</th>
            <th>TXID</th>
            <th>Terminal / Ref</th>
            <th>Timestamps</th>
          </tr>
        </thead>
        <tbody>
          ${
            report.rows.length
              ? report.rows
                  .map(
                    (row) => `
                      <tr>
                        <td><strong>${escapeHtml(row.orderId)}</strong></td>
                        <td>${escapeHtml(row.type)}</td>
                        <td>${renderStatusBadge(row.status, row.manualReviewRequired)}</td>
                        <td>
                          <div>${formatMoney(row.fiatAmount)}</div>
                          <div class="muted">${formatUsdt(row.cryptoAmountToSend ?? row.cryptoAmountReceived ?? row.cryptoAmountExpected ?? 0)} USDT</div>
                        </td>
                        <td>
                          <div class="code">${escapeHtml(row.depositAddress ?? '—')}</div>
                          <div class="code">${escapeHtml(row.customerDestinationAddress ?? row.buySenderAddress ?? '—')}</div>
                        </td>
                        <td class="code">${escapeHtml(row.providerSendTxid ?? row.providerForwardTxid ?? '—')}</td>
                        <td>
                          <div>${escapeHtml(row.terminalId ?? '—')}</div>
                          <div class="muted">${escapeHtml(row.externalRef ?? '—')}</div>
                        </td>
                        <td>
                          <div>${formatDate(row.createdAt)}</div>
                          <div class="muted">${formatDate(row.completedAt ?? row.updatedAt)}</div>
                        </td>
                      </tr>
                    `,
                  )
                  .join('')
              : `<tr><td colspan="8">${buildEmptyState('Sin datos', 'No hay operaciones para ese rango y filtros.')}</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function collectSettingsFormItems(filterKeys = null) {
  const form = new FormData(document.getElementById('settings-form'));
  const items = [];

  for (const [key, value] of form.entries()) {
    if (filterKeys && !filterKeys.includes(String(key))) {
      continue;
    }

    if (String(value).trim() !== '') {
      items.push({ key, value: String(value) });
    }
  }

  return items;
}

async function runSettingsConnectionTest(provider) {
  await requestStepUpIfNeeded('settings-test');

  const providerKeys =
    provider === 'cryptocurrencyapi'
      ? [
          'CRYPTOCURRENCY_API_BASE_URL',
          'CRYPTOCURRENCY_API_KEY',
          'CRYPTOCURRENCY_API_TIMEOUT_MS',
        ]
      : [
          'ITRX_API_BASE_URL',
          'ITRX_API_KEY',
          'ITRX_API_SECRET',
          'ITRX_API_TIMEOUT_MS',
          'TRON_FORWARD_TARGET_ADDRESS',
        ];

  const result = await api('/panel/api/settings/test-connection', {
    method: 'POST',
    body: {
      provider,
      items: collectSettingsFormItems(providerKeys),
    },
  });

  showTransientMessage(
    result.ok ? 'success' : 'error',
    `${provider}: ${result.message}`,
  );
}

async function renderSettingsView() {
  renderTopbar(
    'Configuracion',
    'Overrides operativos almacenados de forma segura. Los cambios sensibles requieren reautenticacion y aplican tras reiniciar.',
    `
      <button class="btn-secondary" id="test-crypto-connection">Probar CryptoCurrencyAPI</button>
      <button class="btn-secondary" id="test-itrx-connection">Probar iTRX</button>
      <button class="btn" id="save-settings">Guardar cambios</button>
    `,
  );
  const settings = await api('/panel/api/settings');

  document.getElementById('page-content').innerHTML = `
    <section class="card">
      <div class="card-content stack">
        <div class="notice">
          <strong>Fuente de verdad operativa</strong>
          <div class="muted">El sistema sigue arrancando desde .env. El panel guarda overrides seguros en Mongo y los aplica en el siguiente reinicio controlado.</div>
        </div>
        <form id="settings-form" class="stack">
          ${settings
            .map(
              (setting) => `
                <div class="detail-item">
                  <div class="section-header">
                    <div>
                      <h3>${escapeHtml(setting.label)}</h3>
                      <p>${escapeHtml(setting.description)}</p>
                    </div>
                    <div class="pill-row">
                      <span class="badge ${setting.isSecret ? 'warn' : 'info'}">${escapeHtml(setting.category)}</span>
                      <span class="badge ${setting.appliesOnRestart ? 'warn' : 'ok'}">${setting.appliesOnRestart ? 'requiere reinicio' : 'runtime'}</span>
                    </div>
                  </div>
                  <div class="detail-grid">
                    <div class="detail-item"><span>Valor actual</span><strong class="code">${escapeHtml(setting.currentValueMasked ?? 'No definido')}</strong></div>
                    <div class="detail-item"><span>Override BD</span><strong class="code">${escapeHtml(setting.overrideValueMasked ?? 'Sin override')}</strong></div>
                    <div class="field">
                      <label>Nuevo valor</label>
                      ${
                        setting.options
                          ? `<select name="${escapeHtml(setting.key)}"><option value="">Sin cambio</option>${setting.options
                              .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
                              .join('')}</select>`
                          : `<input name="${escapeHtml(setting.key)}" type="${setting.isSecret ? 'password' : setting.type === 'number' ? 'number' : setting.key.endsWith('_BASE_URL') ? 'url' : 'text'}" placeholder="${setting.isSecret ? 'Ingresar nuevo secreto' : 'Sin cambio'}" />`
                      }
                    </div>
                  </div>
                </div>
              `,
            )
            .join('')}
        </form>
      </div>
    </section>
  `;

  document.getElementById('test-crypto-connection').addEventListener('click', async () => {
    await runSettingsConnectionTest('cryptocurrencyapi');
  });
  document.getElementById('test-itrx-connection').addEventListener('click', async () => {
    await runSettingsConnectionTest('itrx');
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    await requestStepUpIfNeeded('settings-save');
    const items = collectSettingsFormItems();
    if (!items.length) {
      showTransientMessage('error', 'No hay cambios para guardar.');
      return;
    }

    if (doubleConfirmationActions.has('settings-save')) {
      const confirmation = await openModal({
        title: 'Confirmacion final',
        description:
          'Se guardaran cambios sensibles. Confirma escribiendo CONFIRMAR para continuar.',
        fields: [{ name: 'confirmation', label: 'Escribe CONFIRMAR', required: true }],
        confirmLabel: 'Guardar configuracion',
        danger: true,
      });

      if (String(confirmation.confirmation).trim().toUpperCase() !== 'CONFIRMAR') {
        throw new Error('La confirmacion final no coincide.');
      }
    }

    await api('/panel/api/settings', { method: 'PUT', body: { items } });
    showTransientMessage('success', 'Configuracion guardada. Se aplicara tras reiniciar la app.');
    await renderSettingsView();
  });
}

async function renderProfileView() {
  renderTopbar('Perfil y seguridad', 'Cuenta interna, sesiones activas y actividad reciente.');
  const [sessions, activity] = await Promise.all([
    api('/panel/api/auth/sessions'),
    api('/panel/api/profile/activity'),
  ]);
  const lastAccesses = activity.filter((item) => item.action === 'login_success').slice(0, 5);

  document.getElementById('page-content').innerHTML = `
    <section class="grid">
      <article class="card"><div class="card-content stack">
        <div class="section-header"><div><h2>Tu cuenta</h2><p>Datos actuales y controles personales.</p></div></div>
        <div class="detail-grid">
          <div class="detail-item"><span>Nombre</span><strong>${escapeHtml(state.me.user.displayName)}</strong></div>
          <div class="detail-item"><span>Correo</span><strong>${escapeHtml(state.me.user.email)}</strong></div>
          <div class="detail-item"><span>Rol</span><strong>${escapeHtml(state.me.user.role)}</strong></div>
          <div class="detail-item"><span>2FA</span><strong>${state.me.user.twoFactorEnabled ? 'Activo' : 'Pendiente'}</strong></div>
        </div>
        <div class="toolbar">
          <button class="btn-secondary" id="change-password-button">Cambiar contrasena</button>
          <button class="btn-secondary" id="start-2fa-button">Regenerar 2FA</button>
          <button class="btn-ghost" id="close-other-sessions-button">Cerrar otras sesiones</button>
        </div>
      </div></article>
      <article class="card"><div class="card-content stack">
        <div class="section-header"><div><h2>Sesiones activas</h2><p>Control de sesiones abiertas del usuario actual.</p></div></div>
        <div class="stack">
          ${
            sessions.length
              ? sessions
                  .map(
                    (session) => `
                      <div class="notice ${session.current ? 'notice-current' : ''}">
                        <strong>${session.current ? 'Sesion actual' : 'Sesion abierta'}</strong>
                        <div class="muted">${escapeHtml(session.ipAddress ?? 'IP desconocida')} | ${escapeHtml(session.userAgent ?? 'Sin user-agent')}</div>
                        <div class="muted">${formatDate(session.lastSeenAt)} | expira ${formatDate(session.expiresAt)}</div>
                      </div>
                    `,
                  )
                  .join('')
              : buildEmptyState('Sin sesiones activas', 'No se encontraron sesiones abiertas.')
          }
        </div>
      </div></article>
      <article class="card"><div class="card-content stack">
        <div class="section-header"><div><h2>Ultimos accesos</h2><p>Eventos recientes de auth y seguridad.</p></div></div>
        <div class="stack">
          ${
            lastAccesses.length
              ? lastAccesses
                  .map(
                    (item) => `
                      <div class="notice">
                        <strong>${formatDate(item.createdAt)}</strong>
                        <div class="muted">${escapeHtml(item.ipAddress ?? 'IP desconocida')} | ${escapeHtml(item.userAgent ?? 'Sin user-agent')}</div>
                      </div>
                    `,
                  )
                  .join('')
              : buildEmptyState('Sin accesos recientes', 'No hay accesos registrados para mostrar.')
          }
        </div>
      </div></article>
    </section>
  `;

  document.getElementById('change-password-button').addEventListener('click', async () => {
    await requestStepUpIfNeeded('password-change');
    const values = await openModal({
      title: 'Cambiar contrasena',
      description:
        'La nueva contrasena debe ser robusta. Puedes cerrar las demas sesiones al guardar.',
      fields: [
        { name: 'currentPassword', label: 'Contrasena actual', type: 'password', required: true },
        { name: 'newPassword', label: 'Nueva contrasena', type: 'password', required: true },
        { name: 'revokeOtherSessions', label: 'Cerrar otras sesiones', type: 'select', options: ['true', 'false'], required: true, value: 'true' },
      ],
      confirmLabel: 'Actualizar contrasena',
    });

    if (!isStrongPassword(values.newPassword)) {
      throw new Error(passwordStrengthMessage);
    }

    await api('/panel/api/auth/password/change', {
      method: 'POST',
      body: { ...values, revokeOtherSessions: values.revokeOtherSessions === 'true' },
    });
    showTransientMessage('success', 'Contrasena actualizada.');
    await renderProfileView();
  });

  document.getElementById('start-2fa-button').addEventListener('click', async () => {
    await requestStepUpIfNeeded('reconfigure-2fa');
    await renderTwoFactorSetup();
  });

  document.getElementById('close-other-sessions-button').addEventListener('click', async () => {
    await requestStepUpIfNeeded('close-other-sessions');
    await api('/panel/api/auth/sessions/close-others', { method: 'POST' });
    showTransientMessage('success', 'Las demas sesiones fueron cerradas.');
    await renderProfileView();
  });
}

async function boot() {
  try {
    const me = await api('/panel/api/auth/me');
    state.me = me;
    state.csrfToken = me.csrfToken;

    if (me.requiresTwoFactorSetup) {
      await renderTwoFactorSetup();
      return;
    }

    renderShell();
    await renderCurrentView();
  } catch (error) {
    renderLogin(error?.statusCode === 401 ? null : error.message);
  }
}

window.addEventListener('hashchange', async () => {
  if (!state.me) return;
  state.sidebarOpen = false;
  resolveCurrentView();
  renderShell();
  await renderCurrentView();
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 1120 && state.sidebarOpen) {
    setSidebarOpen(false);
  }
});

boot();
