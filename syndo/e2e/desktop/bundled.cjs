// Usage: node e2e/desktop/relay.mjs web/dist http://localhost:3900 4900 & node e2e/desktop/bundled.cjs
// (start the server with SEND_EXTRA_ORIGINS=http://sendapp.localhost:4900)
// The bundled interface (as in the desktop app) through the stand-in relay, next to a normal website user.
const { chromium } = require("playwright");
const APP = "http://sendapp.localhost:4900", WEB = "http://localhost:3900", SFX = Date.now().toString(36).slice(-5);
const check = (n, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${x ? `  (${x})` : ""}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const ca = await b.newContext({ viewport: { width: 1280, height: 820 }, permissions: ["microphone", "clipboard-read", "clipboard-write"] });
  await ca.addInitScript(() => {
    localStorage.setItem("send.whatsNew.seen", "skip");
    window.sendDesktop = new Proxy({ version: "0.8.0", platform: "win32", shell: "tauri", server: "http://localhost:3900", bundled: true,
      sessionToken: () => fetch("/__token").then((r) => r.json()), capabilities: { customTitlebar: false } }, { get: (t, k) => k in t ? t[k] : (typeof k === "string" && k.startsWith("on") ? () => () => {} : () => Promise.resolve(null)) });
  });
  const A = await ca.newPage(); const aErr = []; A.on("pageerror", (e) => aErr.push(e.message));
  const reqs = []; A.on("request", (r) => reqs.push(r.url()));
  const cb = await b.newContext({ viewport: { width: 1280, height: 820 } }); await cb.addInitScript(() => { localStorage.setItem("send.whatsNew.seen", "skip"); localStorage.setItem("send.desktop-prompt.dismissed.v1", "1"); });
  const B = await cb.newPage();
  const api = (p, m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: { "content-type": "application/json", "x-send-client": "1" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);

  await A.goto(APP + "/login");
  check("app shows the sign-in screen from its own copy", await A.locator("input[type=password]").count() > 0);
  check("app knows it's the bundled interface", await A.evaluate(() => location.hostname) === "sendapp.localhost");
  // Sign in through the app's relay (the session goes to the relay, not the page).
  await A.fill("input[autocomplete=username], input[name=login], input[type=text]", "ana").catch(() => {});
  const reg = await api(A, "POST", "/api/auth/register", { email: `app_${SFX}@example.test`, username: `app_${SFX}`, password: "correct horse battery" });
  check("register through the relay", reg.status === 200, String(reg.status));
  check("the page has no session cookie of its own", (await ca.cookies()).every((c) => !/session/.test(c.name)));
  await A.goto(APP + "/channels/@me");
  await A.waitForSelector(".shell", { timeout: 20000 }).catch(() => {});
  check("app opens signed in", await A.locator(".shell").count() === 1);

  const g = (await api(A, "POST", "/api/guilds", { name: "Desktop app test", template: "friends" })).body;
  const text = g.channels.find((c) => c.type === 0), room = g.channels.find((c) => c.type === 2);
  const inv = (await api(A, "POST", `/api/channels/${text.id}/invites`, {})).body;
  await B.goto(WEB + "/login");
  await api(B, "POST", "/api/auth/register", { email: `web_${SFX}@example.test`, username: `web_${SFX}`, password: "correct horse battery" });
  await api(B, "POST", `/api/invites/${inv.code}`, {});
  await A.goto(`${APP}/channels/${g.id}/${text.id}`); await A.waitForSelector(".composer textarea", { timeout: 20000 });
  await B.goto(`${WEB}/channels/${g.id}/${text.id}`); await B.waitForSelector(".composer textarea", { timeout: 20000 });
  await sleep(1500);
  await B.fill(".composer textarea", "hello from the website"); await B.keyboard.press("Enter");
  await A.waitForSelector("text=hello from the website", { timeout: 10000 }).catch(() => {});
  check("live messages reach the app (live connection signed in with the app's session)", await A.locator("text=hello from the website").count() > 0);
  await A.fill(".composer textarea", "hello from the app"); await A.keyboard.press("Enter");
  await B.waitForSelector("text=hello from the app", { timeout: 10000 }).catch(() => {});
  check("messages from the app reach the website", await B.locator("text=hello from the app").count() > 0);

  // Invite link: must be the server's address, not the app's.
  const link = await A.evaluate(async (gid) => { const m = await import("/src/origin.ts").catch(() => null); return null; }, g.id);
  void link;
  // Upload a picture through the relay and see it shown (served straight from the server).
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000100000001008020000009091683600000019494441547801636460f8cf4002a002e360c0a8a0a0a000058c0d01f4e5a27f0000000049454e44ae426082", "hex");
  await A.setInputFiles(".composer input[type=file]", { name: "dot.png", mimeType: "image/png", buffer: png });
  await sleep(800); await A.keyboard.press("Enter").catch(() => {}); await A.locator(".composer textarea").press("Enter").catch(() => {});
  await sleep(2500);
  const imgOk = await A.evaluate(() => [...document.querySelectorAll(".msg img")].some((i) => i.complete && i.naturalWidth > 0 && /attachments|media|files/.test(i.currentSrc)));
  check("an uploaded picture shows in the app", imgOk, await A.evaluate(() => [...document.querySelectorAll(".msg img")].map((i) => i.currentSrc.slice(0, 80) + " " + i.naturalWidth).join(" | ")));

  // Voice through the app.
  await A.goto(`${APP}/channels/${g.id}/${text.id}`); await A.waitForSelector(".side-ch"); await A.locator(".side-ch", { hasText: room.name }).first().click();
  await A.waitForSelector(".call-controls", { timeout: 15000 }).catch(() => {});
  check("joins a voice room from the app", await A.locator(".call-controls").count() === 1);
  const share = await A.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /invite/i.test(x.getAttribute("aria-label") ?? "")); return !!b; });
  void share;
  

  // Shared links point at the server.
  await A.goto(`${APP}/channels/${g.id}/${text.id}`); await A.waitForSelector(".composer textarea");
  await A.evaluate(([gid, cid]) => window.dispatchEvent(new CustomEvent("send:dialog", { detail: { kind: "invite", guildId: gid, channelId: cid } })), [g.id, text.id]);
  await sleep(1500);
  const inviteText = await A.evaluate(() => [...document.querySelectorAll(".modal input")].map((i) => i.value).find((v) => /invite\//.test(v)) ?? "");
  check("invite links use the server's address, not the app's", inviteText.startsWith("http://localhost:3900/invite/"), inviteText);
  await A.keyboard.press("Escape");
  const msgLink = await A.evaluate(() => import("/src/router.ts").then((m) => m.messageLink("1", "2", "3")).catch(() => null));
  void msgLink;
  // Sign out through the relay clears the session.
  await api(A, "POST", "/api/auth/logout", {});
  check("signing out clears the app's session", (await (await fetch("http://127.0.0.1:4900/__token")).json()) === null);
  check("no page errors in the app", !aErr.length, aErr.join(" | ").slice(0, 200));
  check("the app never loaded the website's pages", !reqs.some((u) => u.startsWith(WEB) && !/\/api\/(media|files|emotes|music|downloads)|\/gateway/.test(u)), reqs.filter((u) => u.startsWith(WEB)).slice(0, 3).join(" "));
  await b.close();
})();
