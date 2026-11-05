import { inAndroidApp } from "../mobile.ts";
import { KeybindsTab } from "./Keybinds.tsx";
import { updateSettings as saveSettings } from "../actions.ts";
import { askConfirm, askText } from "./overlay.tsx";
import { previewMode } from "../preview-mode.ts";
import { Range } from "./Range.tsx";
import { Select } from "./Select.tsx";
import { DmKeySettings } from "./DmPrivacy.tsx";
import { ScrollArea } from "./ScrollArea.tsx";
import { EffectsGallery } from "../appearance/EffectsGallery.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { AUDIO_BITRATES_KBPS, AUDIO_PRESETS, BRAND, STREAM_FPS, STREAM_HEIGHTS, type SessionInfo } from "@syndo/shared";
import { api, errMsg, upload } from "../api.ts";
import { logout, updateSettings } from "../actions.ts";
import { displayName, toast, useStore } from "../store.ts";
import { applyPreset, captureCapabilities } from "../voice/settings.ts";
import { setMode, switchDevice, updateVoiceSettings, useVoice } from "../voice/session.ts";
import { Avatar, Field, Modal, Toggle } from "./ui.tsx";
import { PRESETS, type A11yPrefs } from "@syndo/shared";
import { desktop, globalPttError, setDesktopMaterial, type DesktopUpdate, type DesktopSettings, applyDesktopUpdate } from "../desktop.ts";
import { ProfileEditor } from "../appearance/ProfileEditor.tsx";
import { openStudio } from "../appearance/Studio.tsx";
import { resetAppearance, setSafeMode, updateGlobal, useAppearance } from "../appearance/store.ts";

const TABS = [...(desktop ? [["desktop", "Desktop app"]] as const : []), ["account", "My account"], ["profile", "Profile"], ["effects", "Profile effects"], ["privacy", "Privacy & safety"], ["appearance", "Appearance"], ["accessibility", "Accessibility"], ["voice", "Voice & video"], ["keybinds", "Keybinds"], ["notifications", "Notifications"], ["advanced", "Advanced"], ["about", `About ${BRAND.name}`]] as const;

export function UserSettings({ tab: initial, onClose }: { tab?: string; onClose: () => void }) {
  const [tab, setTab] = useState(initial ?? "account");
  // Phones show the section list first, then the chosen section full-screen with a back button.
  const [pane, setPane] = useState<"list" | "detail">(initial ? "detail" : "list");
  return (
    <Modal title="User settings" onClose={onClose} wide>
      <div className="settings" data-pane={pane}>
        <ScrollArea className="settings-scroll-nav" viewportClassName="settings-nav" aria-label="Settings sections" role="tablist" aria-orientation="vertical">
          {TABS.map(([id, label]) => <button key={id} role="tab" data-tab={id} aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setPane("detail"); }}>{label}</button>)}
          <hr /><button className="danger" onClick={() => { onClose(); logout(); }}>Sign out</button>
        </ScrollArea>
        <ScrollArea key={tab} className="settings-scroll-body" viewportClassName="settings-body" role="tabpanel">
          <button className="settings-back m-only" onClick={() => setPane("list")}>‹ All settings</button>
          {tab === "account" && <Account />}
          {tab === "profile" && <ProfileEditor />}
          {tab === "effects" && <EffectsGallery />}
          {tab === "privacy" && <Privacy />}
          {tab === "appearance" && <AppearanceTab onClose={onClose} />}
          {tab === "accessibility" && <AccessibilityTab />}
          {tab === "voice" && <VoiceTab />}
          {tab === "keybinds" && <KeybindsTab />}
          {tab === "advanced" && <AdvancedTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "about" && <About />}
          {tab === "desktop" && <DesktopTab />}
        </ScrollArea>
      </div>
    </Modal>
  );
}

const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); return true; } catch (e) { toast(errMsg(e), "error"); return false; } };

