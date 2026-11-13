import { Select } from "../components/Select.tsx";
import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import { Bot, Code2, Copy, Eye, EyeOff, Fingerprint, Gamepad2, Link2, Music, Plus, PlaySquare, QrCode, RefreshCw, Search, Smartphone, Trash2, Tv, Radio } from "lucide-react";
import QRCode from "qrcode";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { P, type Application, type ApplicationCommand, type Connection } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { updateSettings } from "../actions.ts";
import { guildPerms, toast, useStore } from "../store.ts";
import { Avatar, Field, Modal, Toggle } from "../components/ui.tsx";
import { askConfirm, askText } from "../components/overlay.tsx";
import { disablePush, enablePush, pushState } from "./Notifications.tsx";
import { openModal } from "./modals.tsx";

const EMPTY = {};
const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); return true; } catch (e) { toast(errMsg(e), "error"); return false; } };

/* ------------------------------------------------------------------------------ passkeys -- */
export function PasskeysCard() {
  const [list, setList] = useState<{ id: string; name: string; created_at: string; last_used_at: string | null }[] | null>(null);
  const load = () => api.get("/api/auth/passkeys").then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const add = async () => {
    try {
      const { challenge_id, options } = await api.post<{ challenge_id: string; options: any }>("/api/auth/passkeys/register/options");
      const response = await startRegistration({ optionsJSON: options });
      const name = (await askText({ title: "Name this passkey", label: "Name", initial: /Windows/.test(navigator.userAgent) ? "Windows Hello" : /iPhone|Mac/.test(navigator.userAgent) ? "Apple device" : /Android/.test(navigator.userAgent) ? "Android phone" : "Passkey", optional: true })) || "Passkey";
      await api.post("/api/auth/passkeys/register/verify", { challenge_id, response, name });
      toast("Passkey added. You can now sign in without a password.", "success"); load();
    } catch (e) { if ((e as Error).name !== "NotAllowedError") toast(errMsg(e), "error"); }
  };
  if (!window.PublicKeyCredential) return null;
  return <div className="card"><h3><Fingerprint size={18} /> Passkeys</h3>
    <p className="muted small">Sign in with your fingerprint, face or device PIN instead of a password. Passkeys can't be phished.</p>
    {list?.map((p) => <div key={p.id} className="row"><Fingerprint size={16} /><span className="grow">{p.name}<small className="muted block">Added {new Date(p.created_at).toLocaleDateString()}{p.last_used_at ? ` · last used ${new Date(p.last_used_at).toLocaleDateString()}` : ""}</small></span>
      <button className="icon-btn sm danger" aria-label={`Remove ${p.name}`} onClick={async () => { if (await askConfirm({ title: `Remove ${p.name}?`, confirmLabel: "Remove", danger: true })) run(() => api.del(`/api/auth/passkeys/${encodeURIComponent(p.id)}`)).then(load); }}><Trash2 size={14} /></button></div>)}
    <button className="btn primary sm" onClick={add}><Plus size={14} /> Add a passkey</button>
  </div>;
}

/** "Sign in with a passkey" on the login page. */
export async function passkeyLogin() {
  const { challenge_id, options } = await api.post<{ challenge_id: string; options: any }>("/api/auth/passkeys/login/options");
  const response = await startAuthentication({ optionsJSON: options });
  return api.post("/api/auth/passkeys/login/verify", { challenge_id, response });
}

