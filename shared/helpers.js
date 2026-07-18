(function () {
  "use strict";

  const THEME_KEY = "paymentOrganizer.theme";

  function normalizeEnum(value) {
    return String(value || "").trim().toUpperCase();
  }

  function safeHttpsUrl(value) {
    return /^https:\/\//i.test(String(value || ""));
  }

  function initializeTheme() {
    const preferred = localStorage.getItem(THEME_KEY);
    const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(preferred === "dark" || preferred === "light" ? preferred : systemDark ? "dark" : "light");
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
      });
    });
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const dark = theme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      const label = button.querySelector(".theme-toggle-label");
      if (label) label.textContent = dark ? "Claro" : "Oscuro";
    });
  }

  document.addEventListener("DOMContentLoaded", initializeTheme);
  window.PaymentHelpers = Object.freeze({ normalizeEnum, safeHttpsUrl, applyTheme });
})();
