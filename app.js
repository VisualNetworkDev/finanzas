const CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbzMdsCVqnA9VUbXPZP3b_xBvUcCIlbKM7MFw5RoqowR5gmo_RTXHmP5dzmNpLqvwVy5/exec',
  timeoutMs: 30000,
  cacheTtlMs: 90000,
  busyDelayMs: 220,
  loginCooldownMs: 1200
};

const MUTATING_ACTIONS = new Set([
  'changePassword',
  'saveAccount',
  'updateAccountBalance',
  'createTransfer',
  'saveIncomeSource',
  'deleteIncomeSource',
  'savePaycheck',
  'recordReceivedPaycheck',
  'verifyPaycheck',
  'markPaycheckNotReceived',
  'saveBill',
  'deleteBill',
  'markBillPaid',
  'markBillPartial',
  'saveDebt',
  'deleteDebt',
  'makeDebtPayment',
  'generateWeeklyChecklist',
  'completeChecklistItem',
  'reopenChecklistItem',
  'createNotification',
  'markNotificationRead',
  'snoozeNotification',
  'resolveNotification',
  'importData',
  'saveSettings',
  'markGasCovered',
  'markPhoneInternetReserved',
  'saveWorkShift',
  'deleteWorkShift',
  'seedUserFinancialData'
]);

const NAV = [
  ['home', 'Inicio', 'home'],
  ['work', 'Trabajo', 'briefcase-business'],
  ['bills', 'Pagos', 'receipt'],
  ['debts', 'Deudas', 'trending-down'],
  ['accounts', 'Cuentas', 'wallet']
];

const MORE_NAV = [
  ['today', 'Hoy anterior', 'sparkles'],
  ['paychecks', 'Cheques', 'badge-dollar-sign'],
  ['money', 'Mi dinero', 'wallet'],
  ['shifts', 'Turnos', 'clock'],
  ['calendar', 'Calendario', 'calendar-days'],
  ['checklist', 'Checklist', 'list-checks'],
  ['notifications', 'Alertas', 'bell'],
  ['settings', 'Configuracion', 'settings'],
  ['backup', 'Backup', 'archive'],
  ['dashboard', 'Resumen avanzado', 'layout-dashboard']
];

const state = {
  token: localStorage.getItem('mcf_token') || '',
  user: null,
  activeView: 'home',
  simpleMode: true,
  cache: {},
  requestCache: {},
  inFlight: {},
  busyCount: 0,
  busyTimer: 0,
  loginLockedUntil: 0
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
  $('#refreshButton').addEventListener('click', () => {
    clearRequestCache();
    renderView(state.activeView, true);
  });
  $('#menuToggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
  $('#forcedPasswordForm').addEventListener('submit', handleForcedPassword);
  document.addEventListener('click', handlePasswordToggle);
}

function renderNav() {
  $('#mainNav').innerHTML = NAV.map(([id, label, icon]) => `
    <button class="nav-item ${navIsActive(id) ? 'active' : ''}" data-view="${id}" type="button">
      <i data-lucide="${icon}"></i>
      <span>${label}</span>
    </button>
  `).join('');

  $$('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      $('.sidebar').classList.remove('open');
      if (button.dataset.view === state.activeView) {
        return;
      }
      renderView(button.dataset.view);
    });
  });
}

function navIsActive(id) {
  if (id === state.activeView) return true;
  return false;
}

function navItem(viewId) {
  return NAV.concat(MORE_NAV, [['incomes', 'Ingresos', 'banknote'], ['whatnow', 'Que hago ahora', 'circle-help']])
    .find(([id]) => id === viewId);
}

