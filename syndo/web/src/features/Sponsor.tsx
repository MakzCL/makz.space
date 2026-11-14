/** Sponsor the developer: a monthly amount (£1, £5, £10 or your own), paid through Stripe. Web and desktop only. */
import { useEffect, useRef, useState } from "react";
import { Heart, ExternalLink, Check, ArrowLeft, Loader2 } from "lucide-react";
import { api, errMsg } from "../api.ts";
import { toast, useStore } from "../store.ts";
import { Toggle } from "../components/ui.tsx";

interface Info { available: boolean; publishable_key?: string | null; recipient: string; presets: number[]; min: number; max: number; currency: string; mine: { amount_pence: number; status: string; current_period_end: string | null; show_badge: boolean; started_at: string } | null }
const day = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const money = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;

/* Stripe.js, loaded only when someone actually starts sponsoring. */
let stripeJs: Promise<any> | null = null;
const loadStripe = () => stripeJs ??= new Promise((resolve, reject) => {
  if ((window as any).Stripe) return resolve((window as any).Stripe);
  const sc = document.createElement("script");
  sc.src = "https://js.stripe.com/v3/"; sc.async = true;
  sc.onload = () => resolve((window as any).Stripe); sc.onerror = () => { stripeJs = null; reject(new Error("Couldn't load the payment form. Check your connection and try again.")); };
  document.head.appendChild(sc);
});

/** Stripe's checkout, mounted inside SEND. Calls onDone when payment succeeds without leaving the app. */
function EmbeddedCheckout({ pk, clientSecret, onDone, onBack }: { pk: string; clientSecret: string; onDone: () => void; onBack: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let checkout: any, gone = false;
    loadStripe().then(async (Stripe) => {
      if (gone) return;
      checkout = await Stripe(pk).initEmbeddedCheckout({ fetchClientSecret: async () => clientSecret, onComplete: () => onDone() });
      if (gone) { checkout.destroy(); return; }
      checkout.mount(box.current!); setReady(true);
    }).catch((e) => { toast(errMsg(e), "error"); onBack(); });
    return () => { gone = true; try { checkout?.destroy(); } catch { /* already gone */ } };
  }, [pk, clientSecret]); // eslint-disable-line
  return (
    <section className="sponsor-pay">
      <button className="link sponsor-back" onClick={onBack}><ArrowLeft size={15} /> Change amount</button>
      {!ready && <p className="muted sponsor-loading"><Loader2 size={16} className="spin" /> Opening secure payment…</p>}
      <div ref={box} className="sponsor-stripe" />
    </section>
  );
}

