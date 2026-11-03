// "Sign out of devices": the person's signed-in devices with the option to sign out one, all others, or everywhere.
// Shared by SK Factory (Profile), Kortana (Settings → Devices) and TROTAN (Account). Styles: .devices in styles.css / trotan.css.
import { useCallback, useEffect, useState } from "react";
import type { Backend, DeviceSession } from "../lib/backend";
import { locale, t } from "../lib/i18n";

/** Friendly device name from a browser's user-agent string. */
export function deviceName(ua: string | null): string {
  if (!ua) return t("Unknown device");
  const os = /Windows/.test(ua) ? "Windows" : /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  const app = /sk-suite\//i.test(ua) || /Electron\//.test(ua) ? "SK Suite" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [app, os].filter(Boolean).join(" · ") || t("Unknown device");
}
const when = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 120) return t("active now"); if (s < 3600) return t("{n} min ago", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.round(s / 3600) });
  return new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
};

export function Devices({ backend, onSignedOutHere }: { backend: Backend; onSignedOutHere: () => void }) {
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(async () => { try { setErr(null); setList(await backend.listSessions()); } catch (e) { setErr((e as Error).message); setList([]); } }, [backend]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key); setDone(null);
    try { await fn(); setDone(msg); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const others = (list ?? []).filter((d) => !d.current);
  return (
    <div className="devices" data-testid="devices">
      <div className="devices-head"><b>{t("Sign out of devices")}</b><small>{t("Where you are signed in. Signing a device out takes effect within an hour at most.")}</small></div>
      {list === null ? <p className="devices-note">{t("Loading…")}</p> : (
        <ul className="devices-list">
          {list.map((d) => (
            <li key={d.id} className={d.current ? "current" : ""} data-testid="device">
              <span><b>{deviceName(d.user_agent)}</b><small>{d.current ? t("This device") : when(d.last_active)}{d.ip ? ` · ${d.ip}` : ""} · {t("signed in {d}", { d: new Date(d.created_at).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) })}</small></span>
              {d.current ? <em>{t("This device")}</em> : <button type="button" className="dev-btn" disabled={!!busy} onClick={() => run(d.id, () => backend.endSession(d.id), t("Device signed out"))}>{busy === d.id ? "…" : t("Sign out")}</button>}
            </li>
          ))}
          {!list.length && <li className="devices-note">{t("No other devices")}</li>}
        </ul>
      )}
      <div className="devices-acts">
        <button type="button" className="dev-btn" disabled={!!busy || !others.length} data-testid="signout-others"
          onClick={() => window.confirm(t("Sign out of all other devices? This device stays signed in.")) && run("others", () => backend.signOutScope("others"), t("Signed out of all other devices"))}>{t("Sign out of all other devices")}</button>
        <button type="button" className="dev-btn danger" disabled={!!busy} data-testid="signout-everywhere"
          onClick={async () => { if (!window.confirm(t("Sign out everywhere, including this device?"))) return; setBusy("all"); try { await backend.signOutScope("global"); } catch (e) { setErr((e as Error).message); setBusy(null); return; } onSignedOutHere(); }}>{t("Sign out everywhere")}</button>
      </div>
      {done && <p className="devices-ok" role="status">{done}</p>}
      {err && <p className="devices-err" role="alert">{err}</p>}
    </div>
  );
}
