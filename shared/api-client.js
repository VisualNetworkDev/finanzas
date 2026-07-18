(function () {
  "use strict";

  const config = window.PAYMENT_ORGANIZER_CONFIG || {};
  const SESSION_KEY = "paymentOrganizer.portalSession";

  class ApiError extends Error {
    constructor(code, message, correlationId) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.correlationId = correlationId || "";
    }
  }

  function hasEndpoint() {
    if (typeof config.apiUrl !== "string") return false;
    if (/^https:\/\//i.test(config.apiUrl)) return true;
    return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(config.apiUrl);
  }

  async function request(action, payload = {}, options = {}) {
    if (!hasEndpoint()) {
      throw new ApiError("CLIENT_NOT_CONFIGURED", "El servicio no está disponible en este momento.");
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    const body = {
      version: "v1",
      action,
      payload,
      requestId: createRequestId()
    };
    if (options.token) body.token = options.token;
    if (options.deviceToken) body.deviceToken = options.deviceToken;
    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
        referrerPolicy: "strict-origin-when-cross-origin"
      });
      const result = await response.json();
      if (!result || typeof result.ok !== "boolean" || !("data" in result) || !("error" in result) || typeof result.correlationId !== "string") {
        throw new ApiError("INVALID_API_RESPONSE", "El servicio respondió de forma inesperada.");
      }
      if (!result.ok) {
        throw new ApiError(
          result.error && result.error.code || "REQUEST_FAILED",
          result.error && result.error.message || "No fue posible completar la solicitud.",
          result.correlationId
        );
      }
      return result.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error && error.name === "AbortError") {
        throw new ApiError("NETWORK_TIMEOUT", "La solicitud tardó demasiado. Inténtalo nuevamente.");
      }
      throw new ApiError("NETWORK_ERROR", "No fue posible conectar con el servicio. Revisa tu conexión.");
    } finally {
      window.clearTimeout(timer);
    }
  }

  function savePortalSession(session) {
    if (!session || typeof session.token !== "string" || typeof session.expiresAt !== "string") {
      throw new ApiError("INVALID_SESSION", "No fue posible iniciar la sesión.");
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt }));
  }

  function getPortalSession() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (!stored || typeof stored.token !== "string" || new Date(stored.expiresAt).getTime() <= Date.now()) {
        clearPortalSession();
        return null;
      }
      return stored;
    } catch (error) {
      clearPortalSession();
      return null;
    }
  }

  function clearPortalSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  window.PaymentApi = Object.freeze({
    ApiError,
    hasEndpoint,
    request,
    savePortalSession,
    getPortalSession,
    clearPortalSession
  });
})();
