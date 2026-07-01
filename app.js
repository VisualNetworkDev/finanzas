const CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbzMdsCVqnA9VUbXPZP3b_xBvUcCIlbKM7MFw5RoqowR5gmo_RTXHmP5dzmNpLqvwVy5/exec',
  timeoutMs: 45000
};

const NAV = [
  ['dashboard', 'Dashboard', 'layout-dashboard'],
  ['accounts', 'Cuentas', 'wallet'],
  ['incomes', 'Ingresos', 'banknote'],
  ['paychecks', 'Cheques', 'badge-dollar-sign'],
  ['bills', 'Pagos', 'receipt'],
  ['debts', 'Deudas', 'trending-down'],
  ['shifts', 'Turnos', 'clock'],
  ['calendar', 'Calendario', 'calendar-days'],
  ['whatnow', 'Que hago ahora', 'circle-help'],
  ['checklist', 'Checklist', 'list-checks'],
  ['notifications', 'Alertas', 'bell'],
  ['settings', 'Configuracion', 'settings']
];

const state = {
  token: localStorage.getItem('mcf_token') || '',
  user: null,
  activeView: localStorage.getItem('mcf_view') || 'dashboard',
  cache: {}
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener('DOMContentLoaded', init);

function init() {
  renderNav();
  bindShell();
  if (state.token) {
    validateSavedSession();
  } else {
    showLogin();
  }
  refreshIcons();
}

function bindShell() {
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#logoutButton').addEventListener('click', handleLogout);
  $('#refreshButton').addEventListener('click', () => renderView(state.activeView, true));
  $('#menuToggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
  $('#forcedPasswordForm').addEventListener('submit', handleForcedPassword);
  document.addEventListener('click', handlePasswordToggle);
}

function renderNav() {
  $('#mainNav').innerHTML = NAV.map(([id, label, icon]) => `
    <button class="nav-item ${id === state.activeView ? 'active' : ''}" data-view="${id}" type="button">
      <i data-lucide="${icon}"></i>
      <span>${label}</span>
    </button>
  `).join('');

  $$('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      $('.sidebar').classList.remove('open');
      renderView(button.dataset.view);
    });
  });
}

