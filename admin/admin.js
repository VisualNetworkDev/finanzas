(function () {
  "use strict";

  const api = window.AdminApi;
  const state = {
    session: api && api.getSession(),
    currentSection: "dashboard",
    busy: false,
    userPage: 1,
    userFilters: {},
    selectedUserId: "",
    action: null
  };

  const sectionMeta = {
    dashboard: ["Plataforma", "Resumen", "Estado general y actividad reciente."],
    users: ["Cuentas", "Usuarios", "Busca, filtra y administra cuentas, planes y acceso."],
    versions: ["Distribución", "Versiones", "Publica versiones, descargas y requisitos mínimos."],
    announcements: ["Comunicación", "Anuncios", "Gestiona novedades visibles en el portal."],
    settings: ["Sistema", "Configuración", "Controla funciones globales sin exponer secretos."],
    audit: ["Seguridad", "Auditoría", "Consulta acciones administrativas y sus resultados."],
    errors: ["Operación", "Errores", "Revisa incidencias seguras mediante su correlación."],
    contact: ["Soporte", "Contacto", "Gestiona mensajes recibidos desde la web pública."]
  };

  document.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    bindLogin();
    bindShell();
    bindDialogs();
    if (!api || !api.hasEndpoint()) {
      disableLogin("Configura la URL del backend nuevo antes de utilizar este panel.");
      return;
    }
    if (state.session) showAdmin();
  }

  function bindLogin() {
    by("[data-admin-login-form]").addEventListener("submit", loginAdmin);
  }

  function bindShell() {
    document.querySelectorAll("[data-admin-logout]").forEach((button) => button.addEventListener("click", logout));
    document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => selectSection(button.dataset.section)));
    by("[data-refresh]").addEventListener("click", () => loadSection(state.currentSection));
    by("[data-sidebar-toggle]").addEventListener("click", toggleSidebar);
  }

  function bindDialogs() {
    by("[data-close-user]").addEventListener("click", () => by("[data-user-dialog]").close());
    by("[data-user-dialog]").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
    by("[data-action-dialog]").querySelectorAll("[data-cancel-action]").forEach((button) => button.addEventListener("click", () => by("[data-action-dialog]").close()));
    by("[data-action-dialog]").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
    by("[data-action-form]").addEventListener("submit", submitConfirmedAction);
  }

  async function loginAdmin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateForm(form) || state.busy) return;
    const email = form.elements.email.value.trim().toLowerCase();
    const password = form.elements.password.value;
    setFormBusy(form, true);
    setStatus(by("[data-login-status]"), "Verificando acceso…");
    try {
      const result = await api.request("adminPasswordLogin", { email, password });
      api.saveSession(result.session, result.profile);
      state.session = api.getSession();
      form.reset();
      showAdmin();
    } catch (error) {
      setStatus(by("[data-login-status]"), message(error), "error");
    } finally {
      setFormBusy(form, false);
    }
  }

  function disableLogin(text) {
    const form = by("[data-admin-login-form]");
    form.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
    setStatus(by("[data-login-status]"), text, "error");
  }

  function showAdmin() {
    by("[data-login-screen]").hidden = true;
    by("[data-admin-shell]").hidden = false;
    by("[data-admin-identity]").textContent = state.session.identity || "Administrador";
    selectSection("dashboard");
  }

  async function logout() {
    const token = state.session && state.session.token;
    try { if (token) await api.request("logout", {}, { token }); } catch (error) { /* Always clear the local admin session. */ }
    api.clearSession();
    window.location.reload();
  }

  function toggleSidebar() {
    const sidebar = by(".sidebar");
    const button = by("[data-sidebar-toggle]");
    const open = !sidebar.classList.contains("is-open");
    sidebar.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
  }

  function selectSection(section) {
    if (!sectionMeta[section]) return;
    state.currentSection = section;
    document.querySelectorAll("[data-section]").forEach((button) => button.classList.toggle("is-active", button.dataset.section === section));
    const meta = sectionMeta[section];
    setText("[data-section-eyebrow]", meta[0]);
    setText("[data-section-title]", meta[1]);
    setText("[data-section-description]", meta[2]);
    by(".sidebar").classList.remove("is-open");
    by("[data-sidebar-toggle]").setAttribute("aria-expanded", "false");
    loadSection(section);
  }

  async function loadSection(section) {
    if (!state.session || state.busy) return;
    setLoading(true);
    setGlobalStatus("");
    try {
      if (section === "dashboard") renderDashboard(await adminRequest("adminDashboard"));
      if (section === "users") renderUsers(await adminRequest("adminListUsers", { page: state.userPage, pageSize: 25, ...state.userFilters }));
      if (section === "versions") renderVersions(await adminRequest("adminListVersions"));
      if (section === "announcements") renderAnnouncements(await adminRequest("adminListAnnouncements"));
      if (section === "settings") renderSettings(await adminRequest("adminListSettings"));
      if (section === "audit") renderAudit(await adminRequest("adminListAuditLogs", { limit: 100, offset: 0 }));
      if (section === "errors") renderErrors(await adminRequest("adminListSystemErrors", { limit: 100 }));
      if (section === "contact") renderContact(await adminRequest("adminListContactMessages", {}));
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }

  async function adminRequest(action, payload = {}) {
    return api.request(action, payload, { token: state.session.token });
  }

  function renderDashboard(data) {
    const content = contentRoot();
    const metrics = el("div", "metric-grid");
    [
      ["Usuarios", data.users?.total || 0, `${data.users?.active || 0} activos`, ""],
      ["Premium", data.users?.premium || 0, `${data.users?.free || 0} Free`, "metric-accent"],
      ["Dispositivos", data.devices?.active || 0, `${data.devices?.recentActivations || 0} activaciones recientes`, ""],
      ["Errores abiertos", data.recentErrors || 0, "Pendientes de revisión", ""]
    ].forEach(([label, value, note, extra]) => metrics.append(metricCard(label, value, note, extra)));
    content.append(metrics);

    const grid = el("div", "panel-grid");
    const activity = panel("Actividad administrativa reciente", "Últimas acciones registradas.", true);
    activity.body.append(renderAuditTable(data.recentAdministrativeActivity || [], 10));
    grid.append(activity.root);
    const versions = panel("Versiones instaladas", "Distribución observada en dispositivos activos.");
    const versionList = el("div", "item-list");
    const entries = Object.entries(data.installedVersions || {});
    if (!entries.length) versionList.append(empty("Aún no hay versiones instaladas registradas."));
    entries.forEach(([version, count]) => versionList.append(simpleListItem(version, `${count} dispositivo(s)`)));
    versions.body.append(versionList);
    grid.append(versions.root);
    content.append(grid);
  }

  function renderUsers(data) {
    const content = contentRoot();
    const toolbar = el("form", "toolbar");
    toolbar.append(
      labeledInput("Buscar", "query", "search", state.userFilters.query || "", "Nombre o correo"),
      labeledSelect("Plan", "plan", [["", "Todos"], ["FREE", "Free"], ["PREMIUM", "Premium"]], state.userFilters.plan || ""),
      labeledSelect("Estado", "status", [["", "Todos"], ["ACTIVE", "Activo"], ["SUSPENDED", "Suspendido"], ["REVOKED", "Revocado"], ["DELETED", "Eliminado"]], state.userFilters.status || ""),
      labeledSelect("Rol", "role", [["", "Todos"], ["USER", "Usuario"], ["ADMIN", "Administrador"]], state.userFilters.role || "")
    );
    const filterButton = actionButton("Aplicar filtros", "button button-primary", "submit");
    toolbar.append(filterButton);
    toolbar.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(toolbar);
      state.userFilters = Object.fromEntries([...form.entries()].filter(([, value]) => value));
      state.userPage = 1;
      loadSection("users");
    });
    content.append(toolbar);

    const columns = ["Usuario", "Rol", "Plan", "Estado", "Registro", "Último acceso", ""];
    const rows = (data.items || []).map((user) => [
      userCell(user.name, user.email), badge(user.role, user.role === "ADMIN" ? "admin" : ""),
      badge(user.plan, user.plan === "PREMIUM" ? "premium" : ""), badge(translateStatus(user.status), user.status.toLowerCase()),
      formatDate(user.createdAt), formatDate(user.lastPortalLoginAt), viewUserButton(user.userId)
    ]);
    content.append(table(columns, rows));
    const pager = el("div", "pagination");
    pager.append(el("span", "", `${data.total || 0} usuario(s) · página ${data.page || 1}`));
    const actions = el("div", "pagination-actions");
    const previous = actionButton("Anterior", "button button-secondary button-small");
    previous.disabled = state.userPage <= 1;
    previous.addEventListener("click", () => { state.userPage -= 1; loadSection("users"); });
    const next = actionButton("Siguiente", "button button-secondary button-small");
    next.disabled = state.userPage * (data.pageSize || 25) >= (data.total || 0);
    next.addEventListener("click", () => { state.userPage += 1; loadSection("users"); });
    actions.append(previous, next);
    pager.append(actions);
    content.append(pager);
  }

  function renderVersions(items) {
    const content = contentRoot();
    const grid = el("div", "panel-grid");
    const listPanel = panel("Versiones registradas", "Los usuarios sólo ven versiones publicadas y habilitadas.");
    const list = el("div", "item-list");
    if (!items.length) list.append(empty("Aún no hay versiones registradas."));
    items.forEach((item) => {
      const row = simpleListItem(`${platformName(item.platform)} · ${item.version}`, `Mínima ${item.minimumVersion} · ${item.status}`);
      const edit = actionButton("Editar", "button button-secondary button-small");
      edit.addEventListener("click", () => fillVersionForm(item));
      row.append(edit);
      list.append(row);
    });
    listPanel.body.append(list);
    grid.append(listPanel.root);
    const formPanel = panel("Publicar versión", "Los enlaces deben utilizar HTTPS.");
    const form = buildVersionForm();
    formPanel.body.append(form);
    grid.append(formPanel.root);
    content.append(grid);
  }

  function buildVersionForm() {
    const form = el("form", "form-grid");
    form.dataset.versionForm = "";
    form.append(
      hiddenInput("versionId"),
      labeledSelect("Plataforma", "platform", [["WINDOWS", "Windows"], ["ANDROID", "Android"], ["IOS", "iPhone"], ["MACOS", "macOS"], ["LINUX", "Linux"]]),
      labeledInput("Versión", "version", "text", "", "1.0.0", true),
      labeledInput("Versión mínima", "minimumVersion", "text", "", "1.0.0", true),
      labeledSelect("Estado", "status", [["DRAFT", "Borrador"], ["PUBLISHED", "Publicada"], ["ARCHIVED", "Archivada"]]),
      labeledInput("Descarga directa", "downloadUrl", "url", "", "https://…"),
      labeledInput("Tienda", "storeUrl", "url", "", "https://…"),
      labeledSelect("Actualización", "isRequired", [["false", "Recomendada"], ["true", "Obligatoria"]]),
      labeledTextarea("Notas de actualización", "releaseNotes", "", true, "span-2")
    );
    const actions = el("div", "inline-form-actions span-2");
    actions.append(actionButton("Guardar versión", "button button-primary", "submit"), actionButton("Limpiar", "button button-quiet", "reset"));
    form.append(actions);
    form.addEventListener("submit", saveVersion);
    return form;
  }

  function fillVersionForm(item) {
    const form = by("[data-version-form]");
    if (!form) return;
    Object.entries(item).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = String(value ?? ""); });
    form.elements.isRequired.value = String(item.isRequired === true || String(item.isRequired).toLowerCase() === "true");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveVersion(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateForm(form) || state.busy) return;
    const values = Object.fromEntries(new FormData(form).entries());
    values.isRequired = values.isRequired === "true";
    if (!values.versionId) delete values.versionId;
    await mutate("adminSaveVersion", values, "Versión guardada.", form, "versions");
  }

  function renderAnnouncements(items) {
    const content = contentRoot();
    const grid = el("div", "panel-grid");
    const listPanel = panel("Anuncios", "Contenido visible según audiencia y fechas.");
    const list = el("div", "item-list");
    if (!items.length) list.append(empty("Aún no hay anuncios."));
    items.forEach((item) => {
      const row = simpleListItem(item.title, `${item.audience} · ${item.status}`);
      const edit = actionButton("Editar", "button button-secondary button-small");
      edit.addEventListener("click", () => fillAnnouncementForm(item));
      row.append(edit);
      list.append(row);
    });
    listPanel.body.append(list);
    grid.append(listPanel.root);
    const formPanel = panel("Crear anuncio", "No incluyas datos privados ni notas internas.");
    formPanel.body.append(buildAnnouncementForm());
    grid.append(formPanel.root);
    content.append(grid);
  }

  function buildAnnouncementForm() {
    const form = el("form", "form-grid");
    form.dataset.announcementForm = "";
    form.append(
      hiddenInput("announcementId"),
      labeledInput("Título", "title", "text", "", "", true),
      labeledSelect("Audiencia", "audience", [["ALL", "Todos"], ["FREE", "Free"], ["PREMIUM", "Premium"]]),
      labeledInput("Inicio", "startAt", "datetime-local"),
      labeledInput("Fin", "endAt", "datetime-local"),
      labeledSelect("Estado", "status", [["DRAFT", "Borrador"], ["PUBLISHED", "Publicado"], ["ARCHIVED", "Archivado"]]),
      labeledTextarea("Contenido", "body", "", true, "span-2")
    );
    const actions = el("div", "inline-form-actions span-2");
    actions.append(actionButton("Guardar anuncio", "button button-primary", "submit"), actionButton("Limpiar", "button button-quiet", "reset"));
    form.append(actions);
    form.addEventListener("submit", saveAnnouncement);
    return form;
  }

  function fillAnnouncementForm(item) {
    const form = by("[data-announcement-form]");
    if (!form) return;
    ["announcementId", "title", "audience", "status", "body"].forEach((key) => { form.elements[key].value = item[key] || ""; });
    form.elements.startAt.value = localDateTimeValue(item.startAt);
    form.elements.endAt.value = localDateTimeValue(item.endAt);
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveAnnouncement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateForm(form) || state.busy) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.announcementId) delete values.announcementId;
    if (values.startAt) values.startAt = new Date(values.startAt).toISOString();
    if (values.endAt) values.endAt = new Date(values.endAt).toISOString();
    await mutate("adminSaveAnnouncement", values, "Anuncio guardado.", form, "announcements");
  }

  function renderSettings(items) {
    const content = contentRoot();
    const panelView = panel("Configuración global", "Las propiedades secretas de Apps Script nunca aparecen aquí.", true);
    const list = el("div", "setting-list");
    items.forEach((item) => {
      const row = el("div", "setting-row");
      const copy = el("div");
      copy.append(el("h3", "", item.key), el("p", "", item.description || ""));
      const input = settingInput(item);
      const save = actionButton("Guardar", "button button-secondary button-small");
      save.addEventListener("click", () => saveSetting(item, input, save));
      row.append(copy, input, save);
      list.append(row);
    });
    panelView.body.append(items.length ? list : empty("No hay configuraciones disponibles."));
    content.append(panelView.root);
  }

  function settingInput(item) {
    if (item.type === "BOOLEAN") {
      const select = document.createElement("select");
      [["true", "Activado"], ["false", "Desactivado"]].forEach(([value, label]) => select.append(option(value, label, String(item.value) === value)));
      return select;
    }
    const input = document.createElement("input");
    input.type = item.type === "NUMBER" ? "number" : "text";
    input.value = item.type === "JSON" ? JSON.stringify(item.value ?? {}) : String(item.value ?? "");
    return input;
  }

  async function saveSetting(item, input, button) {
    let value = input.value;
    if (item.type === "BOOLEAN") value = value === "true";
    if (item.type === "NUMBER") value = Number(value);
    if (item.type === "JSON") {
      try { value = JSON.parse(value); } catch (error) { setGlobalStatus("El valor JSON no es válido.", "error"); return; }
    }
    setButtonBusy(button, true, "Guardando…");
    try {
      await adminRequest("adminUpdateSetting", { key: item.key, value });
      setGlobalStatus(`Configuración ${item.key} actualizada.`, "success");
    } catch (error) { handleError(error); }
    finally { setButtonBusy(button, false, "Guardar"); }
  }

  function renderAudit(items) {
    const content = contentRoot();
    const view = panel("Historial administrativo", "No contiene códigos, tokens ni secretos.", true);
    view.body.append(renderAuditTable(items, 100));
    content.append(view.root);
  }

  function renderAuditTable(items, limit) {
    const rows = items.slice(0, limit).map((item) => [
      userCell(item.action || "Acción", item.correlationId || "Sin correlación"),
      item.actorRole || "", item.targetType || "", formatDateTime(item.createdAt), badge(item.result || "", item.result === "SUCCESS" ? "active" : "suspended")
    ]);
    return items.length ? table(["Acción", "Actor", "Destino", "Fecha", "Resultado"], rows) : empty("No hay actividad para mostrar.");
  }

  function renderErrors(items) {
    const content = contentRoot();
    const rows = items.map((item) => [
      userCell(item.errorCode || "ERROR", item.correlationId || ""),
      `${item.module || ""} · ${item.operation || ""}`,
      item.safeMessage || "",
      formatDateTime(item.createdAt),
      item.resolvedAt ? badge("Resuelto", "active") : resolveButton(item.errorId)
    ]);
    content.append(table(["Error", "Ubicación", "Mensaje seguro", "Fecha", "Estado"], rows));
  }

  function resolveButton(errorId) {
    const button = actionButton("Resolver", "button button-secondary button-small");
    button.addEventListener("click", async () => {
      setButtonBusy(button, true, "Guardando…");
      try { await adminRequest("adminResolveSystemError", { errorId }); setGlobalStatus("Error marcado como resuelto.", "success"); await loadSection("errors"); }
      catch (error) { handleError(error); }
      finally { setButtonBusy(button, false, "Resolver"); }
    });
    return button;
  }

  function renderContact(items) {
    const content = contentRoot();
    const rows = items.map((item) => [
      userCell(item.subject || "Sin asunto", item.email || ""),
      item.name || "", truncate(item.message || "", 110), formatDateTime(item.createdAt), contactStatusSelect(item)
    ]);
    content.append(table(["Asunto", "Nombre", "Mensaje", "Fecha", "Estado"], rows));
  }

  function contactStatusSelect(item) {
    const wrap = el("div", "list-actions");
    const select = document.createElement("select");
    [["NEW", "Nuevo"], ["IN_PROGRESS", "En proceso"], ["RESOLVED", "Resuelto"], ["ARCHIVED", "Archivado"]].forEach(([value, label]) => select.append(option(value, label, item.status === value)));
    const save = actionButton("Guardar", "button button-secondary button-small");
    save.addEventListener("click", async () => {
      setButtonBusy(save, true, "…");
      try { await adminRequest("adminUpdateContactMessage", { messageId: item.messageId, status: select.value }); setGlobalStatus("Mensaje actualizado.", "success"); }
      catch (error) { handleError(error); }
      finally { setButtonBusy(save, false, "Guardar"); }
    });
    wrap.append(select, save);
    return wrap;
  }

  function viewUserButton(userId) {
    const button = actionButton("Ver detalles", "table-action");
    button.addEventListener("click", () => openUser(userId));
    return button;
  }

  async function openUser(userId) {
    state.selectedUserId = userId;
    const dialog = by("[data-user-dialog]");
    const target = by("[data-user-detail]");
    target.replaceChildren(el("p", "", "Cargando usuario…"));
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("modal-open");
    dialog.addEventListener("close", () => document.body.classList.remove("modal-open"), { once: true });
    try {
      const data = await adminRequest("adminGetUser", { userId });
      renderUserDetail(data);
    } catch (error) {
      target.replaceChildren(el("p", "status is-error", message(error)));
    }
  }

  function renderUserDetail(data) {
    const user = data.user;
    const root = by("[data-user-detail]");
    root.replaceChildren();
    const summary = el("div", "user-summary");
    const copy = el("div");
    copy.append(el("p", "eyebrow", "Detalle de usuario"), el("h2", "", user.name || "Sin nombre"), el("p", "", user.email || ""));
    summary.append(copy, badge(user.status, user.status.toLowerCase()));
    root.append(summary);
    const meta = el("div", "user-meta");
    [["Rol", user.role], ["Plan", user.plan], ["Registro", formatDate(user.createdAt)], ["Último acceso", formatDate(user.lastPortalLoginAt)]].forEach(([label, value]) => {
      const item = el("div"); item.append(el("small", "", label), el("strong", "", value || "No disponible")); meta.append(item);
    });
    root.append(meta, el("h3", "", "Acciones"));
    const actions = el("div", "action-grid");
    [
      ["Editar nombre", "name"], ["Cambiar plan", "plan"], ["Cambiar estado", "status"], ["Cambiar rol", "role"],
      ["Revocar sesiones", "sessions"], ["Revocar dispositivos", "devices"], ["Añadir nota", "note"]
    ].forEach(([label, action]) => { const button = actionButton(label, action === "status" ? "button button-danger" : "button button-secondary"); button.addEventListener("click", () => openAction(action, user)); actions.append(button); });
    root.append(actions, el("h3", "", `Dispositivos (${(data.devices || []).length})`));
    const devices = el("div", "item-list");
    if (!(data.devices || []).length) devices.append(empty("Sin dispositivos."));
    (data.devices || []).forEach((device) => devices.append(simpleListItem(device.displayLabel || platformName(device.platform), `${device.status} · ${device.appVersion || "Sin versión"}`)));
    root.append(devices, el("h3", "", `Notas privadas (${(data.notes || []).length})`));
    const notes = el("div", "item-list");
    if (!(data.notes || []).length) notes.append(empty("Sin notas privadas."));
    (data.notes || []).forEach((note) => notes.append(simpleListItem(note.note, formatDateTime(note.createdAt))));
    root.append(notes);
  }

  function openAction(action, user) {
    state.action = { type: action, user };
    const dialog = by("[data-action-dialog]");
    const form = by("[data-action-form]");
    form.reset();
    const valueWrap = by("[data-action-value-wrap]");
    const noteWrap = by("[data-action-note-wrap]");
    valueWrap.hidden = !["plan", "status", "role"].includes(action);
    noteWrap.hidden = !["note", "name"].includes(action);
    setText("[data-action-note-label]", action === "name" ? "Nuevo nombre" : "Nota privada");
    noteWrap.querySelector("textarea").maxLength = action === "name" ? 100 : 2000;
    const titles = {
      plan: ["Cambiar plan", "El cambio se reflejará en la próxima validación del dispositivo."],
      name: ["Editar nombre", "Actualiza únicamente el nombre visible de la cuenta."],
      status: ["Cambiar estado", "Los estados restrictivos revocan sesiones y dispositivos."],
      role: ["Cambiar rol", "Promover a ADMIN requiere que el correo esté en la lista privada."],
      sessions: ["Revocar sesiones", "Se cerrarán todas las sesiones del usuario."],
      devices: ["Revocar dispositivos", "Se invalidarán todos los dispositivos activos."],
      note: ["Añadir nota privada", "La nota nunca será visible en el portal del usuario."]
    };
    setText("[data-action-title]", titles[action][0]);
    setText("[data-action-message]", titles[action][1]);
    const select = valueWrap.querySelector("select");
    select.replaceChildren();
    if (action === "plan") [["FREE", "Free"], ["PREMIUM", "Premium"]].forEach(([v, l]) => select.append(option(v, l, user.plan === v)));
    if (action === "status") [["ACTIVE", "Activo"], ["SUSPENDED", "Suspendido"], ["REVOKED", "Revocado"], ["DELETED", "Eliminado"]].forEach(([v, l]) => select.append(option(v, l, user.status === v)));
    if (action === "role") [["USER", "Usuario"], ["ADMIN", "Administrador"]].forEach(([v, l]) => select.append(option(v, l, user.role === v)));
    setStatus(by("[data-action-status]"), "");
    dialog.showModal();
  }

  async function submitConfirmedAction(event) {
    event.preventDefault();
    if (!state.action || state.busy) return;
    const form = event.currentTarget;
    const { type, user } = state.action;
    const reason = form.elements.reason.value.trim();
    const value = form.elements.value.value;
    const note = form.elements.note.value.trim();
    if (["status", "role"].includes(type) && !reason) { setStatus(by("[data-action-status]"), "Indica un motivo para esta acción.", "error"); return; }
    if (["note", "name"].includes(type) && note.length < 2) { setStatus(by("[data-action-status]"), type === "name" ? "Escribe el nuevo nombre." : "Escribe la nota privada.", "error"); return; }
    const map = {
      plan: ["adminChangePlan", { userId: user.userId, plan: value, reason }],
      name: ["adminUpdateUserName", { userId: user.userId, name: note, reason }],
      status: ["adminChangeStatus", { userId: user.userId, status: value, reason }],
      role: ["adminChangeRole", { userId: user.userId, role: value, reason }],
      sessions: ["adminRevokeSessions", { userId: user.userId, reason }],
      devices: ["adminRevokeDevices", { userId: user.userId, reason }],
      note: ["adminAddUserNote", { userId: user.userId, note }]
    };
    setFormBusy(form, true);
    try {
      await adminRequest(map[type][0], map[type][1]);
      by("[data-action-dialog]").close();
      setGlobalStatus("Acción completada y registrada en auditoría.", "success");
      await openUser(user.userId);
      setFormBusy(form, false);
      if (state.currentSection === "users") await loadSection("users");
    } catch (error) { setStatus(by("[data-action-status]"), message(error), "error"); }
    finally { setFormBusy(form, false); }
  }

  async function mutate(action, payload, successMessage, form, section) {
    setFormBusy(form, true);
    try { await adminRequest(action, payload); form.reset(); setGlobalStatus(successMessage, "success"); setFormBusy(form, false); await loadSection(section); }
    catch (error) { handleError(error); }
    finally { setFormBusy(form, false); }
  }

  function handleError(error) {
    if (error && ["AUTH_SESSION_INVALID", "ACCOUNT_UNAVAILABLE", "AUTH_NOT_AUTHORIZED"].includes(error.code)) {
      api.clearSession();
      window.location.reload();
      return;
    }
    setGlobalStatus(message(error), "error");
  }

  function setLoading(loading) {
    state.busy = loading;
    by("[data-content-loading]").hidden = !loading;
    by("[data-section-content]").hidden = loading;
    by("[data-refresh]").disabled = loading;
  }

  function contentRoot() {
    const root = by("[data-section-content]");
    root.replaceChildren();
    root.hidden = false;
    return root;
  }

  function panel(title, description, full) {
    const root = el("section", `panel${full ? " panel-full" : ""}`);
    const header = el("header", "panel-header");
    const copy = el("div"); copy.append(el("h2", "", title), el("p", "", description)); header.append(copy);
    const body = el("div", "panel-body"); root.append(header, body);
    return { root, body };
  }

  function metricCard(label, value, note, extra) {
    const card = el("article", `metric-card ${extra || ""}`.trim());
    card.append(el("p", "", label), el("strong", "", value), el("small", "", note));
    return card;
  }

  function table(headers, rows) {
    if (!rows.length) return empty("No hay información para mostrar.");
    const wrap = el("div", "table-wrap");
    const element = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    headers.forEach((header) => headRow.append(el("th", "", header)));
    head.append(headRow);
    const body = document.createElement("tbody");
    rows.forEach((values) => {
      const row = document.createElement("tr");
      values.forEach((value) => {
        const cell = document.createElement("td");
        if (value instanceof Node) cell.append(value); else cell.textContent = value === null || value === undefined ? "" : String(value);
        row.append(cell);
      });
      body.append(row);
    });
    element.append(head, body); wrap.append(element); return wrap;
  }

  function userCell(primary, secondary) {
    const wrap = el("span"); wrap.append(el("span", "cell-primary", primary || ""), el("span", "cell-secondary", secondary || "")); return wrap;
  }

  function badge(text, type) { return el("span", `badge${type ? ` badge-${type}` : ""}`, text || ""); }
  function empty(text) { return el("div", "empty", text); }

  function simpleListItem(title, description) {
    const item = el("article", "list-item");
    const copy = el("div"); copy.append(el("h3", "", title || ""), el("p", "", description || "")); item.append(copy); return item;
  }

  function actionButton(text, className, type = "button") { const button = el("button", className, text); button.type = type; return button; }
  function hiddenInput(name) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; return input; }

  function labeledInput(labelText, name, type = "text", value = "", placeholder = "", required = false) {
    const label = el("label"); label.append(document.createTextNode(labelText));
    const input = document.createElement("input"); input.name = name; input.type = type; input.value = value; input.placeholder = placeholder; input.required = required; label.append(input); return label;
  }

  function labeledSelect(labelText, name, choices, selected = "") {
    const label = el("label"); label.append(document.createTextNode(labelText));
    const select = document.createElement("select"); select.name = name;
    choices.forEach(([value, text]) => select.append(option(value, text, value === selected)));
    label.append(select); return label;
  }

  function labeledTextarea(labelText, name, value = "", required = false, className = "") {
    const label = el("label", className); label.append(document.createTextNode(labelText));
    const textarea = document.createElement("textarea"); textarea.name = name; textarea.value = value; textarea.required = required; textarea.maxLength = 3000; label.append(textarea); return label;
  }

  function option(value, text, selected) { const element = document.createElement("option"); element.value = value; element.textContent = text; element.selected = Boolean(selected); return element; }

  function validateForm(form) {
    let valid = true;
    form.querySelectorAll("input, select, textarea").forEach((control) => {
      const okay = control.checkValidity(); control.setAttribute("aria-invalid", String(!okay)); if (!okay) valid = false;
    });
    if (!valid) form.reportValidity();
    return valid;
  }

  function setFormBusy(form, busy) { state.busy = busy; form.querySelectorAll("input, select, textarea, button").forEach((control) => { control.disabled = busy; }); }
  function setButtonBusy(button, busy, text) { button.disabled = busy; button.textContent = text; }
  function setGlobalStatus(text, type) { setStatus(by("[data-global-status]"), text, type); }
  function setStatus(target, text, type) { target.textContent = text || ""; target.classList.toggle("is-error", type === "error"); target.classList.toggle("is-success", type === "success"); }
  function setText(selector, value) { const target = by(selector); if (target) target.textContent = value === null || value === undefined ? "" : String(value); }
  function by(selector) { return document.querySelector(selector); }
  function el(tag, className = "", text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = String(text); return element; }
  function message(error) { return error && error.message || "No fue posible completar la solicitud."; }
  function truncate(value, length) { const text = String(value || ""); return text.length > length ? `${text.slice(0, length - 1)}…` : text; }
  function translateStatus(value) { return { ACTIVE: "Activo", SUSPENDED: "Suspendido", REVOKED: "Revocado", DELETED: "Eliminado" }[value] || value || ""; }
  function platformName(value) { return { WINDOWS: "Windows", ANDROID: "Android", IOS: "iPhone", MACOS: "macOS", LINUX: "Linux" }[value] || value || ""; }
  function formatDate(value) { if (!value) return "No disponible"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "No disponible" : new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(date); }
  function formatDateTime(value) { if (!value) return "No disponible"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "No disponible" : new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(date); }
  function localDateTimeValue(value) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
})();