function Account() {
  const me = useStore((s) => s.me!);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [mfa, setMfa] = useState<{ secret: string; url: string } | null>(null);
  const [code, setCode] = useState(""); const [codes, setCodes] = useState<string[] | null>(null);
  const load = () => api.get<SessionInfo[]>("/api/auth/sessions").then(setSessions).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <div className="stack">
      <h2>My account</h2>
      <div className="card row"><Avatar user={me} size={56} /><div><strong>{displayName(me)}</strong><div className="muted">@{me.username} · {me.email}</div>
</div></div>
      <Field label="Username"><div className="add-row"><input defaultValue={me.username} id="uname" maxLength={32} /><button className="btn" onClick={() => run(() => api.patch("/api/users/@me", { username: (document.getElementById("uname") as HTMLInputElement).value }), "Username updated.")}>Save</button></div></Field>
      <h3>Password</h3>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); run(() => api.post("/api/auth/change-password", pw), "Password changed. Other devices were signed out.").then((ok) => ok && setPw({ current: "", next: "" })); }}>
        <input type="password" placeholder="Current password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} aria-label="Current password" />
        <input type="password" placeholder="New password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} aria-label="New password" />
        <button className="btn">Change password</button>
      </form>
      <h3>Two-factor authentication</h3>
      {me.mfa_enabled ? (
        <div className="row wrap"><span className="ok-text">On</span>
          <input placeholder="Code to confirm" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Authenticator code" />
          <button className="btn" onClick={() => run(async () => setCodes((await api.post("/api/auth/mfa/recovery-codes", { code })).recovery_codes))}>New recovery codes</button>
          <button className="btn danger" onClick={() => run(() => api.post("/api/auth/mfa/disable", { code }), "Two-factor turned off.")}>Turn off</button></div>
      ) : mfa ? (
        <div className="stack">
          <p className="small">Add this key to an authenticator app (or open the link on your phone), then enter the 6-digit code.</p>
          <code className="selectable">{mfa.secret}</code><a href={mfa.url} className="small">Open in authenticator</a>
          <div className="add-row"><input placeholder="123456" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" />
            <button className="btn primary" onClick={() => run(async () => { setCodes((await api.post("/api/auth/mfa/enable", { code })).recovery_codes); setMfa(null); })}>Enable</button></div>
        </div>
      ) : <button className="btn" onClick={() => run(async () => { const r = await api.post("/api/auth/mfa/setup"); setMfa({ secret: r.secret, url: r.otpauth_url }); })}>Set up two-factor</button>}
      {codes && <div className="card"><strong>Recovery codes — save these now.</strong><p className="small muted">Each works once if you lose your authenticator.</p><pre className="selectable">{codes.join("\n")}</pre></div>}
      <h3>Devices & sessions</h3>
      <ul className="sessions">
        {sessions.map((s) => (
          <li key={s.id}><div><strong>{describeUA(s.user_agent)}</strong>{s.current && <span className="tag">This device</span>}<div className="muted small">{s.ip ?? "unknown IP"} · last active {new Date(s.last_used_at).toLocaleString()}</div></div>
            {!s.current && <button className="btn sm" onClick={() => run(() => api.del(`/api/auth/sessions/${s.id}`)).then(load)}>Sign out</button>}</li>
        ))}
      </ul>
      {sessions.length > 1 && <button className="btn" onClick={() => run(() => api.post("/api/auth/sessions/revoke-others"), "Signed out of all other devices.").then(load)}>Sign out all other devices</button>}
      <h3>Your data</h3>
      <div className="row wrap">
        <a className="btn" href="/api/users/@me/export" download>Download my data (JSON)</a>
        <button className="btn danger" onClick={async () => { const p = await askText({ title: "Delete your account?", body: "This permanently deletes your account. Messages remain but show as 'Deleted user'.", label: "Password", password: true, confirmLabel: "Delete account", danger: true }); if (p) run(() => api.del("/api/users/@me", { password: p })).then((ok) => { if (ok) logout(); }); }}>Delete account</button>
      </div>
    </div>
  );
}
const describeUA = (ua: string | null) => { if (!ua) return "Unknown device"; const b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "App"; const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "device"; return `${b} on ${os}`; };