async function validateSavedSession() {
  try {
    const data = await api('validateSession');
    state.user = data.user;
    state.cache.settings = data.settings || {};
    showApp();
    toggleForcedPassword(Boolean(state.user.mustChangePassword));
    await renderView(state.activeView, true);
  } catch (error) {
    localStorage.removeItem('mcf_token');
    state.token = '';
    showLogin();
    toast(error.message || 'Sesion vencida.');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const payload = formValues(event.currentTarget);
  try {
    setBusy(true);
    const data = await api('login', payload, { skipToken: true });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('mcf_token', state.token);
    showApp();
    toggleForcedPassword(Boolean(state.user.mustChangePassword));
    await renderView(state.user.mustChangePassword ? 'settings' : state.activeView, true);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function handleLogout() {
  try {
    if (state.token) {
      await api('logout', { token: state.token });
    }
  } catch (error) {
    console.warn(error);
  }
  state.token = '';
  state.user = null;
  localStorage.removeItem('mcf_token');
  showLogin();
}

async function handleForcedPassword(event) {
  event.preventDefault();
  const payload = formValues(event.currentTarget);
  try {
    setBusy(true);
    await api('changePassword', payload);
    state.user.mustChangePassword = false;
    toggleForcedPassword(false);
    event.currentTarget.reset();
    toast('Contrasena actualizada.');
    await renderView('dashboard', true);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function showLogin() {
  $('#loginScreen').classList.remove('hidden');
  $('#appShell').classList.add('hidden');
  setBusy(false);
  refreshIcons();
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  refreshIcons();
}

function toggleForcedPassword(show) {
  $('#forcedPassword').classList.toggle('hidden', !show);
}

async function renderView(viewId, force = false) {
  state.activeView = viewId;
  localStorage.setItem('mcf_view', viewId);
  renderNav();
  const item = NAV.find(([id]) => id === viewId) || NAV[0];
  $('#eyebrow').textContent = item[1];
  $('#viewTitle').textContent = item[1];
  $('#view').innerHTML = '<div class="empty">Cargando...</div>';
  setBusy(true);

  try {
    const renderers = {
      dashboard: renderDashboard,
      accounts: renderAccounts,
      incomes: renderIncomes,
      paychecks: renderPaychecks,
      bills: renderBills,
      debts: renderDebts,
      shifts: renderShifts,
      calendar: renderCalendar,
      whatnow: renderWhatNow,
      checklist: renderChecklist,
      notifications: renderNotifications,
      settings: renderSettings
    };
    await (renderers[viewId] || renderDashboard)(force);
  } catch (error) {
    $('#view').innerHTML = `<div class="empty">${escapeHtml(error.message || 'No se pudo cargar.')}</div>`;
  } finally {
    setBusy(false);
    refreshIcons();
  }
}

async function renderDashboard() {
  const data = await api('getDashboardData');
  state.cache.dashboard = data;
  state.cache.accounts = data.accounts || [];
  state.cache.incomeSources = data.incomeSources || [];

  $('#view').innerHTML = `
    <section class="grid">
      ${metric('Capital One', accountBalance(data.accounts, 'Capital One'), 'Pagos y gastos diarios', 'info')}
      ${metric('VyStar Checking', accountBalance(data.accounts, 'VyStar Checking'), 'Dinero apartado', 'warning')}
      ${metric('VyStar Savings', accountBalance(data.accounts, 'VyStar Savings'), 'No tocar salvo emergencia', 'success')}
      ${metric('Dinero libre real', money(data.totals.freeReal), 'Despues de reservas', data.totals.freeReal < 0 ? 'critical' : 'success')}
    </section>

    <section class="grid">
      <div class="panel span-7">
        <div class="panel-head">
          <div>
            <h3>Action Center</h3>
            <p>Pasos claros para hoy</p>
          </div>
          <span class="badge blue">${escapeHtml(data.recommendation.level)}</span>
        </div>
        <div class="list">
          ${(data.actionCenter || []).map((step) => `
            <div class="item-card">
              <div class="item-row">
                <strong>${escapeHtml(step)}</strong>
                <i data-lucide="arrow-right"></i>
              </div>
            </div>
          `).join('') || empty('Sin pasos pendientes.')}
        </div>
      </div>

      <div class="panel span-5">
        <div class="panel-head">
          <div>
            <h3>Recomendacion</h3>
            <p>${escapeHtml(data.recommendation.title)}</p>
          </div>
          <span class="badge ${levelClass(data.recommendation.level)}">${escapeHtml(data.recommendation.level)}</span>
        </div>
        <p>${escapeHtml(data.recommendation.message)}</p>
        <div class="button-row">
          <button class="action-button primary" data-go="whatnow" type="button"><i data-lucide="circle-help"></i>Calcular ahora</button>
          <button class="action-button secondary" data-go="checklist" type="button"><i data-lucide="list-checks"></i>Checklist</button>
        </div>
      </div>
    </section>

    <section class="grid">
      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Alertas internas</h3>
            <p>${data.alerts.length} activas</p>
          </div>
        </div>
        ${renderAlertList(data.alerts.slice(0, 6))}
      </div>

      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Proximos pagos</h3>
            <p>14 dias</p>
          </div>
        </div>
        ${renderUpcomingBills(data.upcomingBills.slice(0, 7))}
      </div>
    </section>

    <section class="grid">
      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Cheques por verificar</h3>
            <p>No cuentan como disponible hasta confirmar</p>
          </div>
        </div>
        ${renderPaycheckMini(data.pendingPaychecks)}
      </div>

      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Checklist semanal</h3>
            <p>${escapeHtml(data.checklistProgress.text)}</p>
          </div>
          <span class="badge green">${data.checklistProgress.percent}%</span>
        </div>
        <div class="progress"><span style="width:${data.checklistProgress.percent}%"></span></div>
        <div class="button-row">
          <button class="action-button secondary" data-go="checklist" type="button"><i data-lucide="list-checks"></i>Abrir</button>
        </div>
      </div>
    </section>
  `;

  bindGoButtons();
}

async function renderAccounts() {
  const accounts = await api('getAccounts');
  const transfers = await api('getTransfers', { limit: 20 });
  state.cache.accounts = accounts;
  const accountOptions = options(accounts, 'id', 'name');

  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Cuenta manual</h3></div>
        <form id="accountForm" class="form-grid">
          <input type="hidden" name="id">
          <label>Nombre<input name="name" required></label>
          <label>Tipo
            <select name="type">
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="cash">Cash</option>
            </select>
          </label>
          <label>Balance<input name="currentBalance" type="number" step="0.01" value="0" required></label>
          <label class="full">Proposito<textarea name="purpose"></textarea></label>
          <label><input class="check-toggle" name="isProtected" type="checkbox"> No tocar</label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
            <button class="action-button secondary" type="reset"><i data-lucide="rotate-ccw"></i>Limpiar</button>
          </div>
        </form>
      </div>

      <div class="panel span-7">
        <div class="panel-head"><h3>Balances</h3></div>
        <div class="list">
          ${accounts.map((account) => `
            <article class="item-card">
              <div class="item-row">
                <div>
                  <strong>${escapeHtml(account.name)}</strong>
                  <div class="muted">${escapeHtml(account.purpose || account.type)}</div>
                </div>
                <span class="amount">${money(account.currentBalance)}</span>
              </div>
              <form class="inline-form balance-form" data-id="${escapeHtml(account.id)}">
                <input name="currentBalance" type="number" step="0.01" value="${Number(account.currentBalance || 0)}">
                <button class="action-button secondary" type="submit"><i data-lucide="refresh-cw"></i>Actualizar</button>
                <button class="action-button secondary edit-account" data-id="${escapeHtml(account.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>
              </form>
            </article>
          `).join('') || empty('No hay cuentas.')}
        </div>
      </div>
    </section>

    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Transferencia</h3></div>
        <form id="transferForm" class="form-grid">
          <label>Desde<select name="fromAccount" required>${accountOptions}</select></label>
          <label>Hacia<select name="toAccount" required>${accountOptions}</select></label>
          <label>Monto<input name="amount" type="number" step="0.01" required></label>
          <label class="wide">Razon<input name="reason"></label>
          <label class="full">Nota<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="move-right"></i>Registrar</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head"><h3>Historial de transferencias</h3></div>
        ${table(['Fecha', 'Desde', 'Hacia', 'Monto', 'Razon'], transfers.map((transfer) => [
          dateLabel(transfer.date),
          accountName(transfer.fromAccount),
          accountName(transfer.toAccount),
          money(transfer.amount),
          escapeHtml(transfer.reason || '')
        ]))}
      </div>
    </section>
  `;

  $('#accountForm').addEventListener('submit', submitAccount);
  $('#transferForm').addEventListener('submit', submitTransfer);
  $$('.balance-form').forEach((form) => form.addEventListener('submit', submitBalance));
  $$('.edit-account').forEach((button) => button.addEventListener('click', () => fillAccountForm(accounts.find((a) => a.id === button.dataset.id))));
}

async function renderIncomes() {
  const [sources, paychecks, accounts] = await Promise.all([
    api('getIncomeSources'),
    api('getPaychecks', { limit: 40 }),
    api('getAccounts')
  ]);
  state.cache.accounts = accounts;
  state.cache.incomeSources = sources;

  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Fuente de ingreso</h3></div>
        <form id="incomeSourceForm" class="form-grid">
          <input type="hidden" name="id">
          <label class="wide">Nombre<input name="name" required></label>
          <label>Tipo<select name="type"><option value="fixed">Fijo</option><option value="hourly">Por hora</option></select></label>
          <label>Pago por hora<input name="hourlyRate" type="number" step="0.01" value="0"></label>
          <label>Neto fijo<input name="fixedNetPay" type="number" step="0.01" value="0"></label>
          <label>Tax<input name="taxRate" type="number" step="0.001" value="0.12"></label>
          <label>Frecuencia<select name="payFrequency"><option value="weekly">Semanal</option><option value="manual">Manual</option></select></label>
          <label>Dia de cobro<input name="payDay" placeholder="Friday"></label>
          <label>Cuenta<select name="defaultAccount">${options(accounts, 'id', 'name')}</select></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
          </div>
        </form>
      </div>

      <div class="panel span-7">
        <div class="panel-head"><h3>Fuentes registradas</h3></div>
        ${table(['Nombre', 'Tipo', 'Neto fijo', 'Hora', 'Tax', 'Accion'], sources.map((source) => [
          escapeHtml(source.name),
          escapeHtml(source.type),
          money(source.fixedNetPay),
          money(source.hourlyRate),
          percent(source.taxRate),
          `<button class="action-button secondary edit-source" data-id="${escapeHtml(source.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>`
        ]))}
      </div>
    </section>

    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Registrar cheque esperado</h3></div>
        <form id="paycheckForm" class="form-grid">
          <label class="wide">Fuente<select name="incomeSourceId" required>${options(sources, 'id', 'name')}</select></label>
          <label>Fecha esperada<input name="expectedDate" type="date" required value="${todayInput()}"></label>
          <label>Horas<input name="hours" type="number" step="0.01"></label>
          <label>Rate<input name="rate" type="number" step="0.01"></label>
          <label>Bono por hora<input name="bonusRate" type="number" step="0.01" value="0"></label>
          <label>Bono fijo<input name="bonusFixed" type="number" step="0.01" value="0"></label>
          <label>Cuenta<select name="account">${options(accounts, 'id', 'name')}</select></label>
          <label class="full">Notas<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="calendar-plus"></i>Guardar cheque</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head"><h3>Historial de cobros</h3></div>
        ${table(['Esperado', 'Fuente', 'Estimado', 'Real', 'Estado'], paychecks.map((paycheck) => [
          dateLabel(paycheck.expectedDate),
          incomeName(paycheck.incomeSourceId),
          money(paycheck.netEstimated),
          paycheck.netActual === '' ? '-' : money(paycheck.netActual),
          badge(paycheck.status === 'received' ? 'green' : paycheck.status === 'not_received' ? 'red' : 'blue', paycheck.status || 'expected')
        ]))}
      </div>
    </section>
  `;

  $('#incomeSourceForm').addEventListener('submit', submitIncomeSource);
  $('#paycheckForm').addEventListener('submit', submitPaycheck);
  $$('.edit-source').forEach((button) => button.addEventListener('click', () => fillIncomeSourceForm(sources.find((s) => s.id === button.dataset.id))));
}

async function renderPaychecks() {
  const [pending, sources] = await Promise.all([
    api('getPendingPaycheckVerifications'),
    api('getIncomeSources')
  ]);
  state.cache.incomeSources = sources;
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Verificacion semanal de cheques</h3>
          <p>${pending.length} pendientes</p>
        </div>
      </div>
      <div class="list">
        ${pending.map((paycheck) => `
          <article class="item-card alert ${levelClass(paycheck.alertLevel)}">
            <div class="item-row">
              <div>
                <strong>${dateLabel(paycheck.expectedDate)}</strong>
                <div class="muted">${escapeHtml(incomeName(paycheck.incomeSourceId))} - estimado ${money(paycheck.netEstimated)}</div>
              </div>
              ${badge(levelClass(paycheck.alertLevel), paycheck.alertLevel)}
            </div>
            <form class="inline-form verify-paycheck" data-id="${escapeHtml(paycheck.id)}">
              <input name="netActual" type="number" step="0.01" placeholder="Monto real" required>
              <input name="notes" placeholder="Nota">
              <button class="action-button primary" type="submit"><i data-lucide="check"></i>Recibido</button>
              <button class="action-button secondary not-received" data-id="${escapeHtml(paycheck.id)}" type="button"><i data-lucide="clock-alert"></i>No recibido</button>
            </form>
          </article>
        `).join('') || empty('No hay cheques pendientes.')}
      </div>
    </section>
  `;
  $$('.verify-paycheck').forEach((form) => form.addEventListener('submit', submitVerifyPaycheck));
  $$('.not-received').forEach((button) => button.addEventListener('click', () => markNotReceived(button.dataset.id)));
}

async function renderBills() {
  const [bills, upcoming, accounts] = await Promise.all([
    api('getBills'),
    api('getUpcomingBills', { days: 30 }),
    api('getAccounts')
  ]);
  state.cache.accounts = accounts;

  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Pago fijo o variable</h3></div>
        <form id="billForm" class="form-grid">
          <input type="hidden" name="id">
          <label class="wide">Nombre<input name="name" required></label>
          <label>Monto<input name="amount" type="number" step="0.01" required></label>
          <label>Frecuencia<select name="frequency"><option value="weekly">Semanal</option><option value="monthly">Mensual</option><option value="every_x_months">Cada X meses</option><option value="once">Una vez</option></select></label>
          <label>Dia<input name="dueDay" placeholder="Friday o 23"></label>
          <label>Fecha<input name="dueDate" type="date"></label>
          <label>Prioridad<select name="priority"><option value="critical">Critica</option><option value="important">Importante</option><option value="normal">Normal</option></select></label>
          <label>Cuenta<select name="account">${options(accounts, 'id', 'name')}</select></label>
          <label>Categoria<input name="category"></label>
          <label class="full">Notas<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
          </div>
        </form>
      </div>

      <div class="panel span-7">
        <div class="panel-head"><h3>Pagos proximos</h3></div>
        <div class="list">
          ${upcoming.map((bill) => `
            <article class="item-card alert ${bill.remaining <= 0 ? 'green' : levelClass(bill.priority)}">
              <div class="item-row">
                <div>
                  <strong>${escapeHtml(bill.name)}</strong>
                  <div class="muted">${dateLabel(bill.dueDate)} - falta ${money(bill.remaining)}</div>
                </div>
                ${badge(bill.remaining <= 0 ? 'green' : levelClass(bill.priority), bill.status)}
              </div>
              <form class="inline-form bill-pay-form" data-id="${escapeHtml(bill.billId)}" data-due="${escapeHtml(bill.dueDate)}" data-amount="${Number(bill.remaining || bill.amount)}">
                <input name="amount" type="number" step="0.01" value="${Number(bill.remaining || bill.amount)}">
                <button class="action-button primary" data-kind="paid" type="submit"><i data-lucide="check-circle"></i>Pagado</button>
                <button class="action-button secondary partial-pay" type="button"><i data-lucide="split"></i>Parcial</button>
              </form>
            </article>
          `).join('') || empty('No hay pagos proximos.')}
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Todos los pagos</h3></div>
      ${table(['Nombre', 'Monto', 'Frecuencia', 'Dia', 'Prioridad', 'Accion'], bills.map((bill) => [
        escapeHtml(bill.name),
        money(bill.amount),
        escapeHtml(bill.frequency),
        escapeHtml(bill.dueDay || bill.dueDate),
        badge(levelClass(bill.priority), bill.priority),
        `<button class="action-button secondary edit-bill" data-id="${escapeHtml(bill.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>`
      ]))}
    </section>
  `;

  $('#billForm').addEventListener('submit', submitBill);
  $$('.bill-pay-form').forEach((form) => form.addEventListener('submit', submitBillPaid));
  $$('.partial-pay').forEach((button) => button.addEventListener('click', submitBillPartial));
  $$('.edit-bill').forEach((button) => button.addEventListener('click', () => fillBillForm(bills.find((b) => b.id === button.dataset.id))));
}

async function renderDebts() {
  const [debts, strategy, accounts] = await Promise.all([
    api('getDebts'),
    api('getDebtStrategy'),
    api('getAccounts')
  ]);
  state.cache.accounts = accounts;

  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Deuda</h3></div>
        <form id="debtForm" class="form-grid">
          <input type="hidden" name="id">
          <label class="wide">Nombre<input name="name" required></label>
          <label>Balance<input name="balance" type="number" step="0.01" required></label>
          <label>Balance original<input name="originalBalance" type="number" step="0.01"></label>
          <label>Minimo<input name="minimumPayment" type="number" step="0.01" required></label>
          <label>Dia<input name="dueDay" placeholder="23"></label>
          <label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="important">Importante</option></select></label>
          <label class="full">Notas<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head">
          <div>
            <h3>Snowball</h3>
            <p>${escapeHtml(strategy.message)}</p>
          </div>
          <span class="badge blue">${money(strategy.totalBalance)}</span>
        </div>
        <p>Orden: ${escapeHtml((strategy.recommendedOrder || []).join(' -> '))}</p>
        <p>Minimos mensuales: <strong>${money(strategy.totalMinimums)}</strong></p>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Deudas activas</h3></div>
      <div class="list">
        ${debts.map((debt) => `
          <article class="item-card">
            <div class="item-row">
              <div>
                <strong>${escapeHtml(debt.name)}</strong>
                <div class="muted">Minimo ${money(debt.minimumPayment)} - dia ${escapeHtml(debt.dueDay)}</div>
              </div>
              <span class="amount">${money(debt.balance)}</span>
            </div>
            <div class="progress"><span style="width:${Math.max(0, Math.min(100, debt.progress))}%"></span></div>
            <form class="inline-form debt-payment" data-id="${escapeHtml(debt.id)}">
              <input name="amount" type="number" step="0.01" placeholder="Pago">
              <select name="type"><option value="minimum">Minimo</option><option value="extra">Extra</option></select>
              <select name="account">${options(accounts, 'id', 'name')}</select>
              <button class="action-button primary" type="submit"><i data-lucide="check"></i>Aplicar</button>
              <button class="action-button secondary edit-debt" data-id="${escapeHtml(debt.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>
            </form>
          </article>
        `).join('') || empty('No hay deudas.')}
      </div>
    </section>
  `;

  $('#debtForm').addEventListener('submit', submitDebt);
  $$('.debt-payment').forEach((form) => form.addEventListener('submit', submitDebtPayment));
  $$('.edit-debt').forEach((button) => button.addEventListener('click', () => fillDebtForm(debts.find((d) => d.id === button.dataset.id))));
}

async function renderShifts() {
  const [sources, shifts] = await Promise.all([
    api('getIncomeSources'),
    api('getWorkShifts', { limit: 50 })
  ]);
  const amazon = sources.find((s) => /amazon/i.test(s.name)) || sources[0] || {};
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Turno trabajado</h3></div>
        <form id="shiftForm" class="form-grid">
          <label class="wide">Fuente<select name="incomeSourceId">${options(sources, 'id', 'name', amazon.id)}</select></label>
          <label>Fecha<input name="date" type="date" value="${todayInput()}" required></label>
          <label>Inicio<input name="startTime" type="time" value="13:00"></label>
          <label>Fin<input name="endTime" type="time" value="17:30"></label>
          <label>Break min<input name="breakMinutes" type="number" value="0"></label>
          <label>Horas<input name="hours" type="number" step="0.01" placeholder="Auto"></label>
          <label>Rate<input name="rate" type="number" step="0.01" value="${Number(amazon.hourlyRate || 18.5)}"></label>
          <label>Bono/h<input name="bonusRate" type="number" step="0.01" value="0"></label>
          <label>Fecha de cobro<input name="expectedPayDate" type="date"></label>
          <label class="full">Notas<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar turno</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head"><h3>Historial de turnos</h3></div>
        ${table(['Fecha', 'Horas', 'Rate', 'Neto estimado', 'Cheque'], shifts.map((shift) => [
          dateLabel(shift.date),
          Number(shift.hours || 0).toFixed(2),
          money(shift.rate),
          money(shift.estimatedNet),
          shift.linkedPaycheckId ? 'Creado' : '-'
        ]))}
      </div>
    </section>
  `;
  $('#shiftForm').addEventListener('submit', submitShift);
}

async function renderCalendar() {
  const events = await api('getCalendarData', { days: 45 });
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head"><h3>Calendario</h3></div>
      <div class="calendar-list">
        ${events.map((event) => `
          <div class="calendar-event">
            <strong>${dateLabel(event.date)}</strong>
            <span>${escapeHtml(event.title)}</span>
            <span class="badge ${levelClass(event.priority)}">${escapeHtml(event.type)}</span>
          </div>
        `).join('') || empty('No hay eventos.')}
      </div>
    </section>
  `;
}

async function renderWhatNow() {
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Calculadora</h3></div>
        <form id="whatNowForm" class="form-grid">
          <label>Dinero actual<input name="currentMoney" type="number" step="0.01" value="312.57" required></label>
          <label>Pagos antes del cobro<input name="billsTotal" type="number" step="0.01" value="136.97"></label>
          <label>Hija pagado<input name="daughterPaid" type="number" step="0.01" value="150"></label>
          <label>Gasolina<input name="gasAmount" type="number" step="0.01" value="45"></label>
          <label>Comida<input name="foodAmount" type="number" step="0.01" value="60"></label>
          <label>Proximo cobro<input name="nextPaycheckDate" type="date" value="2026-07-10"></label>
          <label><input class="check-toggle" name="gasPending" type="checkbox" checked> Falta gasolina</label>
          <label><input class="check-toggle" name="amazonComing" type="checkbox" checked> Amazon viene</label>
          <label><input class="check-toggle" name="paycheckConfirmed" type="checkbox"> Cheque confirmado</label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="calculator"></i>Calcular</button>
          </div>
        </form>
      </div>
      <div id="whatNowResult" class="panel span-7">
        <div class="empty">Calcula para ver los pasos.</div>
      </div>
    </section>
  `;
  $('#whatNowForm').addEventListener('submit', submitWhatNow);
}

async function renderChecklist() {
  const data = await api('getWeeklyChecklist');
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>${escapeHtml(data.checklist.title)}</h3>
          <p>${escapeHtml(data.progress.text)}</p>
        </div>
        <span class="badge green">${data.progress.percent}%</span>
      </div>
      <div class="progress"><span style="width:${data.progress.percent}%"></span></div>
      <div class="list" style="margin-top:14px">
        ${data.items.map((item) => `
          <article class="item-card check-item">
            <input class="check-toggle checklist-toggle" data-id="${escapeHtml(item.id)}" type="checkbox" ${item.completed ? 'checked' : ''}>
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <div class="muted">${dateLabel(item.dueDate)}</div>
            </div>
            ${badge(levelClass(item.priority), item.priority)}
          </article>
        `).join('')}
      </div>
      <div class="button-row">
        <button id="generateChecklist" class="action-button secondary" type="button"><i data-lucide="refresh-cw"></i>Regenerar</button>
      </div>
    </section>
  `;
  $$('.checklist-toggle').forEach((input) => input.addEventListener('change', toggleChecklistItem));
  $('#generateChecklist').addEventListener('click', async () => {
    await api('generateWeeklyChecklist');
    toast('Checklist actualizado.');
    renderView('checklist', true);
  });
}

async function renderNotifications() {
  const notifications = await api('getNotifications');
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head"><h3>Alertas y recordatorios</h3></div>
      <div class="list">
        ${notifications.map((notification) => `
          <article class="item-card alert ${levelClass(notification.priority)}">
            <div class="item-row">
              <div>
                <strong>${escapeHtml(notification.title)}</strong>
                <div class="muted">${escapeHtml(notification.message)}</div>
              </div>
              ${badge(levelClass(notification.priority), notification.status || 'open')}
            </div>
            <div class="button-row">
              <button class="action-button secondary resolve-notification" data-id="${escapeHtml(notification.id)}" type="button"><i data-lucide="check"></i>Resolver</button>
              <button class="action-button secondary snooze-notification" data-id="${escapeHtml(notification.id)}" type="button"><i data-lucide="clock"></i>Posponer</button>
            </div>
          </article>
        `).join('') || empty('No hay alertas internas.')}
      </div>
    </section>
  `;
  $$('.resolve-notification').forEach((button) => button.addEventListener('click', () => resolveNotification(button.dataset.id)));
  $$('.snooze-notification').forEach((button) => button.addEventListener('click', () => snoozeNotification(button.dataset.id)));
}

async function renderSettings() {
  const settings = await api('getSettings');
  state.cache.settings = settings;
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-6">
        <div class="panel-head"><h3>Configuracion</h3></div>
        <form id="settingsForm" class="form-grid">
          <label class="wide">Email<input name="notificationEmail" type="email" value="${escapeAttr(settings.notificationEmail || '')}"></label>
          <label>Tax Amazon<input name="amazonTaxRate" type="number" step="0.001" value="${Number(settings.amazonTaxRate ?? 0.12)}"></label>
          <label>Tax trabajo<input name="mainJobTaxRate" type="number" step="0.001" value="${Number(settings.mainJobTaxRate ?? 0)}"></label>
          <label>Gasolina<input name="gasEstimated" type="number" step="0.01" value="${Number(settings.gasEstimated ?? 45)}"></label>
          <label>Comida<input name="foodEstimated" type="number" step="0.01" value="${Number(settings.foodEstimated ?? 60)}"></label>
          <label>Buffer<input name="bufferAmount" type="number" step="0.01" value="${Number(settings.bufferAmount ?? 50)}"></label>
          <label>Amazon a Capital One<input name="amazonSplitCapitalOne" type="number" step="0.01" value="${Number(settings.amazonSplitCapitalOne ?? 70)}"></label>
          <label>Amazon a Checking<input name="amazonSplitVyStarChecking" type="number" step="0.01" value="${Number(settings.amazonSplitVyStarChecking ?? 120)}"></label>
          <label>Amazon a Savings<input name="amazonSplitVyStarSavings" type="number" step="0.01" value="${Number(settings.amazonSplitVyStarSavings ?? 100)}"></label>
          <label><input class="check-toggle" name="emailsEnabled" type="checkbox" ${settings.emailsEnabled !== false ? 'checked' : ''}> Emails</label>
          <label><input class="check-toggle" name="internalAlertsEnabled" type="checkbox" ${settings.internalAlertsEnabled !== false ? 'checked' : ''}> Alertas internas</label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
          </div>
        </form>
      </div>

      <div class="panel span-6">
        <div class="panel-head"><h3>Seguridad y backup</h3></div>
        <form id="passwordForm" class="form-grid">
          <label class="wide">Contrasena actual
            <span class="password-field">
              <input name="currentPassword" type="password" autocomplete="current-password">
              <button class="password-toggle" type="button" title="Mostrar contrasena" aria-label="Mostrar contrasena">
                <i data-lucide="eye"></i>
              </button>
            </span>
          </label>
          <label class="wide">Nueva contrasena
            <span class="password-field">
              <input name="newPassword" type="password" minlength="10" autocomplete="new-password" required>
              <button class="password-toggle" type="button" title="Mostrar contrasena" aria-label="Mostrar contrasena">
                <i data-lucide="eye"></i>
              </button>
            </span>
          </label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="key-round"></i>Cambiar contrasena</button>
          </div>
        </form>
        <div class="button-row">
          <button id="exportBackup" class="action-button secondary" type="button"><i data-lucide="download"></i>Exportar JSON</button>
          <label class="action-button secondary">
            <i data-lucide="upload"></i>
            Importar JSON
            <input id="importBackup" type="file" accept="application/json" hidden>
          </label>
        </div>
      </div>
    </section>
  `;
  $('#settingsForm').addEventListener('submit', submitSettings);
  $('#passwordForm').addEventListener('submit', submitPassword);
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('change', importBackup);
}

async function submitAccount(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveAccount', formValues(event.currentTarget));
    toast('Cuenta guardada.');
    renderView('accounts', true);
  });
}

