(function () {
  "use strict";

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isKnownFeatureKey(value, catalog) {
    const key = String(value || "");
    return Array.isArray(catalog) && catalog.some((feature) => feature && feature.key === key);
  }

  window.PaymentValidation = Object.freeze({ normalizeEmail, isKnownFeatureKey });
})();
