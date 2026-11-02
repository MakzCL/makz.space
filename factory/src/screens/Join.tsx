import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Delete, KeyRound, LogOut, Mail, User } from "lucide-react";
import { useEffect, useState } from "react";
import { FullLoader } from "../components/Loader";
import { Logo } from "../components/Logo";
import { Scene } from "../components/Scene";
import { useToast } from "../components/Toast";
import { Btn, LangSwitch } from "../components/ui";
import type { Backend, JoinInfo } from "../lib/backend";
import { t } from "../lib/i18n";
import { buzz } from "../lib/prefs";
import { ROLE_META } from "../lib/roles";

const PENDING = "skf-pending-join";
export const savePendingJoin = (code: string, pin: string) => { try { localStorage.setItem(PENDING, JSON.stringify({ code, pin })); } catch { /* ignore */ } };
export const takePendingJoin = (): { code: string; pin: string } | null => {
  try { const v = localStorage.getItem(PENDING); localStorage.removeItem(PENDING); return v ? JSON.parse(v) : null; } catch { return null; }
};

const REASON: Record<JoinInfo["reason"], string> = {
  ok: "", expired: "This invite link has expired.", revoked: "This invite link was switched off.",
  used_up: "This invite link has been used the maximum number of times.", locked: "Too many wrong PINs — this link is locked.",
  not_found: "This invite link doesn't exist.",
};

/** Number pad for the PIN — big targets for gloves. */
export function PinPad({ value, onChange, length = 8, error }: { value: string; onChange: (v: string) => void; length?: number; error?: boolean }) {
  const press = (d: string) => { buzz(6); if (value.length < length) onChange(value + d); };
  return (
    <div className="pinpad">
      <motion.div className="pin-dots" animate={error ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}>
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => <i key={i} className={i < value.length ? "on" : ""} />)}
      </motion.div>
      <div className="keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <motion.button key={d} whileTap={{ scale: 0.88 }} onClick={() => press(d)}>{d}</motion.button>)}
        <span />
        <motion.button whileTap={{ scale: 0.88 }} onClick={() => press("0")}>0</motion.button>
        <motion.button whileTap={{ scale: 0.88 }} className="del" aria-label={t("Delete")} onClick={() => { buzz(6); onChange(value.slice(0, -1)); }}><Delete size={22} /></motion.button>
      </div>
    </div>
  );
}