async function submitBalance(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('updateAccountBalance', { id: event.currentTarget.dataset.id, ...formValues(event.currentTarget) });
    toast('Balance actualizado.');
    renderView('accounts', true);
  });
}

async function submitTransfer(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('createTransfer', formValues(event.currentTarget));
    toast('Transferencia registrada.');
    renderView('accounts', true);
  });
}

async function submitIncomeSource(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveIncomeSource', formValues(event.currentTarget));
    toast('Fuente guardada.');
    renderView('incomes', true);
  });
}

async function submitPaycheck(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('savePaycheck', formValues(event.currentTarget));
    toast('Cheque guardado.');
    renderView('incomes', true);
  });
}

async function submitVerifyPaycheck(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('verifyPaycheck', { id: event.currentTarget.dataset.id, ...formValues(event.currentTarget) });
    toast('Cheque verificado.');
    renderView('paychecks', true);
  });
}

async function markNotReceived(id) {
  await guarded(async () => {
    await api('markPaycheckNotReceived', { id });
    toast('Cheque marcado como no recibido.');
    renderView('paychecks', true);
  });
}

async function submitBill(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveBill', formValues(event.currentTarget));
    toast('Pago guardado.');
    renderView('bills', true);
  });
}

async function submitBillPaid(event) {
  event.preventDefault();
  await guarded(async () => {
    const form = event.currentTarget;
    await api('markBillPaid', {
      billId: form.dataset.id,
      dueDate: form.dataset.due,
      ...formValues(form)
    });
    toast('Pago marcado.');
    renderView('bills', true);
  });
}