/* ---------------------------------------------------------------------- QR code sign-in -- */
/** On the login page: a QR code to scan with the SEND app on a phone that's already signed in. */
export function QrLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "pending" | "scanned" | "expired">("loading");
  const [who, setWho] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const q = await api.post<{ id: string; secret: string; url: string }>("/api/auth/qr");
        setImg(await QRCode.toDataURL(q.url, { margin: 1, width: 200, color: { dark: "#0E1220", light: "#FFFFFF" } })); setState("pending");
        const poll = async () => {
          if (stop) return;
          const r = await api.post<{ status: string; user?: any }>(`/api/auth/qr/${q.id}/poll`, { secret: q.secret }).catch(() => ({ status: "pending" } as any));
          if (r.status === "approved") { onSignedIn(); return; }
          if (r.status === "expired" || r.status === "cancelled") { setState("expired"); return; }
          if (r.status === "scanned") { setState("scanned"); setWho(r.user?.display_name || r.user?.username || null); }
          timer = setTimeout(poll, 2000);
        };
        timer = setTimeout(poll, 2000);
      } catch { setState("expired"); }
    })();
    return () => { stop = true; clearTimeout(timer); };
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="qr-login">
    {state === "expired" ? <button className="btn" onClick={() => { setState("loading"); setN((x) => x + 1); }}><RefreshCw size={14} /> New code</button>
      : state === "scanned" ? <p><Smartphone size={18} /> Check your phone{who ? `, ${who}` : ""}: tap <strong>Yes, sign in</strong>.</p>
      : img ? <img src={img} alt="QR code to sign in with your phone" width={180} height={180} /> : <p className="muted">Loading…</p>}
    <strong>Sign in with QR code</strong>
    <p className="muted small">Open SEND on a phone where you're signed in, then scan this with the phone's camera.</p>
  </div>;
}

/** /qr/:id — opened on the signed-in phone after scanning. */
export function QrApprove({ id }: { id: string }) {
  const me = useStore((s) => s.me);
  const [state, setState] = useState<"loading" | "ask" | "done" | "error">("loading");
  useEffect(() => { if (me) api.post(`/api/auth/qr/${id}/scan`).then(() => setState("ask")).catch(() => setState("error")); }, [me, id]);
  if (!me) return <p className="pad">Sign in on this device first, then scan the code again.</p>;
  return <div className="qr-approve">
    {state === "loading" && <p>Checking the code…</p>}
    {state === "error" && <p>This code has expired. Make a new one on the other device.</p>}
    {state === "ask" && <><Avatar user={me} size={64} /><h2>Sign in on another device?</h2><p className="muted">Only continue if you just scanned a code on a computer or tablet you own.</p>
      <div className="row"><button className="btn" onClick={() => api.post(`/api/auth/qr/${id}/cancel`).then(() => setState("error"))}>No, cancel</button><button className="btn primary" onClick={() => api.post(`/api/auth/qr/${id}/approve`).then(() => setState("done")).catch(() => setState("error"))}>Yes, sign in</button></div></>}
    {state === "done" && <><h2>Signed in</h2><p className="muted">You can close this and go back to the other device.</p></>}
  </div>;
}

/* ---------------------------------------------------------------------------- connections -- */
const ICONS: Record<string, React.ReactNode> = { github: <Code2 size={18} />, twitch: <Radio size={18} />, spotify: <Music size={18} />, youtube: <PlaySquare size={18} />, steam: <Gamepad2 size={18} />, xbox: <Gamepad2 size={18} />, reddit: <Tv size={18} /> };
export const connectionIcon = (t: string) => ICONS[t] ?? <Link2 size={18} />;
export function ConnectionsTab() {
  const [d, setD] = useState<{ connections: (Connection & { url?: string | null })[]; available: { type: string; name: string; ready: boolean }[] } | null>(null);
  const load = () => api.get("/api/connections").then(setD).catch(() => {});
  useEffect(() => { load(); const q = new URLSearchParams(location.search); if (q.get("connected")) toast("Connected.", "success"); if (q.get("error")) toast(q.get("error")!, "error"); }, []);
  const connect = async (t: string) => { try { const r = await api.get<{ url: string }>(`/api/connections/${t}/authorize`); location.href = r.url; } catch (e) { toast(errMsg(e), "error"); } };
  const share = useStore((s) => (s.me?.settings as any)?.share_activity !== false);
  return <div className="settings-section">
    <h2>Connections</h2>
    <p className="muted">Connect accounts to show them on your profile.</p>
    <div className="conn-grid">{d?.available.map((a) => <button key={a.type} className="conn-tile" disabled={!a.ready} title={a.ready ? `Connect ${a.name}` : `${a.name} isn't set up on this server yet`} onClick={() => connect(a.type)}>{connectionIcon(a.type)}<span>{a.name}</span></button>)}</div>
    {d?.connections.map((c) => <div key={`${c.type}:${c.id}`} className="card conn-row">{connectionIcon(c.type)}<span className="grow"><strong>{c.name}</strong><small className="muted block">{c.type}</small></span>
      <Toggle label="On profile" checked={c.visible} onChange={(v) => run(() => api.patch(`/api/connections/${c.type}/${encodeURIComponent(c.id)}`, { visible: v })).then(load)} />
      <button className="icon-btn sm danger" aria-label="Disconnect" onClick={() => run(() => api.del(`/api/connections/${c.type}/${encodeURIComponent(c.id)}`)).then(load)}><Trash2 size={14} /></button></div>)}
    <h3>Activity</h3>
    <Toggle label="Share what I'm playing" hint="The desktop app can show the game you're in as “Playing …” on your profile." checked={share} onChange={(v) => updateSettings({ share_activity: v })} />
  </div>;
}