async function validateSavedSession() {
  try {
    showApp();
    $('#view').innerHTML = '<div class="empty">Cargando Inicio...</div>';
    const data = await api('bootstrap');
    state.user = data.user;
    state.cache.settings = data.settings || {};
    if (data.homeData || data.todayData) {
      setApiCache('getViewData', viewPayload('home'), data.homeData || data.todayData);
    }
    toggleForcedPassword(Boolean(state.user.mustChangePassword));
    await renderView(state.user.mustChangePassword ? 'settings' : 'home', false);
  } catch (error) {
    localStorage.removeItem('mcf_token');
    state.token = '';
    showLogin();
    toast(error.message || 'Sesion vencida.');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (Date.now() < state.loginLockedUntil) {
    toast('Espera un momento antes de intentar otra vez.');
    return;
  }

  const payload = formValues(form);
  try {
    setBusy(true);
    setFormDisabled(form, true);
    const data = await api('login', { ...payload, includeToday: true }, { skipToken: true });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('mcf_token', state.token);
    clearRequestCache();
    if (data.homeData || data.todayData) {
      setApiCache('getViewData', viewPayload('home'), data.homeData || data.todayData);
    }
    showApp();
    toggleForcedPassword(Boolean(state.user.mustChangePassword));
    await renderView(state.user.mustChangePassword ? 'settings' : 'home', false);
  } catch (error) {
    state.loginLockedUntil = Date.now() + CONFIG.loginCooldownMs;
    toast(error.message);
  } finally {
    setFormDisabled(form, false);
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
  state.cache = {};
  clearRequestCache();
  localStorage.removeItem('mcf_token');
  showLogin();
}

async function handleForcedPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = formValues(form);
  try {
    setBusy(true);
    await api('changePassword', payload);
    state.user.mustChangePassword = false;
    toggleForcedPassword(false);
    form.reset();
    toast('Contrasena actualizada.');
    await renderView('home', true);
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
  renderNav();
  const item = navItem(viewId) || NAV[0];
  $('#eyebrow').textContent = item[1];
  $('#viewTitle').textContent = item[1];
  const warm = hasWarmView(viewId) && !force;
  if (!warm) {
    $('#view').innerHTML = '<div class="empty">Cargando...</div>';
  }

  try {
    const renderers = {
      home: renderHome,
      work: renderWork,
      today: renderToday,
      dashboard: renderDashboard,
      money: renderMoney,
      more: renderMore,
      backup: renderBackup,
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
    await (renderers[viewId] || renderHome)(force);
  } catch (error) {
    $('#view').innerHTML = `<div class="empty">${escapeHtml(error.message || 'No se pudo cargar.')}</div>`;
  } finally {
    refreshIcons();
  }
}

async function renderHome(force = false) {
  const data = await getViewData('home', force);
  state.cache.today = data;
  state.cache.dashboard = data;
  state.cache.accounts = data.accounts || [];
  state.cache.incomeSources = data.incomeSources || [];
  state.cache.upcomingBills = data.upcomingBills || [];

  const plan = normalizeWeeklyPlan(data);
  const status = plan.status || {};
  const nextPayment = plan.payments?.nextImportant || null;
  const nextCheck = plan.paychecks?.nextPending || plan.paychecks?.nextExpected || null;
  const steps = (status.steps || plan.recommendation?.steps || []).slice(0, 3);

  $('#view').innerHTML = `
    <section class="home-shell">
      <article class="home-status ${levelClass(status.status)}">
        <div>
          <span class="today-kicker">Inicio</span>
          <h3>${escapeHtml(status.title || 'Revisa tu dinero real')}</h3>
          <p>${escapeHtml(plan.recommendation?.message || status.message || 'Primero mira lo que entra, lo que sale y lo que queda real.')}</p>
        </div>
        <span class="status-pill ${levelClass(status.status)}">${escapeHtml(status.status || 'plan')}</span>
      </article>

      <section class="home-metrics">
        ${simpleMoneyCard('Espero recibir', money(plan.income.expectedTotal), 'Trabajo principal + Amazon estimado', 'blue')}
        ${simpleMoneyCard('Recibido real', money(plan.income.receivedRealThisWeek), 'Cheques marcados esta semana', 'green')}
        ${simpleMoneyCard('Sale antes del cheque', money(plan.outflows.beforeNextPaycheck), 'Pagos cercanos y deudas minimas', 'yellow')}
        ${simpleMoneyCard('Disponible real', money(plan.totals.freeReal), plan.totals.freeReal > 0 ? 'Despues de separar lo importante' : 'No lo trates como libre', plan.totals.freeReal > 0 ? 'green' : 'red')}
      </section>

      <section class="home-grid">
        <article class="panel span-7">
          <div class="panel-head">
            <div>
              <h3>Recomendacion simple</h3>
              <p>${escapeHtml(status.nextAction || 'Empieza por lo mas cercano.')}</p>
            </div>
          </div>
          <strong class="next-action">${escapeHtml(status.nextAction || plan.recommendation?.title || 'Revisa pagos y cheques.')}</strong>
          <div class="mini-checklist">
            ${steps.map((step) => `<div><i data-lucide="check-circle-2"></i><span>${escapeHtml(step)}</span></div>`).join('') || '<div><i data-lucide="check-circle-2"></i><span>Sin pasos urgentes ahora.</span></div>'}
          </div>
        </article>

        <article class="panel span-5">
          <div class="panel-head"><h3>Lo proximo</h3></div>
          <div class="simple-list">
            <div>
              <span>Proximo pago</span>
              <strong>${nextPayment ? `${escapeHtml(nextPayment.name)} - ${money(nextPayment.remaining || nextPayment.amount)}` : 'Sin pago cercano'}</strong>
              <small>${nextPayment ? dateLabel(nextPayment.dueDate) : 'Nada pendiente antes del cheque'}</small>
            </div>
            <div>
              <span>Cheque por confirmar</span>
              <strong>${nextCheck ? money(nextCheck.netEstimated || nextCheck.netActual || 0) : 'Sin cheque pendiente'}</strong>
              <small>${nextCheck ? dateLabel(nextCheck.expectedDate) : 'No hay verificacion pendiente'}</small>
            </div>
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Reparto entre cuentas</h3>
            <p>Que dejar quieto y que mover si sobra.</p>
          </div>
        </div>
        <div class="account-plan-grid">
          ${accountPlanCard('Capital One', plan.distribution.capitalOneKeep, 'Deja aqui pagos normales, hija, gasolina, comida y buffer.')}
          ${accountPlanCard('VyStar Checking', plan.distribution.vystarCheckingMove, 'Solo para separar pagos futuros, mantenimiento o deuda extra.')}
          ${accountPlanCard('VyStar Savings', plan.distribution.vystarSavingsMove, 'Ahorro real. No mover si falta algo importante.')}
        </div>
        <p class="muted-line">${escapeHtml(plan.distribution.message || 'No muevas dinero hasta cubrir pagos cercanos.')}</p>
      </section>

      <section class="quick-actions">
        <button class="quick-button" data-quick="balance" type="button"><i data-lucide="wallet"></i><span>Actualizar balance</span></button>
        <button class="quick-button" data-quick="verify-paycheck" type="button"><i data-lucide="badge-dollar-sign"></i><span>Marcar cheque recibido</span></button>
        <button class="quick-button" data-quick="payment" type="button"><i data-lucide="receipt"></i><span>Marcar pago hecho</span></button>
        <button class="quick-button" data-go="work" type="button"><i data-lucide="calendar-check"></i><span>Ver plan de la semana</span></button>
      </section>
    </section>
  `;

  bindGoButtons();
  bindQuickActions();
}

async function renderWork(force = false) {
  const data = await getViewData('work', force);
  const plan = normalizeWeeklyPlan(data);
  const accounts = data.accounts || [];
  const sources = data.incomeSources || [];
  const shifts = sortByDateAsc(data.shifts || [], 'date').slice(0, 8);
  state.cache.today = data;
  state.cache.accounts = accounts;
  state.cache.incomeSources = sources;
  state.cache.shifts = data.shifts || [];

  const main = plan.work.main;
  const amazon = plan.work.amazon;

  $('#view').innerHTML = `
    <section class="home-shell">
      <section class="home-metrics">
        ${simpleMoneyCard('Trabajo principal', money(main.normalNet), 'Neto normal semanal', 'blue')}
        ${simpleMoneyCard('Amazon estimado', money(amazon.normalNet), '4 turnos aproximados', 'green')}
        ${simpleMoneyCard('Horas esperadas', `${formatNumber(main.normalHours + amazon.normalHours)} h`, 'Principal + Amazon', 'yellow')}
        ${simpleMoneyCard('Recibido real', money(plan.income.receivedRealThisWeek), 'Marcado esta semana', 'blue')}
      </section>

      <section class="grid">
        <article class="panel span-6">
          <div class="panel-head">
            <div>
              <h3>Trabajo principal</h3>
              <p>Miercoles a sabado, 10 horas por dia.</p>
            </div>
          </div>
          <form id="mainWorkForm" class="work-form" data-source="${escapeAttr(main.sourceId)}">
            <div class="work-day-list">
              ${main.days.map((day) => `
                <label class="work-day-row">
                  <input class="main-day-check" type="checkbox" checked>
                  <span>${escapeHtml(day.label)}</span>
                  <input class="main-day-hours" type="number" step="0.25" value="${Number(day.hours)}">
                </label>
              `).join('')}
            </div>
            <div class="calc-strip">
              <span>Horas <strong id="mainCalcHours">0</strong></span>
              <span>Gross <strong id="mainCalcGross">$0.00</strong></span>
              <span>Taxes <strong id="mainCalcTaxes">$0.00</strong></span>
              <span>Neto <strong id="mainCalcNet">$0.00</strong></span>
            </div>
            <div class="button-row">
              <button id="recordMainPaycheck" class="action-button primary" type="button"><i data-lucide="badge-dollar-sign"></i>Marcar cheque recibido</button>
            </div>
          </form>
        </article>

        <article class="panel span-6">
          <div class="panel-head">
            <div>
              <h3>Amazon</h3>
              <p>Marca turnos trabajados, cambia horas o agrega bono.</p>
            </div>
          </div>
          <form id="amazonWorkForm" class="work-form" data-source="${escapeAttr(amazon.sourceId)}">
            <div class="work-day-list">
              ${amazon.shifts.map((shift, index) => `
                <label class="work-day-row amazon-plan-row">
                  <input class="amazon-shift-check" type="checkbox" ${index < 4 ? 'checked' : ''}>
                  <span>${escapeHtml(shift.label)}</span>
                  <input class="amazon-shift-date" type="date" value="${escapeAttr(shift.date)}">
                  <input class="amazon-shift-start" type="time" value="${escapeAttr(shift.startTime)}">
                  <input class="amazon-shift-end" type="time" value="${escapeAttr(shift.endTime)}">
                  <input class="amazon-shift-hours" type="number" step="0.25" value="${Number(shift.hours)}">
                </label>
              `).join('')}
            </div>
            <div class="form-grid compact-fields">
              <label>Rate<input id="amazonRate" type="number" step="0.01" value="${Number(amazon.hourlyRate)}"></label>
              <label>Bono por hora<input id="amazonBonusRate" type="number" step="0.01" value="0"></label>
              <label>Bono fijo<input id="amazonBonusFixed" type="number" step="0.01" value="0"></label>
            </div>
            <div class="calc-strip">
              <span>Horas <strong id="amazonCalcHours">0</strong></span>
              <span>Gross <strong id="amazonCalcGross">$0.00</strong></span>
              <span>Taxes <strong id="amazonCalcTaxes">$0.00</strong></span>
              <span>Neto <strong id="amazonCalcNet">$0.00</strong></span>
            </div>
            <div class="button-row">
              <button class="action-button secondary" type="submit"><i data-lucide="save"></i>Guardar turnos marcados</button>
              <button id="recordAmazonPaycheck" class="action-button primary" type="button"><i data-lucide="badge-dollar-sign"></i>Marcar cheque recibido</button>
            </div>
          </form>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Turnos guardados</h3>
            <p>Actuales y futuros primero.</p>
          </div>
        </div>
        <div class="list">
          ${shifts.map((shift) => `
            <article class="item-card shift-card" data-shift-id="${escapeAttr(shift.id)}">
              <div class="item-row">
                <div>
                  <strong>${dateLabel(shift.date)} - ${escapeHtml(shift.startTime || '-')} a ${escapeHtml(shift.endTime || '-')}</strong>
                  <div class="muted">${formatNumber(shift.hours)} h - estimado ${money(shift.estimatedNet)}</div>
                </div>
                <div class="button-row compact">
                  <button class="action-button secondary edit-shift-modal" data-id="${escapeAttr(shift.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>
                  <button class="action-button danger delete-shift" data-id="${escapeAttr(shift.id)}" type="button"><i data-lucide="trash-2"></i>Borrar</button>
                </div>
              </div>
            </article>
          `).join('') || empty('Todavia no hay turnos guardados.')}
        </div>
      </section>
    </section>
  `;

  bindWorkCalculators(plan, accounts);
  $$('.edit-shift-modal').forEach((button) => button.addEventListener('click', () => openShiftEditModal(shifts.find((shift) => shift.id === button.dataset.id))));
  $$('.delete-shift').forEach((button) => button.addEventListener('click', () => deleteShift(button.dataset.id)));
}

async function renderToday(force = false) {
  const data = await getViewData('today', force);
  state.cache.today = data;
  state.cache.dashboard = data;
  state.cache.accounts = data.accounts || [];
  state.cache.incomeSources = data.incomeSources || [];

  const status = data.financialStatus || data.recommendation || {};
  const statusLabel = status.status === 'green' ? 'Puedes avanzar' : status.status === 'yellow' ? 'Cuidado' : 'No gastar todavia';
  const nextBill = (data.upcomingBills || []).find((bill) => Number(bill.remaining || 0) > 0) || null;
  const nextPaycheck = (data.pendingPaychecks || [])[0] || data.nextPaycheck || null;
  const capitalOne = accountBalance(data.accounts, 'Capital One');
  const moneyNotToTouch = Number(status.moneyNotToTouch ?? data.totals?.reserved ?? 0);
  const freeReal = Number(status.freeReal ?? data.totals?.freeReal ?? 0);
  const pendingBankDeduction = Number(data.totals?.pendingBankDeduction ?? data.context?.pendingBankDeduction ?? 0);
  const realAvailableBeforeReserves = Number(data.totals?.realAvailableBeforeReserves ?? data.context?.realAvailableBeforeReserves ?? 0);
  const steps = (status.steps || data.recommendation?.steps || []).slice(0, 3);

  $('#view').innerHTML = `
    <section class="today-shell">
      <article class="today-hero ${levelClass(status.status)}">
        <div>
          <span class="today-kicker">Estado de la semana</span>
          <h3>${escapeHtml(statusLabel)}</h3>
          <p>${escapeHtml(status.message || data.recommendation?.message || 'Revisa lo importante antes de mover dinero.')}</p>
        </div>
        <span class="status-pill ${levelClass(status.status)}">${escapeHtml(status.status || 'red')}</span>
      </article>

      <section class="money-strip">
        ${simpleMoneyCard('Capital One', capitalOne, 'Balance para pagos diarios')}
        ${simpleMoneyCard('No tocar', money(moneyNotToTouch), 'Pagos, gasolina, comida y buffer')}
        ${simpleMoneyCard('Libre real', money(freeReal), freeReal > 0 ? 'Dinero que puedes considerar' : 'No uses dinero extra ahora', freeReal > 0 ? 'green' : 'red')}
      </section>

      ${pendingBankDeduction > 0 ? `
        <article class="bank-note">
          <i data-lucide="circle-alert"></i>
          <div>
            <strong>Pagado, pendiente del banco</strong>
            <span>Hay ${money(pendingBankDeduction)} ya pagados que todavia no se han descontado. Trata tu dinero disponible antes de otras reservas como ${money(realAvailableBeforeReserves)}.</span>
          </div>
        </article>
      ` : ''}

      <section class="today-grid">
        <article class="panel today-focus">
          <div class="panel-head">
            <div>
              <h3>Proximo paso</h3>
              <p>${escapeHtml(status.title || 'Primero lo importante')}</p>
            </div>
          </div>
          <strong class="next-action">${escapeHtml(status.nextAction || steps[0] || 'Revisa pagos y cheques pendientes.')}</strong>
          <div class="mini-checklist">
            ${steps.map((step) => `<div><i data-lucide="check-circle-2"></i><span>${escapeHtml(step)}</span></div>`).join('') || '<div><i data-lucide="check-circle-2"></i><span>Sin pasos urgentes por ahora.</span></div>'}
          </div>
        </article>

        <article class="panel today-focus">
          <div class="panel-head"><h3>Lo que viene</h3></div>
          <div class="simple-list">
            <div>
              <span>Pago importante</span>
              <strong>${nextBill ? `${escapeHtml(nextBill.name)} - ${money(nextBill.remaining)}` : 'Sin pago cercano'}</strong>
              <small>${nextBill ? dateLabel(nextBill.dueDate) : 'Nada urgente registrado'}</small>
            </div>
            <div>
              <span>Cheque por verificar</span>
              <strong>${nextPaycheck ? money(nextPaycheck.netEstimated || nextPaycheck.netActual || 0) : 'Sin cheque pendiente'}</strong>
              <small>${nextPaycheck ? dateLabel(nextPaycheck.expectedDate) : 'No hay verificacion pendiente'}</small>
            </div>
          </div>
        </article>
      </section>

      <section class="quick-actions">
        <button class="quick-button" data-quick="verify-paycheck" type="button"><i data-lucide="badge-dollar-sign"></i><span>Ya recibi un cheque</span></button>
        <button class="quick-button" data-quick="payment" type="button"><i data-lucide="receipt"></i><span>Ya hice un pago</span></button>
        <button class="quick-button" data-quick="balance" type="button"><i data-lucide="wallet"></i><span>Actualizar balance</span></button>
        <button class="quick-button" data-go="whatnow" type="button"><i data-lucide="circle-help"></i><span>Calcular que hago ahora</span></button>
      </section>

      <section class="quick-secondary">
        <button class="action-button secondary" data-quick="daughter" type="button"><i data-lucide="hand-coins"></i>Pago a hija</button>
        <button class="action-button secondary" data-quick="gas" type="button"><i data-lucide="fuel"></i>Gasolina cubierta</button>
        <button class="action-button secondary" data-quick="reserve-phone" type="button"><i data-lucide="phone"></i>Telefono/internet reservado</button>
      </section>
    </section>
  `;

  bindGoButtons();
  bindQuickActions();
}

async function renderDashboard(force = false) {
  const data = await getViewData('dashboard', force);
  state.cache.dashboard = data;
  state.cache.accounts = data.accounts || [];
  state.cache.incomeSources = data.incomeSources || [];
  const actionCenter = sortByDateAsc(data.actionCenter || [], 'dueDate');
  const alerts = sortAlerts(data.alerts || []);
  const upcomingBills = sortByDateAsc(data.upcomingBills || [], 'dueDate');
  const pendingPaychecks = sortByDateAsc(data.pendingPaychecks || [], 'expectedDate');

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
        ${renderActionCenter(actionCenter)}
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
        <div class="list compact-list">
          ${(data.recommendation.steps || []).slice(0, 3).map((step) => `<div class="muted-line">${escapeHtml(step)}</div>`).join('')}
        </div>
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
            <p>${alerts.length} activas</p>
          </div>
        </div>
        ${renderAlertList(alerts.slice(0, 6))}
      </div>

      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Proximos pagos</h3>
            <p>14 dias</p>
          </div>
        </div>
        ${renderUpcomingBills(upcomingBills.slice(0, 7))}
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
        ${renderPaycheckMini(pendingPaychecks)}
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

async function renderMoney(force = false) {
  const data = await getViewData('accounts', force);
  const accounts = data.accounts || [];
  state.cache.accounts = accounts;
  $('#view').innerHTML = `
    <section class="today-shell">
      <section class="money-strip">
        ${accounts.map((account) => simpleMoneyCard(account.name, money(account.currentBalance), account.isProtected ? 'No tocar' : account.purpose || account.type, account.isProtected ? 'green' : 'blue')).join('')}
      </section>
      <section class="quick-actions">
        <button class="quick-button" data-quick="balance" type="button"><i data-lucide="wallet"></i><span>Actualizar Capital One</span></button>
        <button class="quick-button" data-go="accounts" type="button"><i data-lucide="settings-2"></i><span>Ver cuentas avanzado</span></button>
      </section>
    </section>
  `;
  bindGoButtons();
  bindQuickActions();
}

async function renderMore() {
  const advanced = state.simpleMode ? [] : [['incomes', 'Ingresos', 'banknote']];
  const items = MORE_NAV.concat(advanced);
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Mas opciones</h3>
          <p>${state.simpleMode ? 'Modo simple activo' : 'Modo avanzado activo'}</p>
        </div>
        <button id="modeToggle" class="action-button secondary" type="button">
          <i data-lucide="${state.simpleMode ? 'sliders-horizontal' : 'sparkles'}"></i>${state.simpleMode ? 'Activar avanzado' : 'Volver a simple'}
        </button>
      </div>
      <div class="more-grid">
        ${items.map(([id, label, icon]) => `
          <button class="more-card" data-go="${id}" type="button">
            <i data-lucide="${icon}"></i>
            <span>${escapeHtml(label)}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
  $('#modeToggle').addEventListener('click', () => {
    state.simpleMode = !state.simpleMode;
    localStorage.setItem('mcf_mode', state.simpleMode ? 'simple' : 'advanced');
    renderView('more', true);
  });
  bindGoButtons();
}

async function renderBackup() {
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Backup</h3>
          <p>Exportar o importar datos sin tocar la vista simple.</p>
        </div>
      </div>
      <div class="button-row">
        <button id="exportBackup" class="action-button primary" type="button"><i data-lucide="download"></i>Exportar JSON</button>
        <label class="action-button secondary">
          <i data-lucide="upload"></i>
          Importar JSON
          <input id="importBackup" type="file" accept="application/json" hidden>
        </label>
      </div>
    </section>
  `;
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('change', importBackup);
}

async function renderAccounts(force = false) {
  const data = await getViewData('accounts', force);
  const accounts = data.accounts || [];
  const transfers = sortByDateDesc(data.transfers || [], 'date');
  state.cache.accounts = accounts;
  const accountOptions = options(accounts, 'id', 'name');
  const plan = normalizeWeeklyPlan(data.weeklyPlan ? data : (state.cache.today || { accounts }));

  $('#view').innerHTML = `
    <section class="home-shell">
      <section class="money-strip">
        ${accounts.map((account) => simpleMoneyCard(account.name, money(account.currentBalance), account.purpose || account.type, account.isProtected ? 'green' : 'blue')).join('')}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Reparto sugerido</h3>
            <p>Usa esto antes de mover dinero.</p>
          </div>
        </div>
        <div class="account-plan-grid">
          ${accountPlanCard('Capital One', plan.distribution.capitalOneKeep, 'Debe cubrir pagos normales y gastos diarios.')}
          ${accountPlanCard('VyStar Checking', plan.distribution.vystarCheckingMove, 'Separar pagos futuros, mantenimiento o deuda extra.')}
          ${accountPlanCard('VyStar Savings', plan.distribution.vystarSavingsMove, 'Ahorro real, solo si todo lo importante esta cubierto.')}
        </div>
        <p class="muted-line">${escapeHtml(plan.distribution.message || 'Si algo falta, no muevas dinero a savings todavia.')}</p>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Actualizar balances</h3></div>
        <div class="list">
          ${accounts.map((account) => `
            <form class="inline-form balance-form account-balance-row" data-id="${escapeHtml(account.id)}">
              <strong>${escapeHtml(account.name)}</strong>
              <input name="currentBalance" type="number" step="0.01" value="${Number(account.currentBalance || 0)}">
              <button class="action-button secondary" type="submit"><i data-lucide="refresh-cw"></i>Actualizar</button>
            </form>
          `).join('') || empty('No hay cuentas.')}
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
    </section>
  `;

  $('#transferForm').addEventListener('submit', submitTransfer);
  $$('.balance-form').forEach((form) => form.addEventListener('submit', submitBalance));
}

async function renderIncomes(force = false) {
  const data = await getViewData('incomes', force);
  const sources = data.sources || [];
  const paychecks = sortByDateDesc(data.paychecks || [], 'expectedDate');
  const accounts = data.accounts || [];
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

async function renderPaychecks(force = false) {
  const data = await getViewData('paychecks', force);
  const pending = sortByDateAsc(data.pending || [], 'expectedDate');
  const sources = data.sources || [];
  state.cache.incomeSources = sources;
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Verificacion semanal de cheques</h3>
          <p id="paycheckPendingCount">${pending.length} pendientes</p>
        </div>
      </div>
      <div id="paychecksList" class="list">
        ${pending.map((paycheck) => `
          <article class="item-card alert ${levelClass(paycheck.alertLevel)} paycheck-item" data-paycheck-id="${escapeAttr(paycheck.id)}">
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

async function renderBills(force = false) {
  const data = await getViewData('bills', force);
  const upcomingAll = sortByDateAsc(data.upcoming || [], 'dueDate');
  const upcoming = upcomingAll.filter((bill) => Number(bill.remaining || 0) > 0);
  state.cache.accounts = data.accounts || [];
  state.cache.bills = data.bills || [];
  state.cache.upcomingBills = upcomingAll;
  $('#view').innerHTML = `
    <section class="today-shell">
      <article class="panel">
        <div class="panel-head">
          <div>
            <h3>Pagos proximos</h3>
            <p>Primero los mas cercanos</p>
          </div>
          <button class="action-button secondary" data-quick="payment" type="button"><i data-lucide="check-circle"></i>Ya hice un pago</button>
        </div>
        <div class="simple-list">
          ${upcoming.slice(0, 6).map((bill) => `
            <div class="bill-payment-item" data-bill-id="${escapeAttr(bill.billId)}" data-due="${escapeAttr(bill.dueDate)}">
              <span>${dateLabel(bill.dueDate)}</span>
              <strong>${escapeHtml(bill.name)}</strong>
              <small>Total ${money(bill.amount)} · Pagado ${money(bill.amountPaid || 0)} · Falta ${money(bill.remaining || 0)}</small>
              <small>${escapeHtml(paymentStatusLabel(bill))}${Number(bill.pendingBankDeduction || 0) > 0 ? ` · pendiente del banco ${money(bill.pendingBankDeduction)}` : ''}</small>
            </div>
          `).join('') || '<div><strong>No hay pagos pendientes cerca.</strong><small>Todo se ve tranquilo por ahora.</small></div>'}
        </div>
      </article>
      <section class="quick-actions">
        <button class="quick-button" data-quick="daughter" type="button"><i data-lucide="hand-coins"></i><span>Registrar pago a hija</span></button>
        <button class="quick-button" data-quick="reserve-phone" type="button"><i data-lucide="phone"></i><span>Telefono/internet reservado</span></button>
        <button class="quick-button" data-quick="balance" type="button"><i data-lucide="wallet"></i><span>Actualizar balance</span></button>
      </section>
    </section>
  `;
  bindGoButtons();
  bindQuickActions();
}

async function renderBillsAdvanced(force = false) {
  const data = await getViewData('bills', force);
  const bills = data.bills || [];
  const upcoming = sortByDateAsc(data.upcoming || [], 'dueDate');
  const accounts = data.accounts || [];
  state.cache.accounts = accounts;
  state.cache.bills = bills;
  state.cache.upcomingBills = upcoming;

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
            <article class="item-card alert bill-payment-item ${bill.remaining <= 0 ? 'green' : levelClass(bill.priority)}" data-bill-id="${escapeAttr(bill.billId)}" data-due="${escapeAttr(bill.dueDate)}">
              <div class="item-row">
                <div>
                  <strong>${escapeHtml(bill.name)}</strong>
                  <div class="muted">${dateLabel(bill.dueDate)} - total ${money(bill.amount)} - pagado ${money(bill.amountPaid || 0)} - falta ${money(bill.remaining)}</div>
                  ${Number(bill.pendingBankDeduction || 0) > 0 ? `<div class="muted">Pagado, pero faltan ${money(bill.pendingBankDeduction)} por descontarse del banco.</div>` : ''}
                </div>
                ${badge(bill.remaining <= 0 ? 'green' : levelClass(bill.priority), paymentStatusLabel(bill))}
              </div>
              <form class="inline-form bill-pay-form" data-id="${escapeHtml(bill.billId)}" data-due="${escapeHtml(bill.dueDate)}" data-amount="${Number(bill.remaining || bill.amount)}">
                <input name="amount" type="number" step="0.01" value="${Number(bill.remaining || bill.amount)}">
                <select name="bankState">
                  <option value="deducted">Ya salio del banco</option>
                  <option value="pending">Pagado pero no descontado</option>
                </select>
                <button class="action-button primary" data-kind="paid" type="submit"><i data-lucide="check-circle"></i>Pagado completo</button>
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

async function renderDebts(force = false) {
  const data = await getViewData('debts', force);
  const debts = data.debts || [];
  const strategy = data.strategy || {};
  const accounts = data.accounts || [];
  state.cache.accounts = accounts;

  $('#view').innerHTML = `
    <section class="home-shell">
      <section class="home-metrics">
        ${simpleMoneyCard('Total de deuda', money(strategy.totalBalance), 'Usando balances individuales', 'red')}
        ${simpleMoneyCard('Minimo mensual', money(strategy.totalMinimums), 'Pagos minimos primero', 'yellow')}
        ${simpleMoneyCard('Proxima meta', strategy.nextTarget ? strategy.nextTarget.name : 'Sin deuda', 'Snowball', 'blue')}
        ${simpleMoneyCard('Extra permitido', strategy.extraAllowed ? 'Si' : 'No', strategy.extraAllowed ? 'Solo manteniendo buffer' : 'Primero pagos importantes', strategy.extraAllowed ? 'green' : 'red')}
      </section>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>Estrategia</h3>
            <p>${escapeHtml(strategy.message || 'Paga minimos primero. Extra solo si sobra dinero real.')}</p>
          </div>
        </div>
        <p class="muted-line">Orden snowball: ${escapeHtml((strategy.recommendedOrder || []).join(' -> ') || 'Deuda 2 -> Deuda 1 -> Deuda 3')}</p>
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
                <div class="muted">Minimo ${money(debt.minimumPayment)} - dia ${escapeHtml(debt.dueDay)} - faltan aprox. ${Math.ceil(Number(debt.balance || 0) / Math.max(1, Number(debt.minimumPayment || 1)))} pagos</div>
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

  $$('.debt-payment').forEach((form) => form.addEventListener('submit', submitDebtPayment));
  $$('.edit-debt').forEach((button) => button.addEventListener('click', () => openDebtEditModal(debts.find((d) => d.id === button.dataset.id))));
}

async function renderShifts(force = false) {
  const data = await getViewData('shifts', force);
  const sources = data.sources || [];
  const shifts = sortByDateDesc(data.shifts || [], 'date');
  const amazon = sources.find((s) => /amazon/i.test(s.name)) || sources[0] || {};
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Turno trabajado</h3></div>
        <form id="shiftForm" class="form-grid">
          <input type="hidden" name="id">
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
            <button id="resetShiftForm" class="action-button secondary" type="button"><i data-lucide="rotate-ccw"></i>Nuevo</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head"><h3>Historial de turnos</h3></div>
        ${table(['Fecha', 'Horario', 'Horas', 'Rate', 'Neto estimado', 'Cheque', 'Accion'], shifts.map((shift) => [
          dateLabel(shift.date),
          `${escapeHtml(shift.startTime || '-')} - ${escapeHtml(shift.endTime || '-')}`,
          Number(shift.hours || 0).toFixed(2),
          money(shift.rate),
          money(shift.estimatedNet),
          shift.linkedPaycheckId ? 'Creado' : '-',
          `<div class="button-row compact">
            <button class="action-button secondary edit-shift" data-id="${escapeAttr(shift.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>
            <button class="action-button danger delete-shift" data-id="${escapeAttr(shift.id)}" type="button"><i data-lucide="trash-2"></i>Borrar</button>
          </div>`
        ]))}
      </div>
    </section>
  `;
  $('#shiftForm').addEventListener('submit', submitShift);
  $('#resetShiftForm').addEventListener('click', resetShiftForm);
  $$('.edit-shift').forEach((button) => button.addEventListener('click', () => fillShiftForm(shifts.find((shift) => shift.id === button.dataset.id))));
  $$('.delete-shift').forEach((button) => button.addEventListener('click', () => deleteShift(button.dataset.id)));
}

async function renderCalendar(force = false) {
  const data = await getViewData('calendar', force);
  const events = sortByDateAsc(data.events || [], 'date');
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
  const today = state.cache.today || await getViewData('home');
  const capitalOneAccount = (today.accounts || []).find((account) => account.name === 'Capital One') || {};
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Calculadora</h3></div>
        <form id="whatNowForm" class="form-grid">
          <label class="wide">Balance actual si cambio<input name="currentMoney" type="number" step="0.01" value="${Number(capitalOneAccount.currentBalance || 0)}"></label>
          <label><input class="check-toggle" name="paycheckConfirmed" type="checkbox"> Ya recibi cheque</label>
          <label><input class="check-toggle" name="gasPending" type="checkbox" ${today.context?.gasPending === false ? '' : 'checked'}> Falta gasolina</label>
          <label class="wide">Pago parcial hecho hoy<input name="daughterPaid" type="number" step="0.01" value="${Number(today.context?.daughter?.paid || 0)}"></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="calculator"></i>Calcular</button>
          </div>
        </form>
      </div>
      <div id="whatNowResult" class="panel span-7">
        <div class="empty">Usare tus balances, pagos, cheques y settings actuales.</div>
      </div>
    </section>
  `;
  $('#whatNowForm').addEventListener('submit', submitWhatNow);
}

async function renderChecklist(force = false) {
  const data = await getViewData('checklist', force);
  const items = sortByDateAsc(data.items || [], 'dueDate');
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
        ${items.map((item) => `
          <article class="item-card check-item">
            <input class="check-toggle checklist-toggle" data-id="${escapeHtml(item.id)}" type="checkbox" ${item.completed ? 'checked' : ''}>
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <div class="muted">${escapeHtml(item.description || '')}</div>
              <div class="muted">${dateLabel(item.dueDate)} - ${item.completed ? 'Ya hice esto.' : 'Esto todavia falta.'}</div>
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

async function renderNotifications(force = false) {
  const data = await getViewData('notifications', force);
  const alerts = sortAlerts(data.alerts || []);
  const notifications = sortAlerts(data.notifications || []);
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-7">
        <div class="panel-head">
          <div>
            <h3>Alertas activas</h3>
            <p>Ordenadas por fecha mas cercana</p>
          </div>
        </div>
        ${renderAlertList(alerts)}
      </div>

      <div class="panel span-5">
        <div class="panel-head">
          <div>
            <h3>Recordatorios internos</h3>
            <p>Pendientes, pospuestos y abiertos</p>
          </div>
        </div>
        <div class="list">
        ${notifications.map((notification) => `
          <article class="item-card alert-card ${levelClass(notification.priority)}">
            <div class="alert-icon ${levelClass(notification.priority)}">
              <i data-lucide="${alertIcon(notification)}"></i>
            </div>
            <div class="alert-content">
              <div class="item-row">
                <div>
                  <strong>${escapeHtml(notification.title)}</strong>
                  <div class="muted">${escapeHtml(notification.message)}</div>
                  <div class="action-meta">
                    <span class="date-chip"><i data-lucide="calendar"></i>${dateLabel(notification.dueDate)}</span>
                    <span>${escapeHtml(notification.type || 'general')}</span>
                  </div>
                </div>
                ${badge(levelClass(notification.priority), notification.status || 'open')}
              </div>
              <div class="button-row">
                <button class="action-button secondary resolve-notification" data-id="${escapeHtml(notification.id)}" type="button"><i data-lucide="check"></i>Resolver</button>
                <button class="action-button secondary snooze-notification" data-id="${escapeHtml(notification.id)}" type="button"><i data-lucide="clock"></i>Posponer</button>
              </div>
            </div>
          </article>
        `).join('') || empty('No hay recordatorios internos.')}
        </div>
      </div>
    </section>
  `;
  $$('.resolve-notification').forEach((button) => button.addEventListener('click', () => resolveNotification(button.dataset.id)));
  $$('.snooze-notification').forEach((button) => button.addEventListener('click', () => snoozeNotification(button.dataset.id)));
  bindGoButtons();
}

async function renderSettings(force = false) {
  const data = await getViewData('settings', force);
  const settings = data.settings || {};
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
              <input name="newPassword" type="password" minlength="12" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,}" title="Minimo 12 caracteres con mayuscula, minuscula, numero y simbolo" autocomplete="new-password" required>
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
    refreshViewsQuietly('home');
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
  const form = event.currentTarget;
  const id = form.dataset.id;
  await guarded(async () => {
    await api('verifyPaycheck', { id, ...formValues(form) });
    confirmActionDone('Cheque recibido', 'Lo quite de pendientes y estoy buscando la siguiente fecha.');
    removePaycheckItem(id);
    refreshViewsQuietly('home');
    refreshAndRenderQuietly('paychecks');
  });
}

async function markNotReceived(id) {
  await guarded(async () => {
    await api('markPaycheckNotReceived', { id });
    confirmActionDone('Cheque marcado como no recibido', 'Lo quite de pendientes y estoy actualizando las siguientes fechas.');
    removePaycheckItem(id);
    refreshViewsQuietly('home');
    refreshAndRenderQuietly('paychecks');
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
  const form = event.currentTarget;
  const values = formValues(form);
  const payment = {
    billId: form.dataset.id,
    dueDate: form.dataset.due,
    amount: Number(values.amount || form.dataset.amount || 0),
    full: true,
    pendingBankDeduction: values.bankState === 'pending'
  };
  await guarded(async () => {
    setFormDisabled(form, true);
    await api('markBillPaid', {
      ...payment,
      alreadyDeductedFromBank: values.bankState !== 'pending',
      pendingBankDeduction: values.bankState === 'pending'
    });
    confirmPaymentSaved(payment);
  });
  setFormDisabled(form, false);
}

async function submitBillPartial(event) {
  const form = event.currentTarget.closest('form');
  const values = formValues(form);
  const payment = {
    billId: form.dataset.id,
    dueDate: form.dataset.due,
    amount: Number(values.amount || 0),
    full: false,
    pendingBankDeduction: values.bankState === 'pending'
  };
  await guarded(async () => {
    setFormDisabled(form, true);
    await api('markBillPartial', {
      billId: payment.billId,
      dueDate: payment.dueDate,
      partialAmount: payment.amount,
      alreadyDeductedFromBank: values.bankState !== 'pending',
      pendingBankDeduction: values.bankState === 'pending'
    });
    confirmPaymentSaved(payment);
  });
  setFormDisabled(form, false);
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
    confirmActionDone('Turno guardado', 'El historial se actualiza con los cambios.');
    refreshAndRenderQuietly('shifts');
  });
}

async function deleteShift(id) {
  if (!id || !window.confirm('Borrar este turno del historial?')) return;
  await guarded(async () => {
    await api('deleteWorkShift', { id });
    confirmActionDone('Turno borrado', 'Se quito del historial.');
    removeShiftRow(id);
    refreshAndRenderQuietly(state.activeView === 'work' ? 'work' : 'shifts');
    refreshViewsQuietly('home');
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
        <div class="item-card alert ${levelClass(result.recommendation.level)}">
          <strong>${escapeHtml(result.recommendation.title)}</strong>
          <span>${escapeHtml(result.recommendation.message)}</span>
        </div>
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
  const form = event.currentTarget;
  await guarded(async () => {
    await api('changePassword', formValues(form));
    form.reset();
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
    renderView('home', true);
  });
}

function bindQuickActions() {
  $$('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.quick;
      if (action === 'balance') openBalanceModal();
      if (action === 'payment') openPaymentModal(false);
      if (action === 'daughter') openPaymentModal(true);
      if (action === 'verify-paycheck') openPaycheckModal();
      if (action === 'gas') markGasCovered();
      if (action === 'reserve-phone') markPhoneInternetReserved();
    });
  });
}

function openBalanceModal() {
  const data = state.cache.today || state.cache.dashboard || {};
  const account = (data.accounts || state.cache.accounts || []).find((item) => item.name === 'Capital One');
  if (!account) {
    toast('No encontre Capital One.');
    return;
  }
  openQuickModal('Actualizar Capital One', `
    <label>Balance nuevo<input name="currentBalance" type="number" step="0.01" value="${Number(account.currentBalance || 0)}" required></label>
    <label class="check-row"><input name="clearPendingBankDeductions" type="checkbox"> Los pagos pendientes ya salieron del banco</label>
  `, async (values) => {
    await api('updateAccountBalance', {
      id: account.id,
      currentBalance: values.currentBalance,
      clearPendingBankDeductions: Boolean(values.clearPendingBankDeductions)
    });
    toast('Balance actualizado.');
    await renderView(state.activeView, true);
  });
}

function openPaymentModal(daughterOnly) {
  const data = state.cache.today || state.cache.dashboard || {};
  const upcoming = (state.cache.upcomingBills || data.upcomingBills || [])
    .filter((bill) => Number(bill.remaining || 0) > 0)
    .filter((bill) => !daughterOnly || /hija/i.test(bill.name) || bill.billId === 'bill_daughter');
  if (!upcoming.length) {
    toast(daughterOnly ? 'No encontre pago pendiente de hija.' : 'No hay pagos pendientes cerca.');
    return;
  }
  openQuickModal(daughterOnly ? 'Registrar pago a hija' : 'Registrar pago hecho', `
    <label>Pago
      <select name="billKey">
        ${upcoming.map((bill) => `<option value="${escapeAttr(`${bill.billId}|${bill.dueDate}`)}">${escapeHtml(bill.name)} - ${money(bill.remaining)} - ${dateLabel(bill.dueDate)}</option>`).join('')}
      </select>
    </label>
    <label>Monto pagado<input name="amount" type="number" step="0.01" value="${Number(upcoming[0].remaining || upcoming[0].amount || 0)}" required></label>
    <label>Cuenta
      <select name="account">
        ${options(data.accounts || state.cache.accounts || [], 'id', 'name')}
      </select>
    </label>
    <label>Fecha de pago<input name="paymentDate" type="date" value="${todayIso()}"></label>
    <label>Banco
      <select name="bankState">
        <option value="deducted">Ya salio del banco</option>
        <option value="pending">Pagado pero no descontado</option>
      </select>
    </label>
    <label>Nota<input name="notes" placeholder="Opcional"></label>
  `, async (values) => {
    const [billId, dueDate] = String(values.billKey || '').split('|');
    const bill = upcoming.find((item) => item.billId === billId && item.dueDate === dueDate);
    const amount = Number(values.amount || 0);
    const payment = {
      billId,
      dueDate,
      amount,
      full: Boolean(bill && amount >= Number(bill.remaining || bill.amount || 0)),
      pendingBankDeduction: values.bankState === 'pending'
    };
    const common = {
      billId,
      dueDate,
      amount,
      account: values.account,
      paymentDate: values.paymentDate,
      alreadyDeductedFromBank: values.bankState !== 'pending',
      pendingBankDeduction: values.bankState === 'pending',
      notes: values.notes
    };
    if (bill && amount >= Number(bill.remaining || bill.amount || 0)) {
      await api('markBillPaid', common);
    } else {
      await api('markBillPartial', { ...common, partialAmount: amount });
    }
    confirmPaymentSaved(payment);
  });
}

async function openPaycheckModal() {
  const data = state.cache.today || await getViewData('home');
  const pending = data.pendingPaychecks || [];
  if (!pending.length) {
    toast('No hay cheques pendientes.');
    return;
  }
  openQuickModal('Verificar cheque', `
    <label>Cheque
      <select name="id">
        ${pending.map((paycheck) => `<option value="${escapeAttr(paycheck.id)}">${dateLabel(paycheck.expectedDate)} - ${money(paycheck.netEstimated)} - ${escapeHtml(incomeName(paycheck.incomeSourceId))}</option>`).join('')}
      </select>
    </label>
    <label>Estado
      <select name="status">
        <option value="received">Recibido</option>
        <option value="not_received">No recibido</option>
      </select>
    </label>
    <label>Monto real<input name="netActual" type="number" step="0.01" value="${Number(pending[0].netEstimated || 0)}"></label>
  `, async (values) => {
    if (values.status === 'not_received') {
      await api('markPaycheckNotReceived', { id: values.id });
    } else {
      await api('verifyPaycheck', { id: values.id, netActual: values.netActual });
    }
    confirmActionDone('Cheque actualizado', 'Quedo marcado. La informacion se sincroniza sola.');
    removePendingPaycheckLocally(values.id);
    removePaycheckItem(values.id);
    refreshViewsQuietly('home');
    if (state.activeView === 'paychecks') {
      refreshAndRenderQuietly('paychecks');
    }
  });
}

async function markGasCovered() {
  await guarded(async () => {
    await api('markGasCovered');
    confirmActionDone('Gasolina cubierta', 'Quedo marcado. Ya no se debe tratar como pendiente.');
    refreshViewsQuietly('home');
  });
}

async function markPhoneInternetReserved() {
  await guarded(async () => {
    await api('markPhoneInternetReserved');
    confirmActionDone('Telefono e internet reservados', 'Quedo marcado. La pantalla se actualiza sola.');
    refreshViewsQuietly('home');
  });
}

function confirmPaymentSaved(payment) {
  const bill = findCachedBill(payment.billId, payment.dueDate);
  const name = bill?.name || 'Pago';
  applyLocalBillPayment(payment);
  if (payment.full) {
    removeBillPaymentItem(payment);
  } else {
    markBillPaymentItem(payment, name);
  }
  confirmActionDone(
    payment.full ? 'Pago registrado' : 'Pago parcial registrado',
    `${name} quedo guardado por ${money(payment.amount)}. ${payment.pendingBankDeduction ? 'Todavia no lo uses: falta que salga del banco.' : (payment.full ? 'Ya no queda como pendiente.' : 'Se desconto el monto pagado.')}`
  );
  if (state.activeView === 'home' || state.activeView === 'today') {
    refreshAndRenderQuietly(state.activeView);
  } else {
    refreshViewsQuietly('home');
  }
  refreshAndRenderQuietly('bills');
}

function confirmActionDone(title, detail) {
  toast(title, {
    type: 'success',
    icon: 'check-circle-2',
    detail
  });
}

function findCachedBill(billId, dueDate) {
  const sources = [
    state.cache.upcomingBills,
    state.cache.today?.upcomingBills,
    state.cache.dashboard?.upcomingBills
  ];
  for (const list of sources) {
    const found = (list || []).find((bill) => sameBill(bill, billId, dueDate));
    if (found) return found;
  }
  return null;
}

function sameBill(bill, billId, dueDate) {
  return String(bill?.billId || bill?.id || '') === String(billId || '') && String(bill?.dueDate || '') === String(dueDate || '');
}

function applyLocalBillPayment(payment) {
  const updateList = (list) => (list || []).map((bill) => {
    if (!sameBill(bill, payment.billId, payment.dueDate)) return bill;
    const currentRemaining = Number(bill.remaining || bill.amount || 0);
    const remaining = payment.full ? 0 : Math.max(0, currentRemaining - Number(payment.amount || 0));
    return {
      ...bill,
      remaining,
      status: remaining <= 0 ? 'paid' : 'partial'
    };
  });

  state.cache.upcomingBills = updateList(state.cache.upcomingBills);
  if (state.cache.today?.upcomingBills) {
    state.cache.today.upcomingBills = updateList(state.cache.today.upcomingBills);
  }
  if (state.cache.dashboard?.upcomingBills) {
    state.cache.dashboard.upcomingBills = updateList(state.cache.dashboard.upcomingBills);
  }
}

function markBillPaymentItem(payment, name) {
  const title = payment.full ? 'Pago registrado' : 'Pago parcial registrado';
  const detail = `${name} - ${money(payment.amount)} - ${dateLabel(payment.dueDate)}`;
  $$('.bill-payment-item').forEach((item) => {
    if (String(item.dataset.billId || '') !== String(payment.billId || '') || String(item.dataset.due || '') !== String(payment.dueDate || '')) {
      return;
    }
    item.classList.add('payment-done');
    item.innerHTML = `
      <div class="payment-confirmed">
        <i data-lucide="check-circle-2"></i>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
      </div>
    `;
  });
  refreshIcons();
}

function removeBillPaymentItem(payment) {
  $$('.bill-payment-item').forEach((item) => {
    if (String(item.dataset.billId || '') === String(payment.billId || '') && String(item.dataset.due || '') === String(payment.dueDate || '')) {
      item.remove();
    }
  });
  ensureListFallback('.simple-list', 'No hay pagos pendientes cerca.', 'Todo se ve tranquilo por ahora.');
}

function removePendingPaycheckLocally(id) {
  const remove = (list) => (list || []).filter((paycheck) => String(paycheck.id || '') !== String(id || ''));
  if (state.cache.today?.pendingPaychecks) {
    state.cache.today.pendingPaychecks = remove(state.cache.today.pendingPaychecks);
  }
  if (state.cache.dashboard?.pendingPaychecks) {
    state.cache.dashboard.pendingPaychecks = remove(state.cache.dashboard.pendingPaychecks);
  }
}

function removePaycheckItem(id) {
  $$('.paycheck-item').forEach((item) => {
    if (String(item.dataset.paycheckId || '') === String(id || '')) {
      item.remove();
    }
  });
  const count = $$('.paycheck-item').length;
  const counter = $('#paycheckPendingCount');
  if (counter) counter.textContent = `${count} pendientes`;
  ensureListFallback('#paychecksList', 'No hay cheques pendientes.', '');
  removePendingPaycheckLocally(id);
}

function removeShiftRow(id) {
  $$('.delete-shift').forEach((button) => {
    if (String(button.dataset.id || '') === String(id || '')) {
      button.closest('tr')?.remove();
    }
  });
}

function ensureListFallback(selector, title, subtitle) {
  const list = $(selector);
  if (!list || list.children.length) return;
  list.innerHTML = `<div class="empty"><strong>${escapeHtml(title)}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div>`;
}

function refreshViewsQuietly(...views) {
  const allowed = new Set(['home', 'work', 'today', 'dashboard', 'accounts', 'incomes', 'paychecks', 'bills', 'debts', 'shifts', 'calendar', 'checklist', 'notifications', 'settings']);
  Array.from(new Set(views))
    .filter((view) => allowed.has(view))
    .forEach((view) => {
      apiCached('getViewData', viewPayload(view), { force: true, ttlMs: CONFIG.cacheTtlMs })
        .then((data) => rememberViewData(view, data))
        .catch((error) => console.warn('Background refresh failed:', error));
    });
}

function refreshAndRenderQuietly(view) {
  apiCached('getViewData', viewPayload(view), { force: true, ttlMs: CONFIG.cacheTtlMs })
    .then((data) => {
      rememberViewData(view, data);
      if (state.activeView === view) {
        renderView(view, false);
      }
    })
    .catch((error) => console.warn('Background refresh failed:', error));
}

function rememberViewData(view, data) {
  if (view === 'home' || view === 'today' || view === 'work') {
    state.cache.today = data;
    state.cache.dashboard = data;
    state.cache.accounts = data.accounts || state.cache.accounts || [];
    state.cache.incomeSources = data.incomeSources || state.cache.incomeSources || [];
    state.cache.upcomingBills = data.upcomingBills || state.cache.upcomingBills || [];
    state.cache.shifts = data.shifts || state.cache.shifts || [];
    return;
  }
  if (view === 'bills') {
    state.cache.bills = data.bills || state.cache.bills || [];
    state.cache.upcomingBills = sortByDateAsc(data.upcoming || [], 'dueDate');
    state.cache.accounts = data.accounts || state.cache.accounts || [];
  }
  if (view === 'paychecks') {
    state.cache.pendingPaychecks = data.pending || [];
    state.cache.incomeSources = data.sources || state.cache.incomeSources || [];
  }
  if (view === 'shifts') {
    state.cache.shifts = data.shifts || [];
    state.cache.incomeSources = data.sources || state.cache.incomeSources || [];
  }
}

function openQuickModal(title, bodyHtml, onSubmit) {
  closeQuickModal();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <section class="quick-modal" role="dialog" aria-modal="true">
      <div class="panel-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-button modal-close" type="button" title="Cerrar"><i data-lucide="x"></i></button>
      </div>
      <form class="stack quick-modal-form">
        ${bodyHtml}
        <div class="button-row">
          <button class="action-button primary" type="submit"><i data-lucide="check"></i>Guardar</button>
          <button class="action-button secondary modal-close" type="button">Cancelar</button>
        </div>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  $$('.modal-close', modal).forEach((button) => button.addEventListener('click', closeQuickModal));
  $('.quick-modal-form', modal).addEventListener('submit', async (event) => {
    event.preventDefault();
    await guarded(async () => {
      await onSubmit(formValues(event.currentTarget));
      closeQuickModal();
    });
  });
  refreshIcons();
}

function closeQuickModal() {
  $$('.modal-backdrop').forEach((modal) => modal.remove());
}

function normalizeWeeklyPlan(data) {
  const accounts = data.accounts || [];
  const capitalOne = findAccountByName(accounts, 'Capital One');
  const checking = findAccountByName(accounts, 'VyStar Checking');
  const savings = findAccountByName(accounts, 'VyStar Savings');
  const totals = data.totals || {};
  const status = data.weeklyPlan?.status || data.financialStatus || {};
  const pendingBills = (data.billsBeforeNextPaycheck?.bills || data.upcomingBills || []).filter((bill) => Number(bill.remaining || 0) > 0);
  const mainSource = (data.incomeSources || []).find((source) => /principal/i.test(source.name)) || {};
  const amazonSource = (data.incomeSources || []).find((source) => /amazon/i.test(source.name)) || {};

  if (data.weeklyPlan) {
    return data.weeklyPlan;
  }

  const expectedMain = Number(mainSource.fixedNetPay || 711.86);
  const expectedAmazon = 293.04;
  return {
    income: {
      expectedMain,
      expectedAmazon,
      expectedTotal: expectedMain + expectedAmazon,
      receivedRealThisWeek: 0
    },
    outflows: {
      beforeNextPaycheck: Number(data.billsBeforeNextPaycheck?.totalRemaining || 0),
      debtMinimums: 0,
      gasEstimate: Number(data.context?.gasAmount || 60),
      pendingBankDeduction: Number(totals.pendingBankDeduction || 0)
    },
    totals: {
      visibleAvailable: Number(totals.totalRegistered || 0),
      realAvailableBeforeReserves: Number(totals.realAvailableBeforeReserves || 0),
      moneyNotToTouch: Number(status.moneyNotToTouch || totals.reserved || 0),
      freeReal: Number(status.freeReal || totals.freeReal || 0)
    },
    status,
    recommendation: data.recommendation || status,
    payments: {
      beforeNext: pendingBills,
      nextImportant: pendingBills[0] || null
    },
    paychecks: {
      nextPending: (data.pendingPaychecks || [])[0] || null,
      nextExpected: data.nextPaycheck || null
    },
    distribution: buildDistributionFallback(status, capitalOne, checking, savings),
    work: buildWorkFallback(data)
  };
}

function buildDistributionFallback(status, capitalOne, checking, savings) {
  const freeReal = Number(status.freeReal || 0);
  const moneyNotToTouch = Number(status.moneyNotToTouch || 0);
  const canMove = freeReal > 0 && status.status !== 'red';
  const checkingMove = canMove ? Math.min(freeReal, 120) : 0;
  const savingsMove = status.status === 'green' ? Math.max(0, freeReal - checkingMove) : 0;
  return {
    capitalOneKeep: Math.max(0, moneyNotToTouch),
    vystarCheckingMove: checkingMove,
    vystarSavingsMove: savingsMove,
    balances: {
      capitalOne: Number(capitalOne?.currentBalance || 0),
      checking: Number(checking?.currentBalance || 0),
      savings: Number(savings?.currentBalance || 0)
    },
    message: canMove
      ? 'Puedes mover solo despues de dejar cubierto lo importante.'
      : 'Ahora mismo deja el dinero quieto hasta cubrir pagos, gasolina y cheques pendientes.'
  };
}

function buildWorkFallback(data) {
  const sources = data.incomeSources || [];
  const main = sources.find((source) => /principal/i.test(source.name)) || {};
  const amazon = sources.find((source) => /amazon/i.test(source.name)) || {};
  return {
    main: {
      sourceId: main.id || 'inc_main_job',
      hourlyRate: Number(main.hourlyRate || 21),
      taxRate: 0.1525,
      normalHours: 40,
      normalGross: 840,
      normalNet: Number(main.fixedNetPay || 711.86),
      days: [
        { label: 'Miercoles', hours: 10 },
        { label: 'Jueves', hours: 10 },
        { label: 'Viernes', hours: 10 },
        { label: 'Sabado', hours: 10 }
      ]
    },
    amazon: {
      sourceId: amazon.id || 'inc_amazon',
      hourlyRate: Number(amazon.hourlyRate || 18.5),
      taxRate: Number(amazon.taxRate || 0.12),
      normalHours: 18,
      normalGross: 333,
      normalNet: 293.04,
      shifts: defaultAmazonShiftRows()
    }
  };
}

function defaultAmazonShiftRows() {
  const dates = [3, 4, 5, 6].map((offset) => addDaysISO(startOfWeekDate(), offset));
  return [
    { label: 'Turno 1', date: dates[0], startTime: '13:00', endTime: '17:30', hours: 4.5 },
    { label: 'Turno 2', date: dates[1], startTime: '18:00', endTime: '22:30', hours: 4.5 },
    { label: 'Turno 3', date: dates[2], startTime: '13:00', endTime: '17:30', hours: 4.5 },
    { label: 'Turno 4', date: dates[3], startTime: '18:00', endTime: '22:30', hours: 4.5 }
  ];
}

function accountPlanCard(label, amount, detail) {
  return `
    <article class="account-plan-card">
      <span>${escapeHtml(label)}</span>
      <strong>${money(amount)}</strong>
      <small>${escapeHtml(detail || '')}</small>
    </article>
  `;
}

function bindWorkCalculators(plan, accounts) {
  const mainForm = $('#mainWorkForm');
  const amazonForm = $('#amazonWorkForm');
  if (mainForm) {
    const updateMain = () => calculateMainWork(mainForm, plan.work.main);
    $$('.main-day-check, .main-day-hours', mainForm).forEach((input) => input.addEventListener('input', updateMain));
    $('#recordMainPaycheck').addEventListener('click', () => openReceivedPaycheckModal('main', calculateMainWork(mainForm, plan.work.main), accounts));
    updateMain();
  }
  if (amazonForm) {
    const updateAmazon = () => calculateAmazonWork(amazonForm, plan.work.amazon);
    $$('.amazon-shift-check, .amazon-shift-hours, #amazonRate, #amazonBonusRate, #amazonBonusFixed', amazonForm).forEach((input) => input.addEventListener('input', updateAmazon));
    amazonForm.addEventListener('submit', submitAmazonShiftPlan);
    $('#recordAmazonPaycheck').addEventListener('click', () => openReceivedPaycheckModal('amazon', calculateAmazonWork(amazonForm, plan.work.amazon), accounts));
    updateAmazon();
  }
}

function calculateMainWork(form, defaults) {
  const rate = Number(defaults.hourlyRate || 21);
  const taxRate = Number(defaults.taxRate || 0.1525);
  const hours = $$('.work-day-row', form).reduce((total, row) => {
    return total + ($('.main-day-check', row).checked ? Number($('.main-day-hours', row).value || 0) : 0);
  }, 0);
  const gross = hours * rate;
  const taxes = gross * taxRate;
  const net = gross - taxes;
  updateCalcStrip('main', hours, gross, taxes, net);
  return { sourceId: defaults.sourceId, hours, rate, bonusRate: 0, bonusFixed: 0, gross, taxes, net };
}

function calculateAmazonWork(form, defaults) {
  const rate = Number($('#amazonRate').value || defaults.hourlyRate || 18.5);
  const taxRate = Number(defaults.taxRate || 0.12);
  const bonusRate = Number($('#amazonBonusRate').value || 0);
  const bonusFixed = Number($('#amazonBonusFixed').value || 0);
  const hours = $$('.amazon-plan-row', form).reduce((total, row) => {
    return total + ($('.amazon-shift-check', row).checked ? Number($('.amazon-shift-hours', row).value || 0) : 0);
  }, 0);
  const gross = hours * (rate + bonusRate) + bonusFixed;
  const taxes = gross * taxRate;
  const net = gross - taxes;
  updateCalcStrip('amazon', hours, gross, taxes, net);
  return { sourceId: defaults.sourceId, hours, rate, bonusRate, bonusFixed, gross, taxes, net };
}

function updateCalcStrip(prefix, hours, gross, taxes, net) {
  $(`#${prefix}CalcHours`).textContent = formatNumber(hours);
  $(`#${prefix}CalcGross`).textContent = money(gross);
  $(`#${prefix}CalcTaxes`).textContent = money(taxes);
  $(`#${prefix}CalcNet`).textContent = money(net);
}

async function submitAmazonShiftPlan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const sourceId = form.dataset.source;
  const rate = Number($('#amazonRate').value || 18.5);
  const bonusRate = Number($('#amazonBonusRate').value || 0);
  const rows = $$('.amazon-plan-row', form).filter((row) => $('.amazon-shift-check', row).checked);
  if (!rows.length) {
    toast('Marca al menos un turno.');
    return;
  }
  await guarded(async () => {
    for (const row of rows) {
      await api('saveWorkShift', {
        incomeSourceId: sourceId,
        date: $('.amazon-shift-date', row).value,
        startTime: $('.amazon-shift-start', row).value,
        endTime: $('.amazon-shift-end', row).value,
        hours: $('.amazon-shift-hours', row).value,
        rate,
        bonusRate,
        breakMinutes: 0
      });
    }
    confirmActionDone('Turnos guardados', 'Trabajo se actualizo con los turnos marcados.');
    refreshAndRenderQuietly('work');
    refreshViewsQuietly('home');
  });
}

function openReceivedPaycheckModal(kind, calc, accounts) {
  const source = (state.cache.incomeSources || []).find((item) => String(item.id) === String(calc.sourceId)) || {};
  const pending = (state.cache.today?.pendingPaychecks || []).find((paycheck) => paycheck.incomeSourceId === calc.sourceId);
  openQuickModal(kind === 'main' ? 'Cheque trabajo principal' : 'Cheque Amazon', `
    <input name="id" type="hidden" value="${escapeAttr(pending?.id || '')}">
    <input name="incomeSourceId" type="hidden" value="${escapeAttr(calc.sourceId || source.id || '')}">
    <input name="hours" type="hidden" value="${escapeAttr(calc.hours)}">
    <input name="rate" type="hidden" value="${escapeAttr(calc.rate)}">
    <input name="bonusRate" type="hidden" value="${escapeAttr(calc.bonusRate || 0)}">
    <input name="bonusFixed" type="hidden" value="${escapeAttr(calc.bonusFixed || 0)}">
    <input name="grossEstimated" type="hidden" value="${escapeAttr(roundClient(calc.gross))}">
    <input name="taxesEstimated" type="hidden" value="${escapeAttr(roundClient(calc.taxes))}">
    <input name="netEstimated" type="hidden" value="${escapeAttr(roundClient(calc.net))}">
    <label>Monto real recibido<input name="netActual" type="number" step="0.01" value="${roundClient(calc.net)}" required></label>
    <label>Cuenta<select name="account">${options(accounts, 'id', 'name', source.defaultAccount || 'acct_capital_one')}</select></label>
    <label>Fecha recibida<input name="receivedDate" type="date" value="${todayIso()}"></label>
    <label>Nota<input name="notes" placeholder="Opcional"></label>
  `, async (values) => {
    await api('recordReceivedPaycheck', values);
    confirmActionDone('Cheque registrado', 'El balance y el plan se recalculan con ese ingreso.');
    refreshViewsQuietly('home');
    refreshAndRenderQuietly('work');
  });
}

function openShiftEditModal(shift) {
  if (!shift) return;
  openQuickModal('Editar turno', `
    <input name="id" type="hidden" value="${escapeAttr(shift.id)}">
    <input name="incomeSourceId" type="hidden" value="${escapeAttr(shift.incomeSourceId)}">
    <label>Fecha<input name="date" type="date" value="${escapeAttr(shift.date)}" required></label>
    <label>Inicio<input name="startTime" type="time" value="${escapeAttr(shift.startTime || '')}"></label>
    <label>Fin<input name="endTime" type="time" value="${escapeAttr(shift.endTime || '')}"></label>
    <label>Horas<input name="hours" type="number" step="0.25" value="${Number(shift.hours || 0)}"></label>
    <label>Rate<input name="rate" type="number" step="0.01" value="${Number(shift.rate || 18.5)}"></label>
    <label>Bono/h<input name="bonusRate" type="number" step="0.01" value="${Number(shift.bonusRate || 0)}"></label>
    <label>Nota<input name="notes" value="${escapeAttr(shift.notes || '')}"></label>
  `, async (values) => {
    await api('saveWorkShift', values);
    confirmActionDone('Turno actualizado', 'El historial queda al dia.');
    refreshAndRenderQuietly('work');
    refreshViewsQuietly('home');
  });
}

function openDebtEditModal(debt) {
  if (!debt) return;
  openQuickModal('Editar deuda', `
    <input name="id" type="hidden" value="${escapeAttr(debt.id)}">
    <label>Nombre<input name="name" value="${escapeAttr(debt.name)}" required></label>
    <label>Balance<input name="balance" type="number" step="0.01" value="${Number(debt.balance || 0)}" required></label>
    <label>Balance original<input name="originalBalance" type="number" step="0.01" value="${Number(debt.originalBalance || debt.balance || 0)}"></label>
    <label>Minimo<input name="minimumPayment" type="number" step="0.01" value="${Number(debt.minimumPayment || 0)}" required></label>
    <label>Dia<input name="dueDay" value="${escapeAttr(debt.dueDay || '')}"></label>
    <input name="priority" type="hidden" value="${escapeAttr(debt.priority || 'important')}">
    <label>Notas<textarea name="notes">${escapeHtml(debt.notes || '')}</textarea></label>
  `, async (values) => {
    await api('saveDebt', values);
    confirmActionDone('Deuda actualizada', 'El resumen se recalcula.');
    refreshAndRenderQuietly('debts');
    refreshViewsQuietly('home');
  });
}

function findAccountByName(accounts, name) {
  return (accounts || []).find((account) => String(account.name || '').toLowerCase() === String(name || '').toLowerCase());
}

function startOfWeekDate() {
  const date = new Date(`${todayInput()}T12:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function addDaysISO(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + Number(days || 0));
  return copy.toISOString().slice(0, 10);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function roundClient(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
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

function fillShiftForm(shift) {
  fillForm($('#shiftForm'), shift);
}

function resetShiftForm() {
  const form = $('#shiftForm');
  if (!form) return;
  form.reset();
  form.elements.id.value = '';
  if (form.elements.date) form.elements.date.value = todayInput();
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

function viewPayload(view) {
  const base = { view };
  if (view === 'home') return { view: 'home' };
  if (view === 'work') return { view: 'work', shiftsLimit: 20 };
  if (view === 'today') return { view: 'today' };
  if (view === 'accounts') return { ...base, transfersLimit: 20 };
  if (view === 'incomes') return { ...base, paychecksLimit: 40 };
  if (view === 'bills') return { ...base, upcomingDays: 30 };
  if (view === 'shifts') return { ...base, shiftsLimit: 50 };
  if (view === 'calendar') return { ...base, days: 45, fromDate: '2026-07-01' };
  return base;
}

async function getViewData(view, force = false) {
  return apiCached('getViewData', viewPayload(view), { force, ttlMs: CONFIG.cacheTtlMs });
}

function hasWarmView(view) {
  const entry = state.requestCache[apiCacheKey('getViewData', viewPayload(view))];
  return Boolean(entry && Date.now() - entry.at < CONFIG.cacheTtlMs);
}

async function apiCached(action, payload = {}, options = {}) {
  const key = apiCacheKey(action, payload);
  const ttlMs = options.ttlMs ?? CONFIG.cacheTtlMs;
  const cached = state.requestCache[key];
  if (!options.force && cached && Date.now() - cached.at < ttlMs) {
    return cached.data;
  }

  if (!options.force && state.inFlight[key]) {
    return state.inFlight[key];
  }

  state.inFlight[key] = api(action, payload, options)
    .then((data) => {
      state.requestCache[key] = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      delete state.inFlight[key];
    });

  return state.inFlight[key];
}

function setApiCache(action, payload = {}, data) {
  state.requestCache[apiCacheKey(action, payload)] = { at: Date.now(), data };
}

async function api(action, payload = {}, options = {}) {
  const requestId = `mcf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const request = {
    requestId,
    action,
    token: options.skipToken ? '' : state.token,
    payload
  };
  const data = await postWithIframe(request);
  if (MUTATING_ACTIONS.has(action)) {
    clearRequestCache();
  }
  return data;
}

function apiCacheKey(action, payload = {}) {
  return `${action}:${stableStringify(payload)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clearRequestCache() {
  state.requestCache = {};
  state.inFlight = {};
}

function postWithIframe(request) {
  return new Promise((resolve, reject) => {
    const iframeName = `frame_${request.requestId}`;
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.className = 'transport-frame';
    iframe.setAttribute('aria-hidden', 'true');

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = CONFIG.apiUrl;
    form.target = iframeName;
    form.className = 'transport-form';

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
  if (show) {
    state.busyCount += 1;
    clearTimeout(state.busyTimer);
    state.busyTimer = setTimeout(() => {
      if (state.busyCount > 0) {
        $('#busy').classList.remove('hidden');
      }
    }, CONFIG.busyDelayMs);
    return;
  }

  state.busyCount = Math.max(0, state.busyCount - 1);
  if (state.busyCount === 0) {
    clearTimeout(state.busyTimer);
    $('#busy').classList.add('hidden');
  }
}

function setFormDisabled(form, disabled) {
  if (!form) return;
  $$('button, input, select, textarea', form).forEach((element) => {
    element.disabled = disabled;
  });
}

function toast(message, options = {}) {
  if (typeof options === 'string') {
    options = { type: options };
  }
  const el = $('#toast');
  const type = options.type || 'info';
  const hasRichContent = Boolean(options.icon || options.detail);
  el.className = `toast ${type}${hasRichContent ? '' : ' plain'}`;
  if (hasRichContent) {
    el.innerHTML = `
      ${options.icon ? `<i data-lucide="${escapeAttr(options.icon)}"></i>` : ''}
      <div>
        <strong>${escapeHtml(message || '')}</strong>
        ${options.detail ? `<span>${escapeHtml(options.detail)}</span>` : ''}
      </div>
    `;
  } else {
    el.textContent = message || '';
  }
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 4200);
  refreshIcons();
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

function simpleMoneyCard(label, value, detail, tone = 'blue') {
  return `
    <article class="simple-money ${levelClass(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(detail || '')}</small>
    </article>
  `;
}

function renderActionCenter(items) {
  const actions = (items || []).map(normalizeActionItem);
  return `<div class="action-list">${actions.map((item, index) => `
    <article class="action-card ${levelClass(item.priority)}">
      <div class="action-index">${index + 1}</div>
      <div class="action-body">
        <div class="item-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            ${item.message ? `<div class="muted">${escapeHtml(item.message)}</div>` : ''}
          </div>
          ${badge(levelClass(item.priority), item.priority || 'paso')}
        </div>
        <div class="action-meta">
          ${item.dueDate ? `<span class="date-chip"><i data-lucide="calendar"></i>${dateLabel(item.dueDate)}</span>` : ''}
          ${item.type ? `<span>${escapeHtml(item.type)}</span>` : ''}
        </div>
        ${item.action ? `
          <div class="button-row compact">
            <button class="action-button secondary" ${item.view ? `data-go="${escapeAttr(item.view)}"` : ''} type="button">
              <i data-lucide="${escapeAttr(item.icon || 'arrow-right')}"></i>${escapeHtml(item.action)}
            </button>
          </div>
        ` : ''}
      </div>
    </article>
  `).join('') || empty('Sin pasos pendientes.')}</div>`;
}

function normalizeActionItem(item) {
  if (typeof item === 'string') {
    return {
      title: item,
      message: '',
      priority: 'blue',
      dueDate: '',
      action: '',
      view: ''
    };
  }
  return {
    title: item.title || item.message || 'Paso pendiente',
    message: item.message || '',
    priority: item.priority || item.level || 'blue',
    dueDate: item.dueDate || '',
    action: item.action || item.primaryAction || '',
    view: item.view || '',
    type: item.type || '',
    icon: item.icon || 'arrow-right'
  };
}

function renderAlertList(alerts) {
  return `<div class="list">${alerts.map((alert) => `
    <article class="item-card alert-card ${levelClass(alert.priority)}">
      <div class="alert-icon ${levelClass(alert.priority)}">
        <i data-lucide="${alertIcon(alert)}"></i>
      </div>
      <div class="alert-content">
        <div class="item-row">
          <div>
            <strong>${escapeHtml(alert.title)}</strong>
            <div class="muted">${escapeHtml(alert.message)}</div>
          </div>
          ${badge(levelClass(alert.priority), alert.priority)}
        </div>
        <div class="action-meta">
          ${alert.dueDate ? `<span class="date-chip"><i data-lucide="calendar"></i>${dateLabel(alert.dueDate)}</span>` : ''}
          <span>${escapeHtml(alert.type || 'alerta')}</span>
        </div>
        ${alert.action ? `
          <div class="button-row compact">
            <button class="action-button secondary" ${alert.view ? `data-go="${escapeAttr(alert.view)}"` : ''} type="button">
              <i data-lucide="arrow-right"></i>${escapeHtml(alert.action)}
            </button>
          </div>
        ` : ''}
      </div>
    </article>
  `).join('') || empty('Sin alertas.')}</div>`;
}

function alertIcon(alert) {
  const type = String(alert.type || '').toLowerCase();
  if (type === 'bill') return 'receipt';
  if (type === 'paycheck') return 'badge-dollar-sign';
  if (type === 'debt') return 'trending-down';
  if (type === 'transfer') return 'move-right';
  if (type === 'budget') return 'wallet';
  return 'bell';
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

function sortByDateAsc(rows, key) {
  return [...(rows || [])].sort((a, b) => dateValue(a[key]) - dateValue(b[key]));
}

function sortByDateDesc(rows, key) {
  return [...(rows || [])].sort((a, b) => dateValue(b[key]) - dateValue(a[key]));
}

function sortAlerts(rows) {
  return [...(rows || [])].sort((a, b) => {
    const byDate = dateValue(a.dueDate) - dateValue(b.dueDate);
    if (byDate !== 0) return byDate;
    return priorityRank(a.priority) - priorityRank(b.priority);
  });
}

function dateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  const time = date.getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function priorityRank(value) {
  const level = levelClass(value);
  if (level === 'red') return 0;
  if (level === 'yellow') return 1;
  if (level === 'blue') return 2;
  return 3;
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

function todayIso() {
  return todayInput();
}

function paymentStatusLabel(bill) {
  const status = String(bill?.status || '').toLowerCase();
  if (status === 'pending_bank_deduction') return 'Pagado, falta descontar';
  if (status === 'paid') return 'Pagado';
  if (status === 'partial') return 'Parcial';
  if (status === 'overdue') return 'Vencido';
  if (status === 'not_due_yet') return 'Pronto';
  return 'Pendiente';
}

function levelClass(value) {
  const text = String(value || '').toLowerCase();
  if (['critical', 'red', 'critica'].includes(text)) return 'red';
  if (['important', 'warning', 'yellow', 'amarillo', 'partial', 'pending_bank_deduction'].includes(text)) return 'yellow';
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