async function submitBillPartial(event) {
  const form = event.currentTarget.closest('form');
  await guarded(async () => {
    await api('markBillPartial', {
      billId: form.dataset.id,
      dueDate: form.dataset.due,
      partialAmount: formValues(form).amount
    });
    toast('Pago parcial registrado.');
    renderView('bills', true);
  });
}

async function submitDebt(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveDebt', formValues(event.currentTarget));
    toast('Deuda guardada.');
    renderView('debts', true);
  });
}

async function submitDebtPayment(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('makeDebtPayment', { debtId: event.currentTarget.dataset.id, ...formValues(event.currentTarget) });
    toast('Pago aplicado.');
    renderView('debts', true);
  });
}

async function submitShift(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveWorkShift', formValues(event.currentTarget));
    toast('Turno guardado.');
    renderView('shifts', true);
  });
}

async function submitWhatNow(event) {
  event.preventDefault();
  await guarded(async () => {
    const result = await api('calculateWhatToDoNow', formValues(event.currentTarget));
    $('#whatNowResult').innerHTML = `
      <div class="panel-head">
        <div>
          <h3>Respuesta</h3>
          <p>Dinero que no debes tocar: ${money(result.moneyNotToTouch)}</p>
        </div>
        ${badge(result.canPayDebtExtra ? 'green' : 'red', result.canPayDebtExtra ? 'Deuda extra si' : 'No deuda extra')}
      </div>
      <div class="grid">
        ${metric('Reservar', money(result.reservedForBills), 'Telefono, internet u otros pagos', 'warning')}
        ${metric('Gasolina', money(result.gasAmount), 'Prioridad antes de extra', 'info')}
        ${metric('Libre para gastar', money(result.freeToSpend), 'Despues de reservas', result.freeToSpend > 0 ? 'success' : 'critical')}
      </div>
      <div class="list" style="margin-top:14px">
        ${Object.values(result.decisions).map((line) => `<div class="item-card"><strong>${escapeHtml(line)}</strong></div>`).join('')}
        ${result.steps.map((line) => `<div class="item-card"><span>${escapeHtml(line)}</span></div>`).join('')}
      </div>
    `;
    refreshIcons();
  });
}

