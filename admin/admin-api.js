(function () {
  "use strict";

  const config = window.PAYMENT_ORGANIZER_ADMIN_CONFIG || {};
  const sharedApi = window.PaymentApi;
  const SESSION_KEY = "paymentOrganizer.adminSession";

  class AdminApiError extends Error {
    constructor(code, message, correlationId) {
      super(message);
      this.name = "AdminApiError";
      this.code = code;
      this.correlationId = correlationId || "";
    }
  }

  function hasEndpoint() {
    return Boolean(sharedApi && sharedApi.hasEndpoint() && typeof config.apiUrl === "string" && config.apiUrl);
  }

  async function request(action, payload = {}, options = {}) {
    if (!hasEndpoint()) throw new AdminApiError("CLIENT_NOT_CONFIGURED", "El servicio administrativo no está configurado.");
    return sharedApi.request(action, payload, options);
  }

  function saveSession(session, profile) {
    if (!session || typeof session.token !== "string" || session.sessionType !== "ADMIN") {
      throw new AdminApiError("INVALID_SESSION", "No se recibió una sesión administrativa válida.");
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      token: session.token,
      expiresAt: session.expiresAt,
      identity: profile && (profile.email || profile.name) || "Administrador"
    }));
  }

  function getSession() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (!stored || typeof stored.token !== "string" || new Date(stored.expiresAt).getTime() <= Date.now()) {
        clearSession();
        return null;
      }
      return stored;
    } catch (error) {
      clearSession();
      return null;
    }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  window.AdminApi = Object.freeze({ AdminApiError, hasEndpoint, request, saveSession, getSession, clearSession });
})();
