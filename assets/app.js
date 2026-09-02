(() => {
  "use strict";

  const routes = [
    ["home", "Home", "index.html"],
    ["work", "Work", "projects/index.html"],
    ["live", "Live", "livestream.html"],
    ["gaming", "Gaming", "gaming/index.html"],
    ["support", "Support", "support.html"],
  ];

  const base = document.body.dataset.base || "";
  const route = document.body.dataset.route || "home";
  const chrome = document.querySelector("[data-site-chrome]");
  const footer = document.querySelector("[data-site-footer]");
  const relative = (path) => `${base}${path}`;

  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"></circle><path d="M5.5 20c.5-3.4 3.1-5.4 6.5-5.4s6 2 6.5 5.4"></path></svg>';

  function buildChrome() {
    if (!chrome) return;
    const nav = routes.map(([id, label, path]) => (
      `<a href="${relative(path)}" data-route-link="${id}" ${id === route ? 'class="is-active" aria-current="page"' : ""}>${label}</a>`
    )).join("");
    chrome.innerHTML = `
      <a class="skip-link" href="#main">Skip to content</a>
      <header class="site-header">
        <a class="brand-mark" href="${relative("index.html")}" aria-label="makz.space home">MAKZ<i>.</i>SPACE</a>
        <div class="route-note"><span data-nav-live-label>checking live</span></div>
      </header>
      <nav class="site-nav" aria-label="Main navigation">
        <span class="nav-indicator" aria-hidden="true"></span>
        ${nav}
        <button class="nav-profile" type="button" data-open-account aria-haspopup="dialog" aria-label="Open account panel">${icon}</button>
      </nav>
      <dialog class="account-dialog" data-account-dialog aria-labelledby="account-title">
        <div class="account-dialog__surface">
          <header>
            <h2 id="account-title">ACCOUNT<br>ACCESS</h2>
            <button class="dialog-close" type="button" data-close-account aria-label="Close account panel">×</button>
          </header>
          <p>Accounts are not enabled on this public build. No credentials are collected here, and there is no pretend sign-in flow. <a class="text-link" href="${relative("support.html")}">Community & contact</a></p>
          <small>When a real identity provider is configured, this same surface will host sign-in, recovery and profile preferences without changing the public experience.</small>
        </div>
        <div class="account-dialog__footer"><span>Public mode</span><span>Private by design</span></div>
      </dialog>`;
  }

  function buildFooter() {
    if (!footer) return;
    footer.innerHTML = `<footer class="site-footer">
      <span>© <span data-current-year></span> makz.space</span>
      <div>
        <a href="https://www.twitch.tv/motomakz" target="_blank" rel="noopener noreferrer">Twitch</a>
        <a href="https://www.tiktok.com/@moto.makz" target="_blank" rel="noopener noreferrer">TikTok</a>
        <a href="https://www.instagram.com/moto.makz/" target="_blank" rel="noopener noreferrer">Instagram</a>
      </div>
    </footer>`;
    footer.querySelector("[data-current-year]").textContent = String(new Date().getFullYear());
  }

  function placeNavIndicator() {
    const nav = document.querySelector(".site-nav");
    const current = nav?.querySelector(".is-active");
    const indicator = nav?.querySelector(".nav-indicator");
    if (!nav || !current || !indicator) return;
    const navBox = nav.getBoundingClientRect();
    const itemBox = current.getBoundingClientRect();
    indicator.style.width = `${itemBox.width}px`;
    indicator.style.transform = `translateX(${itemBox.left - navBox.left - 5}px)`;
  }

  function accountPanel() {
    const dialog = document.querySelector("[data-account-dialog]");
    document.querySelector("[data-open-account]")?.addEventListener("click", () => dialog?.showModal());
    dialog?.querySelector("[data-close-account]")?.addEventListener("click", () => dialog.close());
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  function motionEnhancements() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const object = document.querySelector("[data-signature-object]");
    if (object && !reduced && window.matchMedia("(pointer: fine)").matches) {
      object.addEventListener("pointermove", (event) => {
        const box = object.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width - .5;
        const y = (event.clientY - box.top) / box.height - .5;
        object.style.setProperty("--pointer-x", `${(x + .5) * 100}%`);
        object.style.setProperty("--pointer-y", `${(y + .5) * 100}%`);
        object.style.setProperty("--object-x", `${x * 18}px`);
        object.style.setProperty("--object-y", `${y * 15}px`);
        object.style.setProperty("--object-rotate", `${x * 7 - 3}deg`);
      }, { passive: true });
      object.addEventListener("pointerleave", () => {
        object.style.removeProperty("--object-x");
        object.style.removeProperty("--object-y");
        object.style.removeProperty("--object-rotate");
      });
    }

    if (!reduced && window.matchMedia("(pointer: fine)").matches) {
      document.querySelectorAll("[data-magnetic]").forEach((button) => {
        button.addEventListener("pointermove", (event) => {
          const box = button.getBoundingClientRect();
          const x = (event.clientX - box.left - box.width / 2) / box.width;
          const y = (event.clientY - box.top - box.height / 2) / box.height;
          button.style.transform = `translate3d(${x * 7}px, ${y * 6}px, 0)`;
        });
        button.addEventListener("pointerleave", () => { button.style.transform = ""; });
      });
    }
  }

  function reveals() {
    const items = document.querySelectorAll("[data-reveal]");
    if (!items.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .1, rootMargin: "0px 0px -32px" });
    items.forEach((item) => { item.classList.add("is-reveal"); observer.observe(item); });
  }

  function transitions() {
    if (!("startViewTransition" in document)) {
      document.addEventListener("click", (event) => {
        const link = event.target.closest("a[href]");
        if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.origin !== location.origin) return;
        const url = new URL(link.href);
        if (url.pathname === location.pathname || !url.pathname.endsWith(".html")) return;
        document.body.classList.add("is-leaving");
      });
    }
  }

  function filters() {
    const bar = document.querySelector("[data-filterbar]");
    if (!bar) return;
    const cards = [...document.querySelectorAll("[data-project-category]")];
    bar.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter]");
      if (!button) return;
      const selected = button.dataset.filter;
      bar.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      cards.forEach((card) => card.classList.toggle("is-hidden", selected !== "all" && !card.dataset.projectCategory.split(" ").includes(selected)));
    });
  }

  function copyFeedback() {
    document.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const original = button.textContent;
        try {
          await navigator.clipboard.writeText(button.dataset.copy);
          button.textContent = "Copied";
        } catch { button.textContent = "Copy unavailable"; }
        window.setTimeout(() => { button.textContent = original; }, 1500);
      });
    });
  }

  async function owncastStatus() {
    const label = document.querySelector("[data-nav-live-label]");
    const url = document.body.dataset.owncast;
    if (!url) return;
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/api/status`, { cache: "no-store" });
      if (!response.ok) throw new Error("Status unavailable");
      const data = await response.json();
      const online = Boolean(data.online ?? data.isOnline ?? data.live ?? data.streamOnline);
      const viewers = Number(data.viewerCount ?? data.viewers ?? data.currentViewers ?? 0) || 0;
      if (label) label.textContent = online ? `live · ${viewers} ${viewers === 1 ? "viewer" : "viewers"}` : "off air";
      document.querySelectorAll("[data-live-state]").forEach((element) => {
        element.classList.toggle("is-live", online);
        if (element.matches(".status-light")) return;
        element.textContent = online ? "Live now" : "Off air";
      });
      document.querySelectorAll("[data-viewer-count]").forEach((element) => { element.textContent = String(viewers); });
      document.dispatchEvent(new CustomEvent("makz:owncast", { detail: { online, viewers, data } }));
    } catch {
      if (label) label.textContent = "off air";
      document.querySelectorAll("[data-live-state]").forEach((element) => {
        element.classList.remove("is-live");
        if (!element.matches(".status-light")) element.textContent = "Off air";
      });
    }
  }

  buildChrome();
  buildFooter();
  placeNavIndicator();
  window.addEventListener("resize", placeNavIndicator, { passive: true });
  accountPanel();
  motionEnhancements();
  reveals();
  transitions();
  filters();
  copyFeedback();
  owncastStatus();
})();