async function toggleChecklistItem(event) {
  const checked = event.currentTarget.checked;
  const id = event.currentTarget.dataset.id;
  await guarded(async () => {
    await api(checked ? 'completeChecklistItem' : 'reopenChecklistItem', { id });
    renderView('checklist', true);
  });
}

async function resolveNotification(id) {
  await guarded(async () => {
    await api('resolveNotification', { id });
    renderView('notifications', true);
  });
}

async function snoozeNotification(id) {
  await guarded(async () => {
    const snoozedUntil = new Date(Date.now() + 24 * 3600000).toISOString().slice(0, 10);
    await api('snoozeNotification', { id, snoozedUntil });
    renderView('notifications', true);
  });
}

async function submitSettings(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveSettings', formValues(event.currentTarget));
    toast('Configuracion guardada.');
    renderView('settings', true);
  });
}

async function submitPassword(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('changePassword', formValues(event.currentTarget));
    event.currentTarget.reset();
    toast('Contrasena actualizada.');
  });
}

async function exportBackup() {
  await guarded(async () => {
    const backup = await api('exportData');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mi-control-financiero-backup-${todayInput()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

async function importBackup(event) {
  const file = event.currentTarget.files[0];
  if (!file) return;
  await guarded(async () => {
    const text = await file.text();
    const backup = JSON.parse(text);
    await api('importData', backup);
    toast('Backup importado.');
    renderView('dashboard', true);
  });
}

function fillAccountForm(account) {
  fillForm($('#accountForm'), account);
}

function fillIncomeSourceForm(source) {
  fillForm($('#incomeSourceForm'), source);
}

function fillBillForm(bill) {
  fillForm($('#billForm'), bill);
}

function fillDebtForm(debt) {
  fillForm($('#debtForm'), debt);
}

function fillForm(form, values) {
  if (!form || !values) return;
  Object.entries(values).forEach(([key, value]) => {
    const input = form.elements[key];
    if (!input) return;
    if (input.type === 'checkbox') {
      input.checked = value === true || value === 'true';
    } else {
      input.value = value ?? '';
    }
  });
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function guarded(fn) {
  try {
    setBusy(true);
    await fn();
  } catch (error) {
    toast(error.message || 'No se pudo completar.');
  } finally {
    setBusy(false);
    refreshIcons();
  }
}

async function api(action, payload = {}, options = {}) {
  const requestId = `mcf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const request = {
    requestId,
    action,
    token: options.skipToken ? '' : state.token,
    payload
  };
  return postWithIframe(request);
}

function postWithIframe(request) {
  return new Promise((resolve, reject) => {
    const iframeName = `frame_${request.requestId}`;
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.className = 'hidden';
    iframe.setAttribute('aria-hidden', 'true');

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = CONFIG.apiUrl;
    form.target = iframeName;
    form.className = 'hidden';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'request';
    input.value = JSON.stringify(request);
    form.appendChild(input);

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      form.remove();
      iframe.remove();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('El backend no respondio a tiempo.'));
    }, CONFIG.timeoutMs);

    function onMessage(event) {
      const data = event.data || {};
      if (data.source !== 'mcf-apps-script' || data.requestId !== request.requestId) {
        return;
      }
      cleanup();
      if (!data.payload || data.payload.ok === false) {
        reject(new Error((data.payload && data.payload.error) || 'Error del backend.'));
        return;
      }
      resolve(data.payload.data);
    }

    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();
  });
}

function formValues(form) {
  const out = {};
  Array.from(new FormData(form).entries()).forEach(([key, value]) => {
    out[key] = value;
  });
  $$('input[type="checkbox"]', form).forEach((input) => {
    out[input.name] = input.checked;
  });
  return out;
}

function setBusy(show) {
  $('#busy').classList.toggle('hidden', !show);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message || '';
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 4200);
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function bindGoButtons() {
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => renderView(button.dataset.go)));
}

function handlePasswordToggle(event) {
  const button = event.target.closest('.password-toggle');
  if (!button) return;
  const field = button.closest('.password-field');
  const input = field ? $('input', field) : null;
  if (!input) return;

  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.title = showing ? 'Mostrar contrasena' : 'Ocultar contrasena';
  button.setAttribute('aria-label', button.title);
  button.innerHTML = `<i data-lucide="${showing ? 'eye' : 'eye-off'}"></i>`;
  refreshIcons();
}

function metric(label, value, detail, tone = 'info') {
  return `
    <div class="metric ${tone} span-3">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(detail || '')}</small>
    </div>
  `;
}

function renderAlertList(alerts) {
  return `<div class="list">${alerts.map((alert) => `
    <article class="item-card alert ${levelClass(alert.priority)}">
      <div class="item-row">
        <div>
          <strong>${escapeHtml(alert.title)}</strong>
          <div class="muted">${escapeHtml(alert.message)}</div>
        </div>
        ${badge(levelClass(alert.priority), alert.priority)}
      </div>
    </article>
  `).join('') || empty('Sin alertas.')}</div>`;
}

function renderUpcomingBills(bills) {
  return `<div class="list">${bills.map((bill) => `
    <article class="item-card">
      <div class="item-row">
        <div>
          <strong>${escapeHtml(bill.name)}</strong>
          <div class="muted">${dateLabel(bill.dueDate)} - ${escapeHtml(bill.status)}</div>
        </div>
        <span class="amount">${money(bill.remaining)}</span>
      </div>
    </article>
  `).join('') || empty('Sin pagos proximos.')}</div>`;
}

function renderPaycheckMini(paychecks) {
  return `<div class="list">${paychecks.map((paycheck) => `
    <article class="item-card alert ${levelClass(paycheck.alertLevel)}">
      <div class="item-row">
        <div>
          <strong>${dateLabel(paycheck.expectedDate)}</strong>
          <div class="muted">${escapeHtml(incomeName(paycheck.incomeSourceId))}</div>
        </div>
        <span class="amount">${money(paycheck.netEstimated)}</span>
      </div>
    </article>
  `).join('') || empty('Sin cheques pendientes.')}</div>`;
}

function table(headers, rows) {
  if (!rows.length) return empty('Sin registros.');
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

function badge(level, label) {
  return `<span class="badge ${levelClass(level)}">${escapeHtml(String(label || ''))}</span>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function options(rows, valueKey, labelKey, selected = '') {
  return rows.map((row) => {
    const selectedAttr = String(row[valueKey]) === String(selected) ? ' selected' : '';
    return `<option value="${escapeAttr(row[valueKey])}"${selectedAttr}>${escapeHtml(row[labelKey])}</option>`;
  }).join('');
}

function accountBalance(accounts, name) {
  const account = (accounts || []).find((item) => item.name === name);
  return money(account ? account.currentBalance : 0);
}

function accountName(id) {
  const account = (state.cache.accounts || []).find((item) => item.id === id);
  return escapeHtml(account ? account.name : id || '');
}

function incomeName(id) {
  const source = (state.cache.incomeSources || []).find((item) => item.id === id);
  return source ? source.name : id || 'Ingreso';
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 10000) / 100}%`;
}

function dateLabel(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat('es-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function levelClass(value) {
  const text = String(value || '').toLowerCase();
  if (['critical', 'red', 'critica'].includes(text)) return 'red';
  if (['important', 'warning', 'yellow', 'amarillo'].includes(text)) return 'yellow';
  if (['success', 'green', 'paid'].includes(text)) return 'green';
  return 'blue';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
