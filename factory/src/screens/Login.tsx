import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, KeyRound, Mail, RotateCcw, User } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { Logo } from "../components/Logo";
import { useToast } from "../components/Toast";
import { Btn, Segmented, item, list } from "../components/ui";
import type { Backend } from "../lib/backend";
import { ROLE_META, ROLE_ORDER } from "../lib/roles";
import type { Role } from "../lib/types";

export function Login({ backend, onIn }: { backend: Backend; onIn: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<Role | null>(null);
  const toast = useToast();
  const staff = backend.demoStaff?.() ?? [];

  async function submit() {
    setErr(null); setBusy(true);
    try {
      if (mode === "in") await backend.signIn(email.trim(), pw);
      else {
        if (pw.length < 8) throw new Error("Use at least 8 characters for your password");
        const r = await backend.signUp(email.trim(), pw, name.trim());
        if (r.needsConfirm) { toast("Check your email to confirm your account ✉️", "info"); setMode("in"); return; }
      }
      onIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not sign in");
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <motion.div className="login-hero" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <Logo size={56} />
        <h1>Factory<span>.</span></h1>
        <p>Skalarki Electronics Ltd · operations</p>
      </motion.div>

      <motion.form className="card login-card" onSubmit={(e) => { e.preventDefault(); submit(); }}
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 24 }}>
        <Segmented value={mode} onChange={(v) => { setMode(v); setErr(null); }}
          options={[{ value: "in", label: "Sign in" }, { value: "up", label: "New starter" }]} />
        <AnimatePresence initial={false}>
          {mode === "up" && (
            <motion.label className="input-ic" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <User size={18} /><input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </motion.label>
          )}
        </AnimatePresence>
        <label className="input-ic"><Mail size={18} />
          <input type="email" placeholder={backend.mode === "demo" ? "karol@skalarki.demo" : "Work email"} value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" required inputMode="email" />
        </label>
        <label className="input-ic"><KeyRound size={18} />
          <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)}
            autoComplete={mode === "in" ? "current-password" : "new-password"} required={backend.mode === "cloud"} />
        </label>
        <AnimatePresence>{err && <motion.p className="err" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} exit={{ opacity: 0 }}>{err}</motion.p>}</AnimatePresence>
        <Btn type="submit" tone="primary" wide busy={busy} icon={<ArrowRight size={18} />}>{mode === "in" ? "Enter" : "Create account"}</Btn>
        {mode === "in" && backend.mode === "cloud" && (
          <button type="button" className="link" onClick={async () => {
            if (!email) { setErr("Type your email first"); return; }
            try { await backend.resetPassword(email); toast("Reset link sent ✉️", "info"); } catch (e) { setErr((e as Error).message); }
          }}>Forgot password?</button>
        )}
        {mode === "up" && backend.mode === "cloud" && <p className="hint">The very first account becomes the Boss. Everyone else starts as Operator and the Boss assigns roles.</p>}
      </motion.form>

      {backend.mode === "demo" && (
        <motion.div className="gateways" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          <div className="section-head"><div><h2>Choose a gateway</h2><p>Demo mode — try every role. Open a second tab as someone else to test team jobs.</p></div></div>
          <motion.div className="gate-grid" variants={list} initial="hidden" animate="show">
            {ROLE_ORDER.map((r) => (
              <motion.button key={r} variants={item} className={`gate ${gate === r ? "on" : ""}`} style={{ ["--c" as string]: ROLE_META[r].hue }}
                onClick={() => setGate(gate === r ? null : r)} whileTap={{ scale: 0.97 }}>
                <b>{ROLE_META[r].label}</b><small>{ROLE_META[r].blurb}</small>
              </motion.button>
            ))}
          </motion.div>
          <AnimatePresence>
            {gate && (
              <motion.div className="gate-people" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                {staff.filter((p) => p.role === gate).map((p) => (
                  <motion.button key={p.id} className="person-row" whileTap={{ scale: 0.98 }}
                    onClick={async () => { await backend.signInAs!(p.id); onIn(); }}>
                    <Avatar p={p} size={38} ring /><span><b>{p.full_name}</b><small>#{p.employee_code}</small></span><ArrowRight size={18} />
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <button className="link center" onClick={() => { if (confirm("Reset all demo data?")) { backend.resetDemo?.(); location.reload(); } }}>
            <RotateCcw size={14} /> Reset demo data
          </button>
        </motion.div>
      )}
    </div>
  );
}