export function Join({ backend, code, onIn, onCancel }: { backend: Backend; code: string; onIn: () => void; onCancel: () => void }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [step, setStep] = useState<"pin" | "account" | "email">("pin");
  const [pin, setPin] = useState("");
  const [bad, setBad] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", email: "", pw: "" });
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { backend.joinInfo(code).then(setInfo).catch(() => setInfo({ valid: false, reason: "not_found", role: "operator", inviter: "" })); }, [backend, code]);

  async function checkPin() {
    setBusy(true);
    const ok = await backend.checkJoinPin(code, pin).catch(() => false);
    setBusy(false);
    if (ok) { buzz(14); setStep("account"); }
    else { buzz([30, 40, 30]); setBad((b) => b + 1); setPin(""); backend.joinInfo(code).then(setInfo).catch(() => {}); }
  }

  async function create() {
    setErr(null);
    if (f.pw.length < 8) { setErr(t("Use at least 8 characters for your password")); return; }
    setBusy(true);
    try {
      const r = await backend.signUp(f.email.trim(), f.pw, f.name.trim());
      if (r.needsConfirm) { savePendingJoin(code, pin); setStep("email"); return; }
      await backend.redeemJoin(code, pin);
      toast(t("Welcome to the team"), "ok");
      onIn();
    } catch (e) { setErr(t(e instanceof Error ? e.message : "Something went wrong")); }
    finally { setBusy(false); }
  }

  if (!info) return <FullLoader label={t("Opening invite…")} />;
  return (
    <div className="login join">
      <div className="login-top"><button className="link" onClick={onCancel}>{t("Back to sign in")}</button><LangSwitch /></div>
      <Scene kind="town" height={200}>
        <div className="login-brand"><Logo size={34} /><div><b>{t("You're invited")}</b><small>Skalarki Electronics Ltd</small></div></div>
      </Scene>
      <AnimatePresence mode="wait">
        {!info.valid ? (
          <motion.div key="bad" className="card center-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <b>{t(REASON[info.reason])}</b>
            <p className="muted">{t("Ask the boss for a new link.")}</p>
            <Btn tone="soft" wide onClick={onCancel}>{t("Back to sign in")}</Btn>
          </motion.div>
        ) : step === "pin" ? (
          <motion.div key="pin" className="card center-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30 }}>
            <p className="muted">{info.inviter ? t("{name} invited you to join as", { name: info.inviter }) : t("You're invited to join as")}</p>
            <b className="join-role">{t(ROLE_META[info.role].label)}</b>
            <p>{t("Enter the PIN you were given")}</p>
            <PinPad value={pin} onChange={setPin} error={bad > 0 && pin === ""} />
            {bad > 0 && <p className="err">{t("Wrong PIN — try again")}</p>}
            <Btn tone="primary" wide busy={busy} disabled={pin.length < 4} icon={<ArrowRight size={18} />} onClick={checkPin}>{t("Continue")}</Btn>
          </motion.div>
        ) : step === "account" ? (
          <motion.form key="acc" className="card login-card" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} onSubmit={(e) => { e.preventDefault(); create(); }}>
            <b className="form-title">{t("Create your account")}</b>
            <label className="input-ic"><User size={18} /><input required placeholder={t("Full name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
            <label className="input-ic"><Mail size={18} /><input required type="email" placeholder={t("Email")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" inputMode="email" /></label>
            <label className="input-ic"><KeyRound size={18} /><input required type="password" placeholder={t("Password (8+ characters)")} value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} autoComplete="new-password" /></label>
            {err && <p className="err">{err}</p>}
            <Btn type="submit" tone="primary" wide busy={busy} icon={<ArrowRight size={18} />}>{t("Join")}</Btn>
          </motion.form>
        ) : (
          <motion.div key="mail" className="card center-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <Mail size={34} />
            <b>{t("Check your email")}</b>
            <p className="muted">{t("Confirm your address, then sign in. Your invite is saved on this phone and applied automatically.")}</p>
            <Btn tone="primary" wide onClick={onCancel}>{t("Go to sign in")}</Btn>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Signed in, but not approved yet. */
export function Pending({ backend, name, onSignOut, onActive, code: initialCode }: { backend: Backend; name: string; onSignOut: () => void; onActive: () => void; code?: string | null }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const p = takePendingJoin();
    if (p) backend.redeemJoin(p.code, p.pin).then(onActive).catch((e) => setErr(t((e as Error).message)));
  }, [backend, onActive]);
  const clean = (v: string) => (v.match(/join=([A-Za-z0-9]+)/)?.[1] ?? v).trim().toUpperCase();
  return (
    <div className="login join">
      <div className="login-top"><span /><LangSwitch /></div>
      <Scene kind="clock" height={190}>
        <div className="login-brand"><Logo size={34} /><div><b>{t("Almost there, {name}", { name: name.split(" ")[0]! })}</b><small>{t("Waiting for approval")}</small></div></div>
      </Scene>
      <div className="card center-card">
        <p className="muted">{t("Your account was created without an invite link. A manager or the office needs to approve it — or enter an invite link and PIN below.")}</p>
        <input className="code-input" placeholder={t("Invite link or code")} value={code} onChange={(e) => setCode(clean(e.target.value))} />
        <PinPad value={pin} onChange={setPin} error={!!err && pin === ""} />
        {err && <p className="err">{err}</p>}
        <Btn tone="primary" wide busy={busy} disabled={!code || pin.length < 4} onClick={async () => {
          setBusy(true); setErr(null);
          try { await backend.redeemJoin(code, pin); onActive(); } catch (e) { setErr(t((e as Error).message)); setPin(""); } finally { setBusy(false); }
        }}>{t("Join with invite")}</Btn>
        <Btn tone="ghost" wide icon={<LogOut size={18} />} onClick={onSignOut}>{t("Sign out")}</Btn>
      </div>
    </div>
  );
}
