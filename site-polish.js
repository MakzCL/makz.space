(function(){
  const header = document.querySelector("header");
  if (header) {
    document.body.classList.add("site-has-header");

    let lastY = window.scrollY || 0;
    let ticking = false;

    function updateHeader(){
      const y = window.scrollY || 0;
      const scrollingDown = y > lastY;
      const farEnough = y > 170;

      if (farEnough && scrollingDown) {
        document.body.classList.add("site-header-hidden");
      } else if (!scrollingDown || y < 80) {
        document.body.classList.remove("site-header-hidden");
      }

      lastY = y;
      ticking = false;
    }

    window.addEventListener("scroll", function(){
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateHeader);
    }, { passive:true });
  }

  function setupDots(){
    let rail = document.querySelector(".rail");
    const main = document.querySelector("main") || document.querySelector(".container") || document.querySelector(".pageShell");
    if (!main) return;

    let sections = [...main.querySelectorAll(":scope > section[id]")];

    if (!sections.length) {
      sections = [...main.querySelectorAll(":scope > section, :scope > div")].filter((el) => {
        const box = el.getBoundingClientRect();
        return box.height > 80 || el.scrollHeight > 80;
      });
    }

    if (!sections.length) sections = [main];
    sections = sections.slice(0, 6);

    sections.forEach((section, index) => {
      if (!section.id) section.id = `site-section-${index + 1}`;
    });

    if (!rail) {
      rail = document.createElement("nav");
      rail.className = "site-rail";
      rail.setAttribute("aria-label", "Page section navigation");

      sections.forEach((section, index) => {
        const link = document.createElement("a");
        link.href = `#${section.id}`;
        link.textContent = section.getAttribute("aria-label") || section.id.replace(/[-_]/g, " ") || `Section ${index + 1}`;
        if (index === 0) link.classList.add("active");
        rail.appendChild(link);
      });

      document.body.appendChild(rail);
    }

    const links = [...rail.querySelectorAll("a")];
    const observedSections = links
      .map((link) => document.getElementById(link.getAttribute("href").slice(1)))
      .filter(Boolean);

    if (!observedSections.length || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;

      links.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`);
      });
    }, { threshold:[.18,.35,.55], rootMargin:"-20% 0px -45% 0px" });

    observedSections.forEach((section) => observer.observe(section));
  }

  function normalizeFooter(){
    let footer = document.querySelector("footer");
    if (!footer) {
      footer = document.createElement("footer");
      document.body.appendChild(footer);
    }

    footer.innerHTML = `
      <p>&copy; 2026 makz.space</p>
      <div>
        <a href="https://www.twitch.tv/motomakz" target="_blank" rel="noopener noreferrer">TWITCH</a>
        <a href="https://www.tiktok.com/@moto.makz" target="_blank" rel="noopener noreferrer">TIKTOK</a>
        <a href="https://www.instagram.com/moto.makz/" target="_blank" rel="noopener noreferrer">INSTAGRAM</a>
      </div>
    `;
  }

  normalizeFooter();
  setupDots();
})();