/* --------------------------------------------------------------------------------- apps -- */
export function AppsTab() {
  const [tab, setTab] = useState<"directory" | "mine">("directory");
  return <div className="settings-section">
    <h2><Bot size={20} /> Apps</h2>
    <div className="seg"><button aria-selected={tab === "directory"} onClick={() => setTab("directory")}>App Directory</button><button aria-selected={tab === "mine"} onClick={() => setTab("mine")}>My apps (developers)</button></div>
    {tab === "directory" ? <Directory /> : <Developer />}
  </div>;
}

function Directory() {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Application[] | null>(null);
  useEffect(() => { const t = setTimeout(() => api.get<Application[]>(`/api/directory?q=${encodeURIComponent(q)}`).then(setList).catch(() => setList([])), 250); return () => clearTimeout(t); }, [q]);
  return <>
    <div className="forum-search"><Search size={16} /><input placeholder="Search apps" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search apps" /></div>
    {!list ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">No apps listed yet. Developers can list theirs under My apps.</p>
      : <div className="app-grid">{list.map((a) => <button key={a.id} className="app-card" onClick={() => openInstall(a)}>{a.icon ? <img src={a.icon} alt="" /> : <Bot size={32} />}<strong>{a.name}</strong><span className="muted small">{a.description}</span><small className="muted">{a.install_count} servers</small></button>)}</div>}
  </>;
}

