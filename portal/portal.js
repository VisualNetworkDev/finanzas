(function () {
  "use strict";

  const api = window.PaymentApi;
  const config = window.PAYMENT_ORGANIZER_CONFIG || {};
  const helpers = window.PaymentHelpers;
  const session = api && api.getPortalSession();
  const state = { profile: null, confirmationAction: null, busy: false };

  document.addEventListener("DOMContentLoaded", initialize);

  async function initialize() {
    if (!api || !api.hasEndpoint() || !session) {
      returnToHome();
      return;
    }
    bindActions();
    await loadPortal();
  }

  function bindActions() {
    document.querySelector("[data-logout]").addEventListener("click", logout);
    document.querySelector("[data-generate-code]").addEventListener("click", generateActivationCode);
    document.querySelector("[data-copy-code]").addEventListener("click", copyActivationCode);
    document.querySelector("[data-revoke-sessions]").addEventListener("click", () => openConfirmation("sessions"));
    document.querySelector("[data-delete-account]").addEventListener("click", () => openConfirmation("delete"));
    const dialog = document.querySelector("[data-confirm-dialog]");
    dialog.querySelectorAll("[data-cancel-confirm]").forEach((button) => button.addEventListener("click", () => dialog.close()));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.querySelector("[data-confirm-form]").addEventListener("submit", confirmAction);
  }

  async function loadPortal() {
    try {
      const data = await api.request("getProfile", {}, { token: session.token });
      state.profile = data;
      renderPortal(data);
      document.querySelector("[data-portal-loading]").hidden = true;
      document.querySelector("[data-portal-content]").hidden = false;
    } catch (error) {
      handleApiError(error);
    }
  }

  function renderPortal(data) {
    const profile = data.profile || {};
    const plan = helpers.normalizeEnum(profile.plan);
    const status = helpers.normalizeEnum(profile.status);
    const deviceLimit = Number(profile.deviceLimit ?? data.deviceLimit ?? 0);
    setText("[data-profile-name]", profile.name || "");
    setText("[data-profile-email]", profile.email || "");
    setText("[data-profile-verified]", profile.emailVerified ? "Correo verificado" : "Pendiente");
    setText("[data-profile-status]", translateStatus(profile.status));
    setText("[data-profile-created]", formatDate(profile.registeredAt));
    setText("[data-profile-last-login]", formatDate(profile.lastPortalLoginAt));
    setText("[data-device-count]", `${data.activeDeviceCount || 0} de ${data.deviceLimit || 0} activos`);
    setText("[data-premium-start]", formatDate(profile.premiumActivatedAt));
    setText("[data-premium-expiry]", formatDate(profile.premiumExpiresAt));
    const badge = document.querySelector("[data-plan-badge]");
    badge.textContent = plan === "PREMIUM" ? "Plan Premium" : "Plan Free";
    badge.classList.toggle("premium", plan === "PREMIUM");

    const canActivate = plan === "PREMIUM" && status === "ACTIVE" && Number.isFinite(deviceLimit) && deviceLimit > 0;
    document.querySelector("[data-generate-code]").hidden = !canActivate;
    const unavailable = document.querySelector("[data-activation-free]");
    unavailable.hidden = canActivate;
    unavailable.textContent = plan !== "PREMIUM"
      ? "Código de activación no disponible para el plan Free."
      : status !== "ACTIVE"
        ? "La cuenta debe estar activa para generar un código."
        : "Configura al menos un dispositivo permitido para generar un código.";
    setText("[data-device-limit]", deviceLimit === 1
      ? "Puedes mantener 1 dispositivo activo."
      : `Puedes mantener hasta ${deviceLimit} dispositivos activos.`);
    renderDevices(data.devices || []);
    renderAnnouncements(data.announcements || []);
    renderDownloads(data.downloads || []);
    renderFeatureEntitlements(data.featureCatalog || [], data.featureEntitlements || {}, plan, status);
  }

  function renderFeatureEntitlements(catalog, entitlements, plan, status) {
    const container = document.querySelector("[data-feature-entitlements]");
    container.replaceChildren();
    if (!Array.isArray(catalog) || !catalog.length) {
      container.append(emptyState("Las funciones del plan se mostrarán cuando el servicio termine de sincronizar."));
      return;
    }
    catalog.forEach((feature) => {
      const manual = entitlements[feature.key] === true;
      const included = plan === "PREMIUM" && status === "ACTIVE" && feature.includedInPremium !== false;
      const allowed = status === "ACTIVE" && (included || manual);
      const item = document.createElement("article");
      item.className = "feature-entitlement-item";
      const copy = document.createElement("div");
      const title = document.createElement("b");
      const description = document.createElement("small");
      title.textContent = feature.name || feature.key;
      description.textContent = feature.description || "Función adicional de Payment Organizer.";
      copy.append(title, description);
      const access = document.createElement("span");
      access.className = `feature-access-state${included ? " is-plan" : manual && allowed ? " is-manual" : ""}`;
      access.textContent = status !== "ACTIVE" ? "Suspendida" : included ? "Incluida por Premium" : manual ? "Autorizada" : allowed ? "Disponible" : "Bloqueada";
      item.append(copy, access);
      container.append(item);
    });
  }

  function renderDevices(devices) {
    const container = document.querySelector("[data-device-list]");
    container.replaceChildren();
    if (!devices.length) {
      container.append(emptyState("Aún no hay dispositivos asociados a tu cuenta."));
      return;
    }
    devices.forEach((device) => {
      const item = document.createElement("article");
      item.className = "device-item";
      const copy = document.createElement("div");
      const title = document.createElement("b");
      title.textContent = device.label || translatePlatform(device.platform);
      const detail = document.createElement("small");
      detail.textContent = `${translatePlatform(device.platform)} · ${device.appVersion || "Versión no informada"} · Activado ${formatDate(device.activatedAt)}`;
      copy.append(title, detail);
      const actions = document.createElement("div");
      const status = document.createElement("span");
      status.className = `device-status${device.status === "REVOKED" ? " revoked" : ""}`;
      status.textContent = device.status === "ACTIVE" ? "Activo" : "Revocado";
      actions.append(status);
      if (device.status === "ACTIVE") {
        const button = document.createElement("button");
        button.className = "button button-quiet button-small";
        button.type = "button";
        button.textContent = "Revocar";
        button.addEventListener("click", () => revokeDevice(device.deviceRef, button));
        actions.append(button);
      }
      item.append(copy, actions);
      container.append(item);
    });
  }

  function renderAnnouncements(items) {
    const container = document.querySelector("[data-announcements]");
    container.replaceChildren();
    if (!items.length) {
      container.append(emptyState("No hay novedades publicadas en este momento."));
      return;
    }
    items.forEach((announcement) => {
      const item = document.createElement("article");
      item.className = "announcement-item";
      const copy = document.createElement("div");
      const title = document.createElement("b");
      title.textContent = announcement.title;
      const body = document.createElement("small");
      body.textContent = announcement.body;
      copy.append(title, body);
      item.append(copy);
      container.append(item);
    });
  }

  function renderDownloads(items) {
    const container = document.querySelector("[data-portal-downloads]");
    container.replaceChildren();
    if (!items.length) {
      container.append(emptyState("No hay una descarga habilitada para mostrar."));
      return;
    }
    items.forEach((download) => {
      const url = download.storeUrl || download.downloadUrl;
      if (!/^https:\/\//i.test(url || "")) return;
      const item = document.createElement("a");
      item.className = "download-item";
      item.href = url;
      item.rel = "noopener noreferrer";
      const label = document.createElement("span");
      label.textContent = `${translatePlatform(download.platform)} · versión ${download.version}`;
      const action = document.createElement("strong");
      action.textContent = "Descargar →";
      item.append(label, action);
      container.append(item);
    });
    if (!container.children.length) container.append(emptyState("No hay una descarga habilitada para mostrar."));
  }

  async function generateActivationCode(event) {
    const button = event.currentTarget;
    setButtonBusy(button, true, "Generando…");
    setGlobalStatus("");
    try {
      const result = await api.request("generateActivationCode", {}, { token: session.token });
      setText("[data-activation-code]", groupCode(result.code));
      setText("[data-code-expiry]", formatDateTime(result.expiresAt));
      document.querySelector("[data-code-panel]").hidden = false;
      setGlobalStatus("Código generado correctamente.", "success");
    } catch (error) {
      handleApiError(error, false);
    } finally {
      setButtonBusy(button, false, "Generar código");
    }
  }

  async function copyActivationCode(event) {
    const code = document.querySelector("[data-activation-code]").textContent.trim();
    if (!code || !navigator.clipboard) {
      setGlobalStatus("No fue posible copiar el código automáticamente.", "error");
      return;
    }
    const button = event.currentTarget;
    setButtonBusy(button, true, "Copiando…");
    try {
      await navigator.clipboard.writeText(code.replace(/\s/g, ""));
      setGlobalStatus("Código copiado.", "success");
    } catch (error) {
      setGlobalStatus("No fue posible copiar el código automáticamente.", "error");
    } finally {
      setButtonBusy(button, false, "Copiar código");
    }
  }

  async function revokeDevice(deviceRef, button) {
    if (!deviceRef || state.busy) return;
    setButtonBusy(button, true, "Revocando…");
    try {
      await api.request("revokeDevice", { deviceRef }, { token: session.token });
      setGlobalStatus("El dispositivo fue revocado.", "success");
      await loadPortal();
    } catch (error) {
      handleApiError(error, false);
    } finally {
      setButtonBusy(button, false, "Revocar");
    }
  }

  async function logout() {
    const button = document.querySelector("[data-logout]");
    setButtonBusy(button, true, "Cerrando…");
    try {
      await api.request("logout", {}, { token: session.token });
    } catch (error) {
      // Local session is cleared even if the network is unavailable.
    } finally {
      api.clearPortalSession();
      returnToHome();
    }
  }

  function openConfirmation(action) {
    state.confirmationAction = action;
    const dialog = document.querySelector("[data-confirm-dialog]");
    const deleting = action === "delete";
    setText("[data-confirm-title]", deleting ? "Eliminar tu cuenta" : "Cerrar todas las sesiones");
    setText("[data-confirm-message]", deleting
      ? "Tu cuenta quedará eliminada lógicamente y todos los dispositivos y sesiones serán revocados. Tus datos locales no se borran."
      : "Se cerrará esta sesión y cualquier otra sesión abierta en el portal.");
    const inputWrap = dialog.querySelector("[data-confirm-input-wrap]");
    inputWrap.hidden = !deleting;
    inputWrap.querySelector("input").required = deleting;
    inputWrap.querySelector("input").value = "";
    dialog.querySelector("[data-confirm-button]").className = deleting ? "button button-danger" : "button button-primary";
    setStatus(dialog.querySelector("[data-confirm-status]"), "");
    dialog.showModal();
  }

  async function confirmAction(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const deleting = state.confirmationAction === "delete";
    const confirmation = form.elements.confirmation.value.trim().toUpperCase();
    if (deleting && confirmation !== "DELETE") {
      setStatus(form.querySelector("[data-confirm-status]"), "Escribe DELETE exactamente para continuar.", "error");
      return;
    }
    state.busy = true;
    form.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
    try {
      if (deleting) {
        await api.request("requestAccountDeletion", { confirmation }, { token: session.token });
      } else {
        await api.request("revokeAllSessions", {}, { token: session.token });
      }
      api.clearPortalSession();
      returnToHome();
    } catch (error) {
      handleApiError(error, false);
      setStatus(form.querySelector("[data-confirm-status]"), error.message || "No fue posible completar la solicitud.", "error");
    } finally {
      state.busy = false;
      form.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
    }
  }

  function handleApiError(error, redirectOnAuth = true) {
    if (redirectOnAuth && error && ["AUTH_SESSION_INVALID", "ACCOUNT_UNAVAILABLE"].includes(error.code)) {
      api.clearPortalSession();
      returnToHome();
      return;
    }
    setGlobalStatus(error && error.message || "No fue posible completar la solicitud.", "error");
  }

  function emptyState(message) {
    const element = document.createElement("div");
    element.className = "empty-state";
    element.textContent = message;
    return element;
  }

  function setButtonBusy(button, busy, text) {
    state.busy = busy;
    button.disabled = busy;
    button.textContent = text;
  }

  function setGlobalStatus(message, type) {
    setStatus(document.querySelector("[data-global-status]"), message, type);
  }

  function setStatus(element, message, type) {
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value === null || value === undefined ? "" : String(value);
  }

  function translateStatus(status) {
    return { ACTIVE: "Activa", SUSPENDED: "Suspendida", REVOKED: "Revocada", DELETED: "Eliminada" }[status] || "No disponible";
  }

  function translatePlatform(platform) {
    return { WINDOWS: "Windows", ANDROID: "Android", IOS: "iPhone", MACOS: "macOS", LINUX: "Linux" }[platform] || platform || "Dispositivo";
  }

  function formatDate(value) {
    if (!value) return "No disponible";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No disponible";
    return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "pronto";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "pronto";
    return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function groupCode(value) {
    const code = String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    return code.length === 10 ? `${code.slice(0, 5)} ${code.slice(5)}` : code;
  }

  function returnToHome() {
    window.location.replace(config.routes && config.routes.home || "../");
  }
})();
