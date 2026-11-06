// The main process calls window.sendUpdate(status) whenever the update status changes.
(() => {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector(".updater");
  window.sendUpdate = (u) => {
    const v = u.version ? `Version ${u.version}` : "";
    $("version").textContent = v;
    main.classList.toggle("error", u.state === "error");
    main.classList.toggle("done", u.state === "restarting");
    const bar = $("bar"), fill = $("fill");
    if (u.state === "downloading") {
      $("title").textContent = "Downloading update";
      const pct = Math.max(0, Math.min(100, Math.round(u.percent ?? 0)));
      bar.classList.toggle("indeterminate", pct === 0);
      fill.style.width = pct + "%";
      $("detail").textContent = pct ? `${pct}%` : "Starting download…";
    } else if (u.state === "ready" || u.state === "installing") {
      $("title").textContent = "Installing update";
      bar.classList.add("indeterminate"); fill.style.width = "";
      $("detail").textContent = "SEND will restart in a moment";
    } else if (u.state === "restarting") {
      $("title").textContent = "Restarting SEND";
      bar.classList.remove("indeterminate"); fill.style.width = "100%";
      $("detail").textContent = "See you in a second";
    } else if (u.state === "error") {
      $("title").textContent = "Update didn’t finish";
      bar.classList.remove("indeterminate"); fill.style.width = "0";
      $("detail").textContent = "SEND is still on the current version. Try again from the green icon.";
    } else {
      $("title").textContent = "Updating SEND";
      bar.classList.add("indeterminate");
      $("detail").textContent = "Getting ready…";
    }
  };
})();