export function openInstall(a: Application) { openModal((close) => <Install app={a} onClose={close} />); }
function Install({ app, onClose }: { app: Application; onClose: () => void }) {
  const guilds = useStore(useShallow((s) => Object.values(s.guilds).filter((g) => (guildPerms(g) & P.MANAGE_GUILD) !== 0n)));
  const [gid, setGid] = useState(guilds[0]?.id ?? "");
  const [perms, setPerms] = useState({ send: true, read: true, embed: true, react: true, manage: false, admin: false });
  const [cmds, setCmds] = useState<ApplicationCommand[]>([]);
  useEffect(() => { api.get<{ commands: ApplicationCommand[] }>(`/api/directory/${app.id}`).then((r) => setCmds(r.commands ?? [])).catch(() => {}); }, [app.id]);
  const bits = (perms.send ? P.SEND_MESSAGES : 0n) | (perms.read ? P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY : 0n) | (perms.embed ? P.EMBED_LINKS | P.ATTACH_FILES : 0n) | (perms.react ? P.ADD_REACTIONS : 0n) | (perms.manage ? P.MANAGE_MESSAGES : 0n) | (perms.admin ? P.ADMINISTRATOR : 0n) | P.USE_APPLICATION_COMMANDS;
  const add = () => run(() => api.post(`/api/applications/${app.id}/install`, { guild_id: gid, permissions: bits.toString() }), `${app.name} added.`).then((ok) => ok && onClose());
  return <Modal title={`Add ${app.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!gid} onClick={add}>Authorize</button></>}>
    <p className="muted">{app.description}</p>
    {cmds.length > 0 && <p className="small">Commands: {cmds.map((c) => `/${c.name}`).join(" ")}</p>}
    {guilds.length ? <Field label="Add to server"><Select value={gid} onChange={(e) => setGid(e.target.value)}>{guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field> : <p className="muted">You need Manage Server in a server to add apps.</p>}
    <fieldset className="radio-list"><legend>It can</legend>
      {([["read", "See channels and read history"], ["send", "Send messages"], ["embed", "Post links, embeds and files"], ["react", "Add reactions"], ["manage", "Manage messages"], ["admin", "Administrator (everything)"]] as const).map(([k, l]) => <label key={k}><input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} /> {l}</label>)}
    </fieldset>
  </Modal>;
}

function Developer() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api.get<Application[]>("/api/applications").then(setApps).catch(() => setApps([]));
  useEffect(() => { load(); }, []);
  const create = async () => { const name = await askText({ title: "New app", label: "Name" }); if (name) run(() => api.post("/api/applications", { name }), "App created.").then(load); };
  return <>
    <p className="muted small">Make a bot: create an app, copy its token, and connect with any HTTP/WebSocket library. Bots use the same API as the app (Authorization: Bearer &lt;token&gt;) and the gateway (send {"{"}"op":"identify","token":"…"{"}"}). Slash commands: PUT /api/applications/&lt;id&gt;/commands.</p>
    <button className="btn primary sm" onClick={create}><Plus size={14} /> New app</button>
    {apps?.map((a) => <div key={a.id} className="card">
      <div className="row">{a.icon ? <img src={a.icon} alt="" className="app-ico" /> : <Bot size={24} />}<strong className="grow">{a.name}</strong><button className="btn sm" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "Close" : "Manage"}</button></div>
      {open === a.id && <AppEditor app={a} onChange={load} />}
    </div>)}
  </>;
}
function AppEditor({ app, onChange }: { app: Application; onChange: () => void }) {
  const [f, setF] = useState({ name: app.name, description: app.description, interactions_url: app.interactions_url ?? "", activity_url: app.activity_url ?? "", public: app.public, listed: app.listed, tags: app.tags.join(", ") });
  const [token, setToken] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const save = () => run(() => api.patch(`/api/applications/${app.id}`, { ...f, interactions_url: f.interactions_url || null, activity_url: f.activity_url || null, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean) }), "Saved.").then(onChange);
  return <div className="stack">
    <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="Description"><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    <Field label="Icon"><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append("file", file); run(() => api.post(`/api/applications/${app.id}/icon`, fd), "Icon updated.").then(onChange); }} /></Field>
    <Field label="Interactions endpoint URL (optional)" hint="Commands are POSTed here (signed with HMAC-SHA256 of timestamp+body, headers x-send-signature / x-send-timestamp). Leave empty to receive them over the gateway instead."><input value={f.interactions_url} onChange={(e) => setF({ ...f, interactions_url: e.target.value })} placeholder="https://bot.example.com/interactions" /></Field>
    <Field label="Activity URL (optional)" hint="An https page shown in voice channels as an Activity."><input value={f.activity_url} onChange={(e) => setF({ ...f, activity_url: e.target.value })} /></Field>
    <Toggle label="Public (anyone can add it)" checked={f.public} onChange={(v) => setF({ ...f, public: v })} />
    <Toggle label="List in the App Directory" checked={f.listed} onChange={(v) => setF({ ...f, listed: v })} />
    <Field label="Tags"><input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="moderation, music" /></Field>
    <div className="row"><button className="btn primary sm" onClick={save}>Save</button>
      <button className="btn sm" onClick={async () => { if (await askConfirm({ title: "Reset the bot token?", body: "The old token stops working immediately.", confirmLabel: "Reset" })) api.post<{ token: string }>(`/api/applications/${app.id}/bot/reset-token`).then((r) => setToken(r.token)); }}><RefreshCw size={14} /> {token ? "New token" : "Get bot token"}</button>
      <button className="btn sm" onClick={() => api.post<{ interaction_secret: string }>(`/api/applications/${app.id}/reset-secret`).then((r) => setSecret(r.interaction_secret))}>Signing secret</button>
      <button className="btn sm" onClick={() => openInstall(app)}>Add to a server</button>
      <button className="btn danger sm" onClick={async () => { if (await askConfirm({ title: `Delete ${app.name}?`, body: "Its bot leaves every server.", confirmLabel: "Delete", danger: true })) run(() => api.del(`/api/applications/${app.id}`)).then(onChange); }}><Trash2 size={14} /> Delete</button></div>
    {token && <div className="secret-box"><p className="small">Bot token: copy it now, it's shown once. Never share it.</p><code>{show ? token : "•".repeat(32)}</code><button className="icon-btn sm" aria-label={show ? "Hide" : "Show"} onClick={() => setShow(!show)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button><button className="btn sm" onClick={() => { navigator.clipboard.writeText(token); toast("Copied.", "success"); }}><Copy size={14} /> Copy</button></div>}
    {secret && <div className="secret-box"><p className="small">Interaction signing secret</p><code>{secret}</code></div>}
  </div>;
}

/* ---------------------------------------------------------------------- notifications -- */
export function PushCard() {
  const [st, setSt] = useState<string>("…");
  useEffect(() => { pushState().then(setSt); }, []);
  const text: Record<string, string> = { unsupported: "This browser can't receive push notifications.", unavailable: "Push notifications aren't set up on this server yet.", denied: "Notifications are blocked for SEND in your browser settings.", off: "Off", on: "On: you'll get notified even when SEND is closed." };
  return <div className="card"><h3>Push notifications</h3><p className="muted small">{text[st] ?? "Checking…"}</p>
    {st === "off" && <button className="btn primary sm" onClick={() => enablePush().then(() => setSt("on")).catch((e) => toast(errMsg(e), "error"))}>Turn on</button>}
    {st === "on" && <div className="row"><button className="btn sm" onClick={() => api.post("/api/push/test").then(() => toast("Sent a test: close or minimise SEND to see it.", "info"))}>Send a test</button><button className="btn sm" onClick={() => disablePush().then(() => setSt("off"))}>Turn off</button></div>}
  </div>;
}

/* ----------------------------------------------------------------------- streamer mode -- */
export function StreamerCard() {
  const s = useStore((x) => ((x.me?.settings as any)?.streamer ?? EMPTY) as { on?: boolean; hide_personal?: boolean; hide_links?: boolean; no_sounds?: boolean; no_notifications?: boolean });
  const set = (p: Partial<typeof s>) => updateSettings({ streamer: { ...s, ...p } });
  return <div className="card"><h3><QrCode size={18} /> Streamer mode</h3>
    <p className="muted small">Hide personal details while you stream or share your screen.</p>
    <Toggle label="Streamer mode" checked={!!s.on} onChange={(v) => set({ on: v })} />
    <Toggle label="Hide personal information" hint="Email, connected accounts and notes." checked={s.hide_personal !== false} onChange={(v) => set({ hide_personal: v })} />
    <Toggle label="Hide invite links" checked={s.hide_links !== false} onChange={(v) => set({ hide_links: v })} />
    <Toggle label="Disable sounds" checked={!!s.no_sounds} onChange={(v) => set({ no_sounds: v })} />
    <Toggle label="Disable notifications" checked={s.no_notifications !== false} onChange={(v) => set({ no_notifications: v })} />
  </div>;
}
/** Applies streamer mode to the page (CSS hooks) — call once at start-up. */
export function useStreamerMode() {
  const s = useStore((x) => (x.me?.settings as any)?.streamer as { on?: boolean; hide_personal?: boolean; hide_links?: boolean } | undefined);
  useEffect(() => {
    const h = document.documentElement;
    if (s?.on) { h.dataset.streamer = "1"; if (s.hide_personal !== false) h.dataset.streamerPersonal = "1"; else delete h.dataset.streamerPersonal; if (s.hide_links !== false) h.dataset.streamerLinks = "1"; else delete h.dataset.streamerLinks; }
    else { delete h.dataset.streamer; delete h.dataset.streamerPersonal; delete h.dataset.streamerLinks; }
  }, [s?.on, s?.hide_personal, s?.hide_links]);
}
