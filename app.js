(function () {
  "use strict";

  const config = window.PAYMENT_ORGANIZER_CONFIG || {};
  const api = window.PaymentApi;
  const state = {
    authMode: "login",
    pendingEmail: "",
    publicSettings: {},
    busy: false
  };

  document.addEventListener("DOMContentLoaded", initialize);

  async function initialize() {
    setYear();
    initializeHeader();
    initializeRevealAnimations();
    initializeFaq();
    initializeAuthDialog();
    initializeContactForm();
    renderGallery();
    renderDeveloper();
    await loadPublicConfiguration();
  }

  function setYear() {
    document.querySelectorAll("[data-year]").forEach((element) => {
      element.textContent = String(new Date().getFullYear());
    });
  }

  function initializeHeader() {
    const header = document.querySelector("[data-header]");
    const menuButton = document.querySelector("[data-menu-button]");
    const navigation = document.querySelector("[data-navigation]");
    const actions = document.querySelector("[data-access-actions]");
    const updateHeader = () => header && header.classList.toggle("is-scrolled", window.scrollY > 12);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    if (!menuButton || !navigation) return;
    menuButton.addEventListener("click", () => {
      const open = menuButton.getAttribute("aria-expanded") !== "true";
      menuButton.setAttribute("aria-expanded", String(open));
      navigation.classList.toggle("is-open", open);
      if (actions && !actions.hidden) actions.classList.toggle("is-open", open);
    });
    navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      menuButton.setAttribute("aria-expanded", "false");
      navigation.classList.remove("is-open");
      if (actions) actions.classList.remove("is-open");
    }));
  }

  function initializeRevealAnimations() {
    const elements = Array.from(document.querySelectorAll(".reveal"));
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -30px" });
    elements.forEach((element) => observer.observe(element));
  }

  function initializeFaq() {
    document.querySelectorAll(".faq-list details").forEach((details) => {
      details.addEventListener("toggle", () => {
        if (!details.open) return;
        document.querySelectorAll(".faq-list details[open]").forEach((other) => {
          if (other !== details) other.open = false;
        });
      });
    });
  }

  async function loadPublicConfiguration() {
    if (!api || !api.hasEndpoint() || config.accessEnabled === false) {
      configureUnavailableForms();
      return;
    }
    try {
      const result = await api.request("getPublicConfig");
      state.publicSettings = result && result.settings || {};
      configureAccessControls();
      await renderDownloads();
    } catch (error) {
      configureUnavailableForms();
    }
  }

  function configureAccessControls() {
    const allowLogin = state.publicSettings.ALLOW_LOGIN !== false;
    const allowRegistration = state.publicSettings.ALLOW_REGISTRATION !== false;
    const actionContainer = document.querySelector("[data-access-actions]");
    document.querySelectorAll('[data-open-auth="login"]').forEach((button) => { button.hidden = !allowLogin; });
    document.querySelectorAll('[data-open-auth="register"]').forEach((button) => { button.hidden = !allowRegistration; });
    document.querySelectorAll("[data-access-control]").forEach((button) => { button.hidden = !allowRegistration; });
    if (actionContainer) actionContainer.hidden = !(allowLogin || allowRegistration);
  }

  function configureUnavailableForms() {
    document.querySelectorAll("[data-open-auth], [data-access-control]").forEach((button) => { button.hidden = true; });
    const actions = document.querySelector("[data-access-actions]");
    if (actions) actions.hidden = true;
    const form = document.querySelector("[data-contact-form]");
    if (form) {
      form.querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = true; });
      setStatus(form.querySelector("[data-contact-status]"), "El formulario no está disponible en este momento.", "error");
    }
  }

  function initializeAuthDialog() {
    const dialog = document.querySelector("[data-auth-dialog]");
    if (!dialog) return;
    document.querySelectorAll("[data-open-auth]").forEach((button) => {
      button.addEventListener("click", () => openAuth(button.dataset.openAuth));
    });
    dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("dialog-open");
      resetAuthRequest();
    });
    dialog.querySelectorAll("[data-auth-tab]").forEach((tab) => {
      tab.addEventListener("click", () => selectAuthMode(tab.dataset.authTab));
    });
    dialog.querySelector("[data-login-form]").addEventListener("submit", requestLoginCode);
    dialog.querySelector("[data-register-form]").addEventListener("submit", requestRegistrationCode);
    dialog.querySelector("[data-code-form]").addEventListener("submit", confirmCode);
    dialog.querySelector("[data-auth-back]").addEventListener("click", resetAuthRequest);
  }

  function openAuth(mode) {
    if (!api || !api.hasEndpoint()) return;
    const dialog = document.querySelector("[data-auth-dialog]");
    selectAuthMode(mode === "register" ? "register" : "login");
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("dialog-open");
    window.setTimeout(() => dialog.querySelector("form:not([hidden]) input")?.focus(), 50);
  }

  function selectAuthMode(mode) {
    state.authMode = mode;
    const dialog = document.querySelector("[data-auth-dialog]");
    const register = mode === "register";
    dialog.querySelector("[data-auth-title]").textContent = register ? "Crear cuenta" : "Iniciar sesión";
    dialog.querySelector("[data-auth-description]").textContent = register
      ? "Confirma tu correo con un código seguro. No necesitas crear una contraseña."
      : "Te enviaremos un código de seis dígitos. No necesitas contraseña.";
    dialog.querySelector("[data-login-form]").hidden = register;
    dialog.querySelector("[data-register-form]").hidden = !register;
    dialog.querySelectorAll("[data-auth-tab]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.authTab === mode));
    });
    setStatus(dialog.querySelector("[data-auth-status]"), "");
  }

  async function requestLoginCode(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateForm(form)) return;
    const email = window.PaymentValidation.normalizeEmail(form.elements.email.value);
    await requestCode("requestLoginCode", { email, sessionType: "PORTAL" }, email, form);
  }

  async function requestRegistrationCode(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateForm(form)) return;
    const email = window.PaymentValidation.normalizeEmail(form.elements.email.value);
    await requestCode("requestRegistrationCode", {
      name: form.elements.name.value.trim(),
      email,
      termsAccepted: form.elements.termsAccepted.checked,
      privacyAccepted: form.elements.privacyAccepted.checked,
      requestFingerprint: getRequestNonce()
    }, email, form);
  }

  async function requestCode(action, payload, email, form) {
    if (state.busy) return;
    setBusy(form, true);
    const status = document.querySelector("[data-auth-status]");
    setStatus(status, "Enviando código…");
    try {
      const result = await api.request(action, payload);
      state.pendingEmail = email;
      document.querySelector("[data-auth-request]").hidden = true;
      document.querySelector("[data-auth-confirm]").hidden = false;
      setStatus(status, result.message || "Si la solicitud es válida, recibirás un código por correo.", "success");
      document.querySelector("[data-code-form] input").focus();
    } catch (error) {
      setStatus(status, friendlyError(error), "error");
    } finally {
      setBusy(form, false);
    }
  }

  async function confirmCode(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!validateForm(form) || state.busy) return;
    const code = form.elements.code.value.replace(/\D/g, "");
    if (code.length !== 6) {
      form.elements.code.setAttribute("aria-invalid", "true");
      setStatus(document.querySelector("[data-auth-status]"), "Introduce los seis dígitos del código.", "error");
      return;
    }
    setBusy(form, true);
    const status = document.querySelector("[data-auth-status]");
    setStatus(status, "Confirmando acceso…");
    try {
      const action = state.authMode === "register" ? "confirmRegistration" : "confirmLogin";
      const payload = { email: state.pendingEmail, code };
      if (state.authMode === "login") payload.sessionType = "PORTAL";
      const result = await api.request(action, payload);
      api.savePortalSession(result.session);
      window.location.assign(config.routes && config.routes.portal || "./portal/");
    } catch (error) {
      setStatus(status, friendlyError(error), "error");
    } finally {
      setBusy(form, false);
    }
  }

  function resetAuthRequest() {
    const dialog = document.querySelector("[data-auth-dialog]");
    state.pendingEmail = "";
    dialog.querySelector("[data-auth-request]").hidden = false;
    dialog.querySelector("[data-auth-confirm]").hidden = true;
    dialog.querySelector("[data-code-form]").reset();
    setStatus(dialog.querySelector("[data-auth-status]"), "");
  }

  function initializeContactForm() {
    const form = document.querySelector("[data-contact-form]");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!validateForm(form) || state.busy) return;
      setBusy(form, true);
      const status = form.querySelector("[data-contact-status]");
      setStatus(status, "Enviando mensaje…");
      try {
        const data = new FormData(form);
        const result = await api.request("submitContact", {
          name: String(data.get("name") || "").trim(),
          email: String(data.get("email") || "").trim().toLowerCase(),
          subject: String(data.get("subject") || "").trim(),
          message: String(data.get("message") || "").trim(),
          website: String(data.get("website") || "")
        });
        form.reset();
        setStatus(status, `Mensaje recibido${result.reference ? ` · Referencia ${result.reference}` : ""}.`, "success");
      } catch (error) {
        setStatus(status, friendlyError(error), "error");
      } finally {
        setBusy(form, false);
      }
    });
  }

  function renderGallery() {
    const screenshots = Array.isArray(config.screenshots) ? config.screenshots : [];
    const valid = screenshots.filter((item) => item && typeof item.src === "string" && item.src && typeof item.alt === "string" && item.alt);
    if (!valid.length) return;
    const section = document.querySelector("[data-gallery-section]");
    const gallery = document.querySelector("[data-gallery]");
    valid.forEach((item) => {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = item.src;
      image.alt = item.alt;
      image.loading = "lazy";
      image.decoding = "async";
      figure.append(image);
      if (item.caption) {
        const caption = document.createElement("figcaption");
        caption.textContent = item.caption;
        figure.append(caption);
      }
      gallery.append(figure);
    });
    section.hidden = false;
  }

  function renderDeveloper() {
    const developer = config.developer || {};
    if (!developer.name || !developer.biography) return;
    const section = document.querySelector("[data-developer-section]");
    section.querySelector("[data-developer-name]").textContent = developer.name;
    section.querySelector("[data-developer-bio]").textContent = developer.biography;
    if (developer.motivation) {
      const motivation = section.querySelector("[data-developer-motivation]");
      motivation.textContent = developer.motivation;
      motivation.hidden = false;
    }
    if (developer.mission) {
      const mission = section.querySelector("[data-developer-mission]");
      mission.textContent = developer.mission;
      mission.hidden = false;
    }
    const photo = section.querySelector("[data-developer-photo]");
    if (developer.photoUrl) {
      photo.src = developer.photoUrl;
      photo.alt = `Fotografía de ${developer.name}`;
    } else {
      photo.hidden = true;
    }
    const links = section.querySelector("[data-developer-links]");
    [
      ["GitHub", developer.githubUrl],
      ["Red social", developer.socialUrl],
      ["Sitio web", developer.websiteUrl],
      ["Correo", developer.email ? `mailto:${developer.email}` : ""]
    ].forEach(([label, url]) => {
      if (!url) return;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.textContent = label;
      if (!url.startsWith("mailto:")) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
      links.append(anchor);
    });
    section.hidden = false;
  }

  async function renderDownloads() {
    const platforms = [
      ["WINDOWS", "DOWNLOAD_WINDOWS_ENABLED", "Descargar para Windows"],
      ["ANDROID", "DOWNLOAD_ANDROID_ENABLED", "Descargar para Android"],
      ["IOS", "DOWNLOAD_IOS_ENABLED", "Ver para iPhone"]
    ];
    const downloads = [];
    const container = document.querySelector("[data-downloads]");
    if (container) container.replaceChildren();
    await Promise.all(platforms.map(async ([platform, flag, label]) => {
      if (!state.publicSettings[flag]) return;
      try {
        const version = await api.request("getAvailableVersion", { platform });
        const url = version.storeUrl || version.downloadUrl;
        if (version.available && /^https:\/\//i.test(url || "")) {
          downloads.push({ platform, label, url, version: version.version });
        }
      } catch (error) {
        return;
      }
    }));
    downloads.forEach((download) => {
      const status = document.querySelector(`[data-download-status="${download.platform}"]`);
      if (status) status.textContent = `Versión ${download.version} disponible.`;
      const anchor = document.createElement("a");
      anchor.className = "button button-primary";
      anchor.href = download.url;
      anchor.textContent = `${download.label} · ${download.version}`;
      anchor.rel = "noopener noreferrer";
      if (container) container.append(anchor);
    });
  }

  function validateForm(form) {
    let valid = true;
    form.querySelectorAll("input, textarea").forEach((control) => {
      const controlValid = control.checkValidity();
      control.setAttribute("aria-invalid", String(!controlValid));
      if (!controlValid) valid = false;
    });
    if (!valid) form.reportValidity();
    return valid;
  }

  function setBusy(form, busy) {
    state.busy = busy;
    form.querySelectorAll("button, input, textarea").forEach((control) => { control.disabled = busy; });
  }

  function setStatus(element, message, type) {
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
  }

  function friendlyError(error) {
    if (!error) return "No fue posible completar la solicitud.";
    return error.message || "No fue posible completar la solicitud.";
  }

  function getRequestNonce() {
    const key = "paymentOrganizer.requestNonce";
    let nonce = sessionStorage.getItem(key);
    if (!nonce) {
      if (typeof window.crypto.randomUUID === "function") {
        nonce = window.crypto.randomUUID();
      } else {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        nonce = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      sessionStorage.setItem(key, nonce);
    }
    return nonce;
  }
})();