export function SponsorTab() {
  const [info, setInfo] = useState<Info | null>(null);
  const [pick, setPick] = useState<number | "custom">(500);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const load = () => api.get<Info>("/api/sponsor").then(setInfo).catch(() => setInfo(null));
  useEffect(() => { void load(); const on = () => void load(); window.addEventListener("send:sponsor", on); return () => window.removeEventListener("send:sponsor", on); }, []);
  if (!info) return <div className="card"><p className="muted">Loading…</p></div>;
  const customPence = Math.round(Number(custom.replace(/[^0-9.]/g, "")) * 100);
  const amount = pick === "custom" ? customPence : pick;
  const valid = Number.isFinite(amount) && amount >= info.min && amount <= info.max;
  const go = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const r = await api.post<{ url?: string; client_secret?: string }>(path, body);
      if (r.client_secret) { setPaying(r.client_secret); setBusy(false); } else if (r.url) location.assign(r.url);
    } catch (e) { toast(errMsg(e), "error"); setBusy(false); }
  };
  // Paid inside SEND: thank them, then wait for Stripe's confirmation to switch the page to "You're sponsoring".
  const done = () => {
    setPaying(null); setThanks(true);
    let n = 0;
    const tick = () => api.get<Info>("/api/sponsor").then((i) => { setInfo(i); if (!i.mine && ++n < 30) setTimeout(tick, 1500); else setThanks(false); }).catch(() => setThanks(false));
    tick();
  };
  const m = info.mine;
  return (
    <div className="sponsor">
      <section className="sponsor-hero">
        <span className="sponsor-heart" aria-hidden><Heart size={26} fill="currentColor" /></span>
        <h2>Sponsor {info.recipient}</h2>
        <p>SEND is made by {info.recipient}. It's free, has no ads, and your data is never sold. If you'd like to help, a monthly sponsorship pays for the servers that keep SEND running for everyone.</p>
      </section>

      {thanks ? (
        <section className="card sponsor-thanks">
          <span className="sponsor-heart small" aria-hidden><Heart size={20} fill="currentColor" /></span>
          <h3>Thank you!</h3>
          <p className="muted small"><Loader2 size={14} className="spin" /> Confirming your sponsorship…</p>
        </section>
      ) : paying && info.publishable_key ? (
        <EmbeddedCheckout pk={info.publishable_key} clientSecret={paying} onDone={done} onBack={() => setPaying(null)} />
      ) : m ? (
        <section className="card sponsor-active">
          <h3><Check size={18} /> You're sponsoring {money(m.amount_pence)}/month</h3>
          <p className="muted small">Since {day(m.started_at)}{m.status === "past_due" ? ". Your last payment didn't go through: update your card in Manage." : m.current_period_end ? `. Next payment ${day(m.current_period_end)}.` : "."} Thank you.</p>
          <Toggle checked={m.show_badge} label="Show the Sponsor badge on my profile" onChange={(v) => api.patch("/api/sponsor", { show_badge: v }).then(load).catch((e) => toast(errMsg(e), "error"))} />
          <button className="btn" disabled={busy} onClick={() => go("/api/sponsor/portal")}><ExternalLink size={15} /> Manage, change card or cancel</button>
        </section>
      ) : (
        <section className="card">
          <div className="sponsor-options" role="radiogroup" aria-label="Monthly amount">
            {info.presets.map((p) => (
              <button key={p} role="radio" aria-checked={pick === p} className={`sponsor-option ${pick === p ? "on" : ""}`} onClick={() => setPick(p)}>
                <b>{money(p)}</b><small>/month</small>
              </button>
            ))}
            <button role="radio" aria-checked={pick === "custom"} className={`sponsor-option ${pick === "custom" ? "on" : ""}`} onClick={() => setPick("custom")}>
              <b>Custom</b><small>/month</small>
            </button>
          </div>
          {pick === "custom" && (
            <label className="sponsor-custom">
              <span>£</span>
              <input autoFocus inputMode="decimal" placeholder="3.50" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom monthly amount in pounds" />
              <small>/month</small>
            </label>
          )}
          {pick === "custom" && custom && !valid && <p className="small danger-text">Choose between {money(info.min)} and {money(info.max)} a month.</p>}
          <button className="btn primary sponsor-go" disabled={!info.available || !valid || busy} onClick={() => go("/api/sponsor/checkout", { amount_pence: amount, embedded: true })}>
            <Heart size={16} /> {info.available ? (valid ? `Sponsor ${money(amount)}/month` : "Sponsor") : "Sponsoring opens soon"}
          </button>
          <p className="muted small sponsor-fine">Paid monthly to MAKZ Labs through Stripe. Cancel any time from this page. Sponsoring is a gift: it doesn't unlock features, but you get a Sponsor badge on your profile (you can hide it). See the <a href="https://send.makz.space/terms#sponsor" target="_blank" rel="noopener">Terms</a>.</p>
        </section>
      )}
    </div>
  );
}

/** Back from Stripe (?sponsor=thanks|cancelled|manage): say so and open the Sponsor page. */
export function initSponsorReturn() {
  const p = new URLSearchParams(location.search).get("sponsor");
  if (!p) return;
  const url = new URL(location.href); url.searchParams.delete("sponsor"); history.replaceState(history.state, "", url);
  const open = () => setTimeout(() => {
    if (p === "thanks") toast("Thank you for sponsoring! It can take a moment to show up.", "success");
    window.dispatchEvent(new CustomEvent("send:dialog", { detail: { kind: "userSettings", tab: "sponsor" } }));
  }, 600);
  if (useStore.getState().me) open();
  else { const off = useStore.subscribe((s) => { if (s.me) { off(); open(); } }); }
}
