import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BRAND } from "@syndo/shared";
import { Wordmark } from "./ui.tsx";
import { ApiError, api, errMsg } from "../api.ts";
import { signedIn } from "../actions.ts";
import { navigate, setTitle, useRoute } from "../router.ts";
import { Field, Mark } from "./ui.tsx";
import { ResetAppearanceLink } from "../appearance/Recovery.tsx";

function Card({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  useEffect(() => setTitle(title), [title]);
  return (
    <main className="auth">
      <div className="auth-art" aria-hidden><Mark size={220} /></div>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand"><Wordmark /></div>
        <h1 id="auth-title">{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {children}
        <div className="auth-recover"><ResetAppearanceLink /></div>
      </section>
    </main>
  );
}

function afterAuth() {
  const next = new URLSearchParams(location.search).get("next");
  signedIn();
  navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/channels/@me", true);
}

export function Login() {
  const route = useRoute();
  const [login, setLogin] = useState(""); const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState(route.query.get("mfa") === "1"); const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (mfa) { await api.post("/api/auth/mfa/verify", { code }); afterAuth(); return; }
      const r = await api.post<{ mfa_required?: boolean }>("/api/auth/login", { login, password });
      if (r.mfa_required) setMfa(true); else afterAuth();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  if (mfa) return (
    <Card title="Two-factor check" sub="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
      <form onSubmit={submit} className="stack">
        <Field label="Code" error={err}><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} required /></Field>
        <button className="btn primary" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
        <button type="button" className="link" onClick={() => { setMfa(false); api.post("/api/auth/logout").catch(() => {}); }}>Use a different account</button>
      </form>
    </Card>
  );
  return (
    <Card title="Welcome back" sub={`Good to see you again on ${BRAND.name}.`}>
      <form onSubmit={submit} className="stack">
        <Field label="Email or username"><input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required maxLength={254} /></Field>
        <Field label="Password" error={err}><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <button type="button" className="link left" onClick={() => navigate("/forgot")}>Forgot your password?</button>
        <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted small">New here? <button type="button" className="link" onClick={() => navigate("/register" + location.search)}>Create an account</button></p>
      </form>
    </Card>
  );
}

export function Register() {
  const [f, setF] = useState({ email: "", username: "", display_name: "", password: "" });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null); const [busy, setBusy] = useState(false);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post("/api/auth/register", { ...f, display_name: f.display_name || undefined }); afterAuth(); }
    catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setErr({ field: code === "username_taken" ? "username" : code === "email_taken" ? "email" : undefined, msg: errMsg(e) });
    } finally { setBusy(false); }
  };
  const e = (k: string) => (err && (err.field === k || (!err.field && k === "password")) ? err.msg : null);
  return (
    <Card title="Create your account" sub="Every feature is free for everyone. No subscriptions, no boosts.">
      <form onSubmit={submit} className="stack">
        <Field label="Email" error={e("email")}><input autoFocus type="email" autoComplete="email" value={f.email} onChange={up("email")} required /></Field>
        <Field label="Display name" hint="What friends see. You can change it any time."><input value={f.display_name} onChange={up("display_name")} maxLength={32} autoComplete="nickname" /></Field>
        <Field label="Username" hint="Lowercase letters, numbers, dots and underscores." error={e("username")}>
          <input value={f.username} onChange={(ev) => setF({ ...f, username: ev.target.value.toLowerCase() })} required minLength={2} maxLength={32} pattern="[a-z0-9_.]{2,32}" autoComplete="username" />
        </Field>
        <Field label="Password" hint="At least 8 characters." error={e("password")}><input type="password" value={f.password} onChange={up("password")} minLength={8} required autoComplete="new-password" /></Field>
        <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        <p className="muted small">Already have an account? <button type="button" className="link" onClick={() => navigate("/login" + location.search)}>Sign in</button></p>
      </form>
    </Card>
  );
}

export function Forgot() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <Card title="Reset your password" sub={sent ? "If an account uses that email, a reset link is on its way. It works for one hour." : "We'll email you a link to choose a new password."}>
      {!sent && (
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await api.post("/api/auth/forgot-password", { email }); setSent(true); } catch (x) { setErr(errMsg(x)); } }}>
          <Field label="Email" error={err}><input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <button className="btn primary">Send reset link</button>
        </form>
      )}
      <button className="link" onClick={() => navigate("/login")}>Back to sign in</button>
    </Card>
  );
}

export function Reset() {
  const token = useRoute().query.get("token") ?? "";
  const [pw, setPw] = useState(""); const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <Card title="Choose a new password" sub={done ? "Done. You've been signed out everywhere — sign in with your new password." : undefined}>
      {!done ? (
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await api.post("/api/auth/reset-password", { token, password: pw }); setDone(true); } catch (x) { setErr(errMsg(x)); } }}>
          <Field label="New password" error={err}><input autoFocus type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" /></Field>
          <button className="btn primary">Save password</button>
        </form>
      ) : <button className="btn primary" onClick={() => navigate("/login")}>Sign in</button>}
    </Card>
  );
}

export function Verify() {
  const token = useRoute().query.get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "error">("working"); const [msg, setMsg] = useState("");
  useEffect(() => { api.post("/api/auth/verify-email", { token }).then(() => setState("ok")).catch((e) => { setState("error"); setMsg(errMsg(e)); }); }, [token]);
  return (
    <Card title={state === "ok" ? "Email confirmed" : state === "error" ? "That link didn't work" : "Confirming…"} sub={state === "ok" ? "Thanks! Your account is all set." : msg}>
      <button className="btn primary" onClick={() => navigate("/channels/@me")}>Open {BRAND.name}</button>
    </Card>
  );
}