/** Quick appearance controls. They save (debounced) to the same synced preferences Studio edits. */
function AppearanceTab({ onClose }: { onClose: () => void }) {
  const g = useAppearance((s) => s.global.data);
  const saveState = useAppearance((s) => s.saveState);
  return (
    <div className="stack">
      <h2>Appearance</h2>
      <div className="card row wrap">
        <div className="grow"><strong>SEND Studio</strong><p className="muted small">Themes, panel transparency, backgrounds, layout, per-server and per-conversation looks, profile effects, presets and import/export.</p></div>
        <button className="btn primary" onClick={() => { onClose(); openStudio("gallery"); }}>Open SEND Studio</button>
      </div>
      <Field label="Theme"><Select value={g.themeId} onChange={(e) => updateGlobal((x) => ({ ...x, themeId: e.target.value }))}>{PRESETS.map((p) => <option key={p.meta.id} value={p.meta.id}>{p.meta.name}</option>)}{!g.themeId.startsWith("syndo-") && <option value={g.themeId}>My preset</option>}</Select></Field>
      <Field label="Accent colour"><input type="color" value={(g.overrides.colors as any)?.accent ?? "#3D6BFF"} onChange={(e) => updateGlobal((x) => ({ ...x, overrides: { ...x.overrides, colors: { ...(x.overrides.colors ?? {}), accent: e.target.value.toUpperCase() } } }))} /></Field>
      <Toggle label="Follow system light/dark" checked={g.followSystem} onChange={(v) => updateGlobal((x) => ({ ...x, followSystem: v }))} />
      <p className="muted small" role="status">{saveState === "pending" || saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save — check your connection." : "Saved and synced to your devices."}</p>
    </div>
  );
}

function AccessibilityTab() {
  const a = useAppearance((s) => s.global.data.a11y);
  const set = (p: Partial<A11yPrefs>) => updateGlobal((x) => ({ ...x, a11y: { ...x.a11y, ...p } }));
  return (
    <div className="stack">
      <h2>Accessibility</h2>
      <Field label="Reduced motion"><Select value={a.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.value as A11yPrefs["reducedMotion"] })}><option value="system">Follow my system setting</option><option value="on">Always reduce motion</option><option value="off">Allow motion</option></Select></Field>
      <Toggle label="High contrast" checked={a.highContrast} onChange={(v) => set({ highContrast: v })} />
      <Toggle label="Keep text readable" hint="Fixes low-contrast theme text automatically." checked={a.minContrast} onChange={(v) => set({ minContrast: v })} />
      <Toggle label="Readable overlay for busy wallpapers" checked={a.readableOverlay} onChange={(v) => set({ readableOverlay: v })} />
      <Toggle label="Disable animated backgrounds" checked={a.disableAnimatedBackgrounds} onChange={(v) => set({ disableAnimatedBackgrounds: v })} />
      <Toggle label="Disable profile effects" checked={a.disableProfileEffects} onChange={(v) => set({ disableProfileEffects: v })} />
      <Toggle label="Hide other people's cosmetics" checked={a.disableOthersCosmetics} onChange={(v) => set({ disableOthersCosmetics: v })} />
      <Field label="Blur"><Select value={a.blur} onChange={(e) => set({ blur: e.target.value as A11yPrefs["blur"] })}><option value="full">Full</option><option value="reduced">Reduced</option><option value="off">Off</option></Select></Field>
      <Toggle label="Low-power mode" checked={a.lowPower} onChange={(v) => set({ lowPower: v })} />
      <h3>Keyboard</h3>
      <ul className="small keys">
        <li><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> move between areas; a skip link jumps to messages.</li>
        <li><kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> new line · <kbd>Esc</kbd> cancel or close.</li>
        <li><kbd>Ctrl+Shift+↑/↓</kbd> (or <kbd>Ctrl+Shift+←/→</kbd> in the horizontal bar) on a focused server icon reorders servers.</li>
        <li><kbd>Ctrl+/</kbd> all shortcuts (customise them in Keybinds) · <kbd>Ctrl+Shift+Alt+R</kbd> safe appearance mode.</li>
      </ul>
      <div className="row wrap"><button className="btn" onClick={() => setSafeMode(true)}>Pause my appearance (safe mode)</button><button className="btn danger" onClick={async () => (await askConfirm({ title: "Reset all appearance?", body: "Global, server and conversation appearance return to the default.", confirmLabel: "Reset", danger: true })) && resetAppearance("all")}>Reset appearance</button></div>
    </div>
  );
}

