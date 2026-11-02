import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, KeyRound, Mail, User } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Logo } from "../components/Logo";
import { Scene } from "../components/Scene";
import { useToast } from "../components/Toast";
import { Btn, LangSwitch, Segmented } from "../components/ui";
import type { Backend } from "../lib/backend";
import { t } from "../lib/i18n";

export function Login({ backend, onIn, brand }: { backend: Backend; onIn: () => void; brand?: { name: string; sub: string; logo: ReactNode } }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    setErr(null); setBusy(true);
    try {
      if (mode === "in") await backend.signIn(email.trim(), pw);
      else {
        if (pw.length < 8) throw new Error("Use at least 8 characters for your password");
        const r = await backend.signUp(email.trim(), pw, name.trim());
        if (r.needsConfirm) { toast(t("Check your email to confirm your account"), "info"); setMode("in"); return; }
      }
      onIn();
    } catch (e) {
      setErr(t(e instanceof Error ? e.message : "Could not sign in"));
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-top"><LangSwitch /></div>
      <motion.div className="login-hero" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <Scene kind="factory" height={250}>
          <div className="login-brand">{brand ? brand.logo : <Logo size={40} />}<div><b>{brand?.name ?? "Factory"}</b><small>{brand?.sub ?? "Skalarki Electronics Ltd"}</small></div></div>
        </Scene>
      </motion.div>

      <motion.form className="card login-card" onSubmit={(e) => { e.preventDefault(); submit(); }}
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 24 }}>
        {!brand && <Segmented value={mode} onChange={(v) => { setMode(v); setErr(null); }}
          options={[{ value: "in", label: t("Sign in") }, { value: "up", label: t("New starter") }]} />}
        <AnimatePresence initial={false}>
          {mode === "up" && (
            <motion.label className="input-ic" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <User size={18} /><input placeholder={t("Full name")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </motion.label>
          )}
        </AnimatePresence>
        <label className="input-ic"><Mail size={18} />
          <input type="email" placeholder={t("Work email")} value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" required inputMode="email" />
        </label>
        <label className="input-ic"><KeyRound size={18} />
          <input type="password" placeholder={t("Password")} value={pw} onChange={(e) => setPw(e.target.value)}
            autoComplete={mode === "in" ? "current-password" : "new-password"} required />
        </label>
        <AnimatePresence>{err && <motion.p className="err" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} exit={{ opacity: 0 }}>{err}</motion.p>}</AnimatePresence>
        <Btn type="submit" tone="primary" wide busy={busy} icon={<ArrowRight size={18} />}>{mode === "in" ? t("Sign in") : t("Create account")}</Btn>
        {mode === "in" && (
          <button type="button" className="link center" onClick={async () => {
            if (!email) { setErr(t("Type your email first")); return; }
            try { await backend.resetPassword(email); toast(t("Reset link sent"), "info"); } catch (e) { setErr((e as Error).message); }
          }}>{t("Forgot password?")}</button>
        )}
        {mode === "up" && <p className="hint">{t("Got an invite link from work? Open it instead — it skips the approval wait.")}</p>}
      </motion.form>

    </div>
  );
}
