/** Sponsor the developer: a monthly amount (£1, £5, £10 or your own), paid through Stripe. Web and desktop only. */
import { useEffect, useState } from "react";
import { Heart, ExternalLink, Check } from "lucide-react";
import { api, errMsg } from "../api.ts";
import { toast, useStore } from "../store.ts";
import { Toggle } from "../components/ui.tsx";

interface Info { available: boolean; recipient: string; presets: number[]; min: number; max: number; currency: string; mine: { amount_pence: number; status: string; current_period_end: string | null; show_badge: boolean; started_at: string } | null }
const day = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const money = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;

export function SponsorTab() {
  const [info, setInfo] = useState<Info | null>(null);
  const [pick, setPick] = useState<number | "custom">(500);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.get<Info>("/api/sponsor").then(setInfo).catch(() => setInfo(null));
  useEffect(() => { void load(); const on = () => void load(); window.addEventListener("send:sponsor", on); return () => window.removeEventListener("send:sponsor", on); }, []);
  if (!info) return <div className="card"><p className="muted">Loading…</p></div>;
  const customPence = Math.round(Number(custom.replace(/[^0-9.]/g, "")) * 100);
  const amount = pick === "custom" ? customPence : pick;
  const valid = Number.isFinite(amount) && amount >= info.min && amount <= info.max;
  const go = async (path: string, body?: unknown) => {
    setBusy(true);
    try { const r = await api.post<{ url: string }>(path, body); location.assign(r.url); }
    catch (e) { toast(errMsg(e), "error"); setBusy(false); }
  };
  const m = info.mine;
  return (
    <div className="sponsor">
      <section className="sponsor-hero">
        <span className="sponsor-heart" aria-hidden><Heart size={26} fill="currentColor" /></span>
        <h2>Sponsor {info.recipient}</h2>
        <p>SEND is made by {info.recipient}. It's free, has no ads, and your data is never sold. If you'd like to help, a monthly sponsorship pays for the servers that keep SEND running for everyone.</p>
      </section>

      {m ? (
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
          <button className="btn primary sponsor-go" disabled={!info.available || !valid || busy} onClick={() => go("/api/sponsor/checkout", { amount_pence: amount })}>
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