function Privacy() {
  const me = useStore((s) => s.me!);
  const save = (p: Partial<typeof me.privacy>) => run(() => api.patch("/api/users/@me", { privacy: p }));
  return (
    <div className="stack">
      <h2>Privacy & safety</h2><DmKeySettings />
      <Field label="Who can send you friend requests"><Select value={me.privacy.friend_requests} onChange={(e) => save({ friend_requests: e.target.value as any })}>
        <option value="everyone">Everyone</option><option value="server_members">People in my servers and friends of friends</option><option value="friends_of_friends">Friends of friends</option><option value="nobody">Nobody</option></Select></Field>
      <Toggle label="Allow direct messages from server members" hint="Friends can always message you. Blocked people never can." checked={me.privacy.dms_from_server_members} onChange={(v) => save({ dms_from_server_members: v })} />
      <Toggle label="Show mutual servers and friends on my profile" checked={me.privacy.show_mutuals} onChange={(v) => save({ show_mutuals: v })} />
      <p className="muted small">Blocking someone hides their friend requests, stops new DMs and calls between you, and keeps them out of group conversations you're in. They aren't told.</p>
    </div>
  );
}

function VoiceTab() {
  const s = useVoice((v) => v.settings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState<number | null>(null);
  const caps = captureCapabilities();
  const limits = useStore((x) => x.limits);
  useEffect(() => { navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {}); }, []);
  const test = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: s.inputDeviceId !== "default" ? s.inputDeviceId : undefined, echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl } });
      setDevices(await navigator.mediaDevices.enumerateDevices());
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(st).connect(an);
      const buf = new Uint8Array(an.fftSize); const end = Date.now() + 8000;
      const tick = () => { an.getByteTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v - 128)); setLevel(Math.min(1, (p / 128) * s.inputGain)); if (Date.now() < end) requestAnimationFrame(tick); else { st.getTracks().forEach((t) => t.stop()); ctx.close(); setLevel(null); } };
      tick();
    } catch (e) { toast((await import("../voice/session.ts")).deviceError(e), "error"); }
  };
  const list = (kind: MediaDeviceKind) => devices.filter((d) => d.kind === kind);
  const maxKbps = limits?.max_voice_bitrate_kbps ?? 510;
  return (
    <div className="stack">
      <h2>Voice & video</h2>
      {!limits?.media_enabled && <p className="warn-text">{previewMode ? "Calls connect in the live app. This preview uses sample data." : "Calling is temporarily unavailable. Your voice settings still save."}</p>}
      <div className="row wrap">
        <Field label="Microphone"><Select value={s.inputDeviceId} onChange={(e) => switchDevice("audioinput", e.target.value)}><option value="default">Default</option>{list("audioinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}</Select></Field>
        <Field label="Speaker"><Select value={s.outputDeviceId} disabled={!caps.setSinkId} onChange={(e) => switchDevice("audiooutput", e.target.value)}><option value="default">Default</option>{list("audiooutput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>)}</Select></Field>
        <Field label="Camera"><Select value={s.videoDeviceId} onChange={(e) => switchDevice("videoinput", e.target.value)}><option value="">Default</option>{list("videoinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>)}</Select></Field>
      </div>
      {!caps.setSinkId && <p className="muted small">This browser can't choose a speaker; it uses the system default.</p>}
      <Field label={`Input gain — ${Math.round(s.inputGain * 100)}%`}><Range min={0} max={2} step={0.05} value={s.inputGain} onChange={(e) => updateVoiceSettings({ inputGain: +e.target.value })} /></Field>
      <div className="row"><button className="btn sm" onClick={test} disabled={level !== null}>Mic test</button>{level !== null && <meter min={0} max={1} value={level} aria-label="Input level" />}</div>
      <Field label="Input mode"><Select value={s.mode} onChange={(e) => setMode(e.target.value as any)}><option value="vad">Voice activity</option><option value="ptt">Push to talk</option></Select></Field>
      {s.mode === "ptt" && <Field label="Push-to-talk key" hint={desktop?.capabilities.globalPtt ? (globalPttError ?? "Works everywhere, even when SEND is in the background (desktop app). Mouse buttons 4/5 work too.") : desktop ? "Works while this window is focused." : "Works while this window is focused. The Windows desktop app makes it work everywhere."}><input readOnly value={s.pttKey} onKeyDown={(e) => { e.preventDefault(); updateVoiceSettings({ pttKey: e.code }); }} onMouseDown={(e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); updateVoiceSettings({ pttKey: e.button === 3 ? "Mouse4" : "Mouse5" }); } }} aria-label="Press a key to set push-to-talk" /></Field>}
      <h3>Audio quality — free for everyone</h3>
      <Field label="Preset"><Select value={s.presetId} onChange={(e) => e.target.value !== "custom" && updateVoiceSettings(applyPreset(s, e.target.value))}>{AUDIO_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}<option value="custom">Custom</option></Select></Field>
      <Field label="Target Opus bitrate" hint="A request to the encoder. Opus is variable-rate: silence and simple sounds use less, and congestion control can lower it. Diagnostics in a call show the measured rate.">
        <Select value={Math.round(s.bitrate / 1000)} onChange={(e) => updateVoiceSettings({ bitrate: +e.target.value * 1000, presetId: "custom" })}>
          {AUDIO_BITRATES_KBPS.filter((k) => k <= maxKbps).map((k) => <option key={k} value={k}>{k} kbps</option>)}
        </Select>
      </Field>
      <Toggle label="Stereo (music mode)" hint="Needs a stereo source and turn off echo cancellation for true stereo; the receiver's device must play stereo." checked={s.stereo} onChange={(v) => updateVoiceSettings({ stereo: v, presetId: "custom" })} />
      <Toggle label="Echo cancellation" checked={s.echoCancellation} onChange={(v) => updateVoiceSettings({ echoCancellation: v, presetId: "custom" })} />
      <div className="card stack"><strong>Noise suppression</strong><p className="muted small">Built-in processing runs locally. For Krisp, choose its virtual microphone below after installing the Krisp desktop app. Embedded Krisp SDK processing requires a separate licence.</p><button className="btn" onClick={() => { const device = devices.find(d => d.kind === "audioinput" && /krisp/i.test(d.label)); if (device) switchDevice("audioinput", device.deviceId); else toast("Krisp microphone not found. Start Krisp, allow microphone access, then refresh your devices.", "info"); }}>Use Krisp microphone</button></div>
      <Toggle label="Noise suppression" checked={s.noiseSuppression} onChange={(v) => updateVoiceSettings({ noiseSuppression: v, presetId: "custom" })} />
      <Toggle label="Automatic gain control" checked={s.autoGainControl} onChange={(v) => updateVoiceSettings({ autoGainControl: v, presetId: "custom" })} />
      <Toggle label="Save bandwidth in silence (DTX)" hint="Good for speech, bad for quiet music." checked={s.dtx} onChange={(v) => updateVoiceSettings({ dtx: v, presetId: "custom" })} />
      <Toggle label="Redundant audio (RED)" hint="Survives packet loss better; roughly doubles audio traffic." checked={s.red} onChange={(v) => updateVoiceSettings({ red: v, presetId: "custom" })} />
      <h3>Screen sharing defaults</h3>
      <div className="row wrap">
        <Field label="Resolution"><Select value={String(s.stream.height)} onChange={(e) => updateVoiceSettings({ stream: { ...s.stream, height: e.target.value === "source" ? "source" : +e.target.value } })}>
          {STREAM_HEIGHTS.filter((h) => h <= (limits?.max_stream_height ?? 2160)).map((h) => <option key={h} value={h}>{h === 2160 ? "2160p (4K)" : `${h}p`}</option>)}<option value="source">Source (native size)</option></Select></Field>
        <Field label="Frame rate"><Select value={s.stream.fps} onChange={(e) => updateVoiceSettings({ stream: { ...s.stream, fps: +e.target.value as any } })}>{STREAM_FPS.filter((f) => f <= (limits?.max_stream_fps ?? 60)).map((f) => <option key={f} value={f}>{f} fps</option>)}</Select></Field>
        <Field label="Optimise for"><Select value={s.stream.contentHint} onChange={(e) => updateVoiceSettings({ stream: { ...s.stream, contentHint: e.target.value as any } })}><option value="detail">Readable text (keeps resolution)</option><option value="motion">Motion (keeps frame rate)</option></Select></Field>
        <Field label="Bitrate"><Select value={s.stream.bitrate} onChange={(e) => updateVoiceSettings({ stream: { ...s.stream, bitrate: +e.target.value } })}><option value={0}>Automatic</option>{[2500, 4000, 6000, 8000, 12000, 16000, 20000].filter((k) => k <= (limits?.max_stream_bitrate_kbps ?? 20000)).map((k) => <option key={k} value={k * 1000}>{k / 1000} Mbps</option>)}</Select></Field>
        <Field label="Codec"><Select value={s.stream.codec} onChange={(e) => updateVoiceSettings({ stream: { ...s.stream, codec: e.target.value as any } })}><option value="auto">Automatic</option><option value="av1">AV1</option><option value="vp9">VP9</option><option value="h264">H.264</option><option value="vp8">VP8</option></Select></Field>
      </div>
      <Toggle label="Share audio with my screen" checked={s.stream.audio} onChange={(v) => updateVoiceSettings({ stream: { ...s.stream, audio: v } })} />
      <h3>What this browser can do</h3>
      <table className="caps"><tbody>
        <tr><td>Screen sharing</td><td>{caps.canShare ? "Yes" : "No (mobile browsers can't share screens)"}</td></tr>
        <tr><td>Tab audio</td><td>{caps.tabAudio ? "Yes" : "No"}</td></tr>
        <tr><td>Whole-system audio</td><td>{caps.systemAudio ? "Yes (Windows, Chromium)" : "No"}</td></tr>
        <tr><td>Single app window audio</td><td>No — not supported by browsers; the desktop app shares whole-system audio on Windows</td></tr>
        <tr><td>Desktop app</td><td>{desktop ? `Yes (v${desktop.version})` : "No — running in a browser"}</td></tr>
        <tr><td>Choose speaker</td><td>{caps.setSinkId ? "Yes" : "No"}</td></tr>
      </tbody></table>
      {(caps.linuxNote || caps.macNote) && <p className="muted small">{caps.linuxNote ?? caps.macNote}</p>}
      <p className="muted small">"Source" requests the captured surface at its native size. It's still compressed video, and very large sources are limited by your encoder, upload speed and viewers' devices — the in-call diagnostics show what was actually sent.</p>
    </div>
  );
}

function DesktopTab() {
  const [u, setU] = useState<DesktopUpdate | null>(null);
  const [cfg, setCfg] = useState<DesktopSettings | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.getUpdateStatus().then(setU); desktop.getSettings().then(setCfg);
    return desktop.onUpdateStatus(setU);
  }, []);
  if (!desktop) return null;
  const d = desktop;
  const label = !u ? "" : { idle: "Not checked yet", checking: "Checking…", available: d.downloadUpdate ? `Update ${u.version} available` : `Update ${u.version} found — downloading`, downloading: `Downloading ${u.version ?? ""} — ${u.percent ?? 0}%`, ready: `Update ${u.version} ready`, none: "You're up to date", error: `Update check failed: ${u.message ?? ""}`, disabled: u.message ?? "Updates unavailable in this build" }[u.state];
  return (
    <div className="stack">
      <h2>Desktop app</h2>
      <p className="muted">SEND for {desktop.platform === "win32" ? "Windows" : desktop.platform} · version {desktop.version}. The interface updates automatically whenever the SEND web app is updated; the app itself updates from the SEND update feed.</p>
      <div className="card row wrap"><span className="grow" role="status">{label}</span>
        {u?.state === "ready" ? <button className="btn primary" onClick={() => d.restartToUpdate()}>Restart to update</button>
          : u?.state === "available" && d.downloadUpdate ? <button className="btn primary" onClick={() => applyDesktopUpdate(u)}>Download and install</button>
          : <button className="btn" disabled={u?.state === "checking" || u?.state === "downloading" || u?.state === "disabled"} onClick={() => d.checkForUpdates().then(setU)}>Check for updates</button>}</div>
      {cfg && <Toggle label="Keep running in the tray when closed" hint="Calls and notifications keep working." checked={cfg.closeToTray} onChange={(v) => { d.setCloseToTray(v); setCfg({ ...cfg, closeToTray: v }); }} />}
      {cfg && d.setPerformance && <>
        <h3>Performance</h3>
        <Toggle label="Hardware acceleration" hint="Use your graphics card for rendering. Restart SEND to apply changes." checked={cfg.hardwareAcceleration} onChange={async v => { const r = await d.setPerformance!({ hardwareAcceleration: v }); if (r.ok) setCfg({ ...cfg, hardwareAcceleration: v, restartRequired: r.restartRequired }); }} />
        <Toggle label="Reduce background activity" hint="Let animations and timers sleep while SEND is hidden. Calls remain active." checked={cfg.reduceBackgroundWork} onChange={async v => { const r = await d.setPerformance!({ reduceBackgroundWork: v }); if (r.ok) setCfg({ ...cfg, reduceBackgroundWork: v }); }} />
        {cfg.restartRequired && <div className="row"><span className="muted small">Restart to apply your graphics setting.</span><button className="btn" onClick={() => d.restart?.()}>Restart SEND</button></div>}
      </>}
      {cfg && desktop.platform === "win32" && d.setLaunchOnStartup && <Toggle label="Open SEND when Windows starts" checked={cfg.launchOnStartup} onChange={async v => { const r = await d.setLaunchOnStartup!(v); if (r.ok) setCfg({ ...cfg, launchOnStartup: v }); }} />}
      {d.refreshInterface && <div className="row"><button className="btn" onClick={() => d.refreshInterface?.()}>Refresh to latest interface</button><span className="muted small">Load the latest Cloudflare update.</span></div>}
      {desktop.capabilities.windowMaterial ? (
        <Field label="Window material (Windows 11)" hint="Lets the desktop show through the app background. Panels keep the transparency you set in SEND Studio.">
          <Select value={cfg?.material ?? "none"} onChange={async (e) => { const m = e.target.value as "none" | "mica" | "acrylic"; if (await setDesktopMaterial(m) && cfg) setCfg({ ...cfg, material: m }); }}>
            <option value="none">None</option><option value="mica">Mica</option><option value="acrylic">Acrylic</option></Select></Field>
      ) : <p className="muted small">See-through window materials need Windows 11 (22H2 or newer).</p>}
      <Field label="Server"><div className="row"><code>{cfg?.serverUrl}</code><button className="btn sm" onClick={async () => (await askConfirm({ title: "Switch server?", body: "You'll need to sign in on the other SEND server." })) && d.changeServer()}>Change server</button></div></Field>
      <ul className="small keys">
        <li>Push-to-talk works globally — set it in Voice &amp; video.</li>
        <li>Screen sharing can include whole-system audio{desktop.capabilities.systemAudio ? "" : " (Windows only)"}.</li>
        <li><code>syndo://invite/CODE</code> links open invites in the app.</li>
      </ul>
    </div>
  );
}

function NotificationsTab() {
  const n = (useStore((s) => (s.me?.settings as any)?.notifications) ?? {}) as { desktop?: boolean; sounds?: boolean; quietStart?: string; quietEnd?: string };
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const set = (p: Partial<typeof n>) => updateSettings({ notifications: { ...n, ...p } });
  return (
    <div className="stack">
      <h2>Notifications</h2>
      <Toggle label="Desktop notifications" hint={perm === "denied" ? "Blocked by the browser — allow notifications for this site in its settings." : "Mentions, DMs and calls while this tab is in the background."} checked={!!n.desktop && perm === "granted"} disabled={perm === "denied"}
        onChange={async (v) => { if (v && perm !== "granted") { const r = await Notification.requestPermission(); setPerm(r); if (r !== "granted") return; } set({ desktop: v }); }} />
      <Toggle label="Notification sounds" checked={n.sounds !== false} onChange={(v) => set({ sounds: v })} />
      <div className="row wrap"><Field label="Quiet hours from"><input type="time" value={n.quietStart ?? ""} onChange={(e) => set({ quietStart: e.target.value })} /></Field><Field label="until"><input type="time" value={n.quietEnd ?? ""} onChange={(e) => set({ quietEnd: e.target.value })} /></Field></div>
      <p className="muted small">Do Not Disturb status also silences desktop notifications. Settings follow your account across devices.</p>
    </div>
  );
}

function About() {
  const limits = useStore((s) => s.limits);
  return (
    <div className="stack">
      <h2>About {BRAND.name}</h2>
      <p>{BRAND.description}</p>
      {inAndroidApp && (
        <section className="stack">
          <h3>Android app</h3>
          <p className="muted small">The app loads the latest version of {BRAND.name} automatically. Use these if something looks out of date or the server is unreachable.</p>
          <div className="row wrap">
            <a className="btn primary" href="sendapp://reload">Reload latest version</a>
            <a className="btn" href="sendapp://browser">Open in browser</a>
            <a className="btn" href="sendapp://preview">Offline preview</a>
          </div>
        </section>
      )}
      <p className="muted">There are no subscriptions, boosts or paid cosmetics. Every account gets the same limits, set by whoever runs this server based on what their hardware can handle:</p>
      {limits && <table className="caps"><tbody>
        <tr><td>Upload size</td><td>{Math.round(limits.max_upload_bytes / 1048576)} MB</td></tr>
        <tr><td>Message length</td><td>{limits.max_message_length} characters</td></tr>
        <tr><td>Servers per account</td><td>{limits.max_guilds_per_user}</td></tr>
        <tr><td>Members per server</td><td>{limits.max_members_per_guild}</td></tr>
        <tr><td>Group conversation size</td><td>{limits.max_group_dm_recipients}</td></tr>
        <tr><td>Voice bitrate up to</td><td>{limits.max_voice_bitrate_kbps} kbps</td></tr>
        <tr><td>Screen share up to</td><td>{limits.max_stream_height}p at {limits.max_stream_fps} fps, {limits.max_stream_bitrate_kbps / 1000} Mbps</td></tr>
        <tr><td>Voice & video</td><td>{limits.media_enabled ? "Available" : "Not configured on this server"}</td></tr>
      </tbody></table>}
      <p className="muted small">{BRAND.name} is an independent platform. It doesn't connect to or interoperate with other chat services.</p>
    </div>
  );
}

function AdvancedTab() {
  const dev = useStore((st) => (st.me?.settings as any)?.developer_mode === true);
  return (
    <div>
      <h2>Advanced</h2>
      <Toggle label="Developer mode" hint="Adds “Copy ID” to right-click menus for servers, channels, users and messages." checked={dev} onChange={(v) => saveSettings({ developer_mode: v })} />
    </div>
  );
}
