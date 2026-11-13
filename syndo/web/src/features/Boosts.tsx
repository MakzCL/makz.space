import { Select } from "../components/Select.tsx";
import { useEffect, useRef, useState } from "react";
import { Gift, KeyRound, Sparkles, Trash2 } from "lucide-react";
import { BOOST_LEVELS, type Guild, type User } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { onEvent, toast, useStore } from "../store.ts";
import { Avatar, Field, Modal, Toggle } from "../components/ui.tsx";
import { askConfirm } from "../components/overlay.tsx";
import { openModal } from "./modals.tsx";

/**
 * Server Boosts. Paid through Stripe when the server has it set up; free boosts come from codes
 * (developer / giveaway codes) or from SEND staff granting them.
 */

interface Premium {
  checkout_available: boolean; slots_per_purchase: number; staff: boolean;
  subscriptions: { id: string; provider: string; slots: number; status: string; current_period_end: string | null; created_at: string; note: string | null }[];
  boosts: { id: string; subscription_id: string; guild_id: string | null; guild_name: string | null; applied_at: string | null; cooldown_until: string | null; status: string; current_period_end: string | null }[];
}

const PERK_ROWS: [keyof (typeof BOOST_LEVELS)[number], string][] = [["upload_mb", "Upload size (MB)"], ["emoji", "Emoji slots"], ["stickers", "Sticker slots"], ["sounds", "Soundboard slots"], ["bitrate_kbps", "Voice quality (kbps)"], ["stream", "Screen share quality"]];

export function BoostPerks({ tier }: { tier: number }) {
  return <table className="perk-table"><thead><tr><th />{BOOST_LEVELS.map((l) => <th key={l.level} className={l.level === tier ? "cur" : ""}>{l.level ? `Level ${l.level}` : "Free"}<small className="muted block">{l.boosts} boosts</small></th>)}</tr></thead>
    <tbody>{PERK_ROWS.map(([k, label]) => <tr key={k}><td>{label}</td>{BOOST_LEVELS.map((l) => <td key={l.level} className={l.level === tier ? "cur" : ""}>{String(l[k])}</td>)}</tr>)}
      <tr><td>Animated banner & server badge</td>{BOOST_LEVELS.map((l) => <td key={l.level} className={l.level === tier ? "cur" : ""}>{l.animated_banner ? "✓" : "-"}</td>)}</tr></tbody></table>;
}

/** Under the server name (when the server turns it on): boost level, count and progress to the next level. */
export function ServerBoostBar({ guild }: { guild: Guild }) {
  const count = guild.premium_count ?? 0, tier = guild.premium_tier ?? 0;
  const max = BOOST_LEVELS[BOOST_LEVELS.length - 1]!.boosts;
  const next = BOOST_LEVELS.find((l) => l.boosts > count);
  return (
    <button className="server-boost-bar" onClick={() => openBoostServer(guild)} aria-label={`${tier ? `Level ${tier}` : "No boost level yet"}, ${count} boosts. Open Server Boost`}>
      <span className="sbb-top"><Sparkles size={13} /><b>{tier ? `Level ${tier}` : "Server Boost"}</b><span className="sbb-count">{count} {count === 1 ? "boost" : "boosts"}</span></span>
      <span className="sbb-track" aria-hidden><i style={{ width: `${Math.min(100, (count / max) * 100)}%` }} />{BOOST_LEVELS.slice(1).map((l) => <em key={l.level} className={count >= l.boosts ? "on" : ""} style={{ left: `${(l.boosts / max) * 100}%` }} />)}</span>
      <span className="sbb-next">{next ? `${next.boosts - count} more for Level ${next.level}` : "Max level reached"}</span>
    </button>
  );
}

/** Counts up to a new value instead of jumping (Sparks balance after a claim). */
function useCountUp(target: number | null) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === null) return;
    const start = from.current ?? target;
    from.current = target;
    if (target <= start || matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(target); return; }
    let raf = 0; const t0 = performance.now(), dur = 900;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); setShown(Math.round(start + (target - start) * e)); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

/** Sparks fly from the claim button to the balance, then the balance ticks up. */
function flySparks(from: HTMLElement, onLanded: () => void) {
  // Fly to whichever balance is on screen (the one at the top may be scrolled away).
  const visible = (el: HTMLElement | null) => { if (!el) return false; const r = el.getBoundingClientRect(), box = el.closest(".settings-body")?.getBoundingClientRect(); return r.height > 0 && r.top >= (box?.top ?? 0) && r.bottom <= (box?.bottom ?? innerHeight); };
  const to = [document.querySelector<HTMLElement>(".wallet-sparks"), document.querySelector<HTMLElement>(".sparks-coin")].find(visible) ?? document.querySelector<HTMLElement>(".sparks-coin");
  if (!to || matchMedia("(prefers-reduced-motion: reduce)").matches) { onLanded(); return; }
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const sx = a.left + a.width / 2, sy = a.top + a.height / 2, ex = b.left + 18, ey = b.top + b.height / 2;
  const n = 10; let landed = 0;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span"); p.className = "spark-fly"; p.textContent = "✦"; p.setAttribute("aria-hidden", "true");
    p.style.left = `${sx}px`; p.style.top = `${sy}px`;
    document.body.appendChild(p);
    const spread = (Math.random() - 0.5) * 140, lift = 60 + Math.random() * 90;
    const anim = p.animate([
      { transform: "translate(-50%, -50%) scale(.4)", opacity: 0 },
      { transform: `translate(calc(-50% + ${spread * 0.5}px), calc(-50% - ${lift}px)) scale(1.3)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${ex - sx}px), calc(-50% + ${ey - sy}px)) scale(.6)`, opacity: 0.9 },
    ], { duration: 850 + i * 45, delay: i * 35, easing: "cubic-bezier(.3,.1,.3,1)", fill: "forwards" });
    anim.onfinish = () => { p.remove(); if (++landed === 1) { to.classList.remove("wallet-pop"); void to.offsetWidth; to.classList.add("wallet-pop"); onLanded(); } };
  }
}

export function openBoostServer(guild: Guild) { openModal((close) => <BoostServer guild={guild} onClose={close} />); }

function BoostServer({ guild, onClose }: { guild: Guild; onClose: () => void }) {
  const live = useStore((s) => s.guilds[guild.id]) ?? guild;
  const [p, setP] = useState<Premium | null>(null);
  const [boosters, setBoosters] = useState<{ user: User; boosts: number; since: string }[]>([]);
  const load = () => { api.get<Premium>("/api/premium").then(setP).catch(() => {}); api.get(`/api/guilds/${guild.id}/boosts`).then(setBoosters).catch(() => {}); };
  useEffect(load, [guild.id]);
  const tier = live.premium_tier ?? 0, count = live.premium_count ?? 0;
  const next = BOOST_LEVELS.find((l) => l.boosts > count);
  const free = p?.boosts.filter((b) => !b.guild_id) ?? [];
  const apply = async (n: number) => {
    try { for (const b of free.slice(0, n)) await api.put(`/api/premium/boosts/${b.id}`, { guild_id: guild.id }); toast(`Boosted ${guild.name}!`, "success"); load(); }
    catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <Modal title={<><Sparkles size={20} /> Server Boost</>} label="Server Boost" wide onClose={onClose}>
      <div className="boost-hero">
        <h3>{guild.name}</h3>
        <p className="muted">{count} boost{count === 1 ? "" : "s"} · {tier ? `Level ${tier}` : "No level yet"}{next ? ` · ${next.boosts - count} more to reach Level ${next.level}` : " · Max level"}</p>
        <div className="boost-bar" aria-hidden><i style={{ width: `${Math.min(100, (count / 14) * 100)}%` }} />{BOOST_LEVELS.slice(1).map((l) => <span key={l.level} style={{ left: `${(l.boosts / 14) * 100}%` }} className={count >= l.boosts ? "on" : ""}>{l.level}</span>)}</div>
        {free.length > 0 ? <div className="row"><button className="btn primary" onClick={() => apply(1)}>Boost with 1 of your {free.length} free boosts</button>{free.length > 1 && <button className="btn" onClick={() => apply(free.length)}>Use all {free.length}</button>}</div>
          : <button className="btn primary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("send:dialog", { detail: { kind: "userSettings", tab: "boosts" } })); }}>Get boosts</button>}
      </div>
      <BoostPerks tier={tier} />
      {boosters.length > 0 && <><h4>Boosting this server</h4><div className="boosters">{boosters.map((b) => <div key={b.user.id} className="member"><Avatar user={b.user} size={28} /><span className="ellipsis">{b.user.display_name || b.user.username}</span><small className="muted">{b.boosts}× · since {new Date(b.since).toLocaleDateString()}</small></div>)}</div></>}
    </Modal>
  );
}

/** User settings → Boosts: buy, redeem codes, and move boosts between servers. */
export function BoostSettings() {
  const [p, setP] = useState<Premium | null>(null);
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState("");
  const [units, setUnits] = useState(1);
  const guilds = useStore((s) => s.guilds);
  const [sparks, setSparks] = useState<number | null>(null);
  const shownSparks = useCountUp(sparks);
  const load = () => { api.get<Premium>("/api/premium").then(setP).catch(() => {}); api.get<{ balance: number }>("/api/sparks").then((r) => setSparks(r.balance)).catch(() => {}); };
  useEffect(() => { load(); const a = onEvent("PREMIUM_UPDATE", load), b = onEvent("SPARKS_UPDATE", load); return () => { a(); b(); }; }, []);
  useEffect(() => { const q = new URLSearchParams(location.search).get("status"); if (q === "success") toast("Thanks! Your boosts are ready to use.", "success"); }, []);
  const redeem = async () => { try { const r = await api.post<{ slots: number; days: number | null }>("/api/premium/redeem", { code: code.trim() }); toast(`Code redeemed: ${r.slots} boosts${r.days ? ` for ${r.days} days` : ""}.`, "success"); setCode(""); load(); } catch (e) { toast(errMsg(e), "error"); } };
  const checkout = async () => { try { const r = await api.post<{ url: string }>("/api/premium/checkout", { units, ...(discount.trim() ? { code: discount.trim() } : {}) }); location.href = r.url; } catch (e) { toast(errMsg(e), "error"); } };
  const portal = async () => { try { const r = await api.post<{ url: string }>("/api/premium/portal"); location.href = r.url; } catch (e) { toast(errMsg(e), "error"); } };
  if (!p) return <p className="muted">Loading…</p>;
  const paid = p.subscriptions.some((s) => s.provider === "stripe" && s.status !== "canceled");
  return (
    <div className="settings-section">
      <div className="boost-title">
        <h2><Sparkles size={20} /> Server Boosts</h2>
        <div className="boost-wallet" aria-label="Your balance">
          <span title="Your boosts"><Sparkles size={14} /> {p.boosts.length} {p.boosts.length === 1 ? "boost" : "boosts"}</span>
          {sparks !== null && <span className="wallet-sparks" title="Your Sparks"><b aria-hidden>✦</b> {shownSparks} Sparks</span>}
        </div>
      </div>
      <p className="muted">Boosts unlock bigger uploads, more emoji, sticker and sound slots, and higher voice and screen-share quality for a server. Everything SEND already gives every server stays free.</p>
      <SparksCard onBalance={setSparks} />
      <BoostList p={p} guilds={guilds} onChange={load} />
      <div className="card">
        <h3><Gift size={18} /> Redeem a code</h3>
        <div className="row"><input placeholder="SEND-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" /><button className="btn primary" disabled={code.trim().length < 4} onClick={redeem}>Redeem</button></div>
      </div>
      <div className="card">
        <h3>Buy boosts</h3>
        {p.checkout_available ? <>
          <div className="row"><Field label="Packs"><Select value={units} onChange={(e) => setUnits(Number(e.target.value))}>{[1, 2, 3, 5, 7].map((n) => <option key={n} value={n}>{n} × {p.slots_per_purchase} boosts</option>)}</Select></Field>
            <Field label="Discount code (optional)"><input value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field></div>
          <div className="row"><button className="btn primary" onClick={checkout}>Continue to payment</button>{paid && <button className="btn" onClick={portal}>Manage subscription</button>}</div>
          <p className="muted small">Payments are handled by Stripe. You can cancel any time; boosts last until the end of the paid period.</p>
        </> : <p className="muted">Paid boosts aren't available on this server yet. Ask the SEND team for a code.</p>}
      </div>
      {p.staff && <StaffPremium />}
    </div>
  );
}

/* ---------------------------------------------------------------------- boosts, grouped by server -- */
function BoostList({ p, guilds, onChange }: { p: Premium; guilds: Record<string, Guild>; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const groups = new Map<string, Premium["boosts"]>();
  for (const b of p.boosts) { const k = b.guild_id ?? ""; groups.set(k, [...(groups.get(k) ?? []), b]); }
  const order = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : (groups.get(b)!.length - groups.get(a)!.length)));
  const movable = (list: Premium["boosts"]) => list.filter((b) => !b.cooldown_until || new Date(b.cooldown_until) <= new Date());
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); onChange(); } };
  const move = (list: Premium["boosts"], n: number, to: string) => run(async () => {
    const pick = movable(list).slice(0, n);
    if (!pick.length) throw new Error("Those boosts were moved recently and can't move again yet.");
    for (const b of pick) to ? await api.put(`/api/premium/boosts/${b.id}`, { guild_id: to }) : await api.del(`/api/premium/boosts/${b.id}`);
  });
  const soonest = (list: Premium["boosts"]) => list.map((b) => b.current_period_end).filter(Boolean).sort()[0];
  return (
    <div className="card">
      <h3>Your boosts ({p.boosts.length})</h3>
      {!p.boosts.length && <p className="muted">You don't have any boosts yet. Earn them with Sparks above.</p>}
      {order.map((gid) => {
        const list = groups.get(gid)!, n = list.length, end = soonest(list), free = movable(list).length;
        return (
          <div key={gid || "free"} className={`boost-group ${gid ? "" : "unused"}`}>
            <span className="boost-count" aria-label={`${n} boosts`}><Sparkles size={15} />{n}</span>
            <span className="grow">
              {gid ? <>Boosting <strong>{list[0]!.guild_name ?? guilds[gid]?.name ?? "a server"}</strong></> : <strong>Not used yet</strong>}
              <small className="muted block">{end ? `Next ends ${new Date(end).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : "No end date"}{gid && free < n ? ` · ${n - free} can't move yet` : ""}</small>
            </span>
            <Select disabled={busy || !free} value="" aria-label={gid ? "Move boosts" : "Use boosts"} onChange={(e) => {
              const [to, count] = e.target.value.split("|"); if (to === undefined) return; void move(list, count === "all" ? free : 1, to);
            }}>
              <option value="" disabled>{gid ? "Move…" : "Use on…"}</option>
              {Object.values(guilds).filter((g) => g.id !== gid).map((g) => <optgroup key={g.id} label={g.name}><option value={`${g.id}|1`}>1 boost to {g.name}</option>{free > 1 && <option value={`${g.id}|all`}>All {free} to {g.name}</option>}</optgroup>)}
              {gid && <optgroup label="Remove"><option value="|1">Remove 1 boost</option>{free > 1 && <option value="|all">Remove all {free}</option>}</optgroup>}
            </Select>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- Sparks -- */
interface Sparks { balance: number; per_boost: number; season: { id: string; ends: string; live: boolean }; invite_link: string;
  challenges: { key: string; title: string; detail: string; goal: number; unit: string; reward: number; progress: number; claimed: boolean }[] }
export function SparksCard({ onBalance }: { onBalance?: (n: number) => void } = {}) {
  const [s, setS] = useState<Sparks | null>(null);
  const shown = useCountUp(s?.balance ?? null);
  const [busy, setBusy] = useState("");
  const load = () => api.get<Sparks>("/api/sparks").then(setS).catch(() => {});
  useEffect(() => { load(); const a = onEvent("SPARKS_UPDATE", load); const t = setInterval(load, 60_000); return () => { a(); clearInterval(t); }; }, []);
  if (!s) return null;
  const claim = async (key: string, btn: HTMLElement) => {
    setBusy(key);
    try {
      const r = await api.post<{ balance: number }>(`/api/sparks/claim/${key}`);
      setS((x) => x && { ...x, challenges: x.challenges.map((c) => c.key === key ? { ...c, claimed: true } : c) });
      flySparks(btn, () => { setS((x) => x && { ...x, balance: r.balance }); onBalance?.(r.balance); });
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(""); }
  };
  const buy = async (count: number) => { setBusy("buy"); try { const r = await api.post<{ balance: number }>("/api/sparks/boosts", { count }); onBalance?.(r.balance); toast(count === 1 ? "Boost added. Pick a server below." : `${count} boosts added. Pick servers below.`, "success"); await load(); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(""); } };
  const canBuy = Math.floor(s.balance / s.per_boost);
  const done = s.challenges.filter((c) => c.claimed).length;
  return (
    <div className="card sparks">
      <div className="sparks-head">
        <span className="sparks-coin" aria-hidden>✦</span>
        <div className="grow"><h3>{shown} Sparks</h3><p className="muted small">Finish challenges to earn Sparks. {s.per_boost} Sparks buys a boost that lasts a year. Finish all {s.challenges.length} and you can take a server to Level 3 on your own.</p></div>
        <button className="btn primary sparks-buy" disabled={!canBuy || !!busy} onClick={() => buy(1)}>Get a boost · {s.per_boost} ✦</button>
        {canBuy > 1 && <button className="btn" disabled={!!busy} onClick={() => buy(canBuy)}>Get {canBuy}</button>}
      </div>
      <div className="sparks-season muted small">Season {s.season.id}: {done} of {s.challenges.length} done · ends {new Date(s.season.ends).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</div>
      <ul className="challenges">
        {s.challenges.map((c) => {
          const pct = Math.round((c.progress / c.goal) * 100), ready = c.progress >= c.goal && !c.claimed;
          return (
            <li key={c.key} className={`challenge ${c.claimed ? "claimed" : ready ? "ready" : ""}`}>
              <div className="grow">
                <b>{c.title}</b><small className="muted block">{c.detail}</small>
                <div className="challenge-bar" role="progressbar" aria-valuemin={0} aria-valuemax={c.goal} aria-valuenow={c.progress}><i style={{ width: `${pct}%` }} /></div>
                <small className="muted">{c.progress} / {c.goal} {c.unit}</small>
                {c.key === "invite" && !c.claimed && <button className="link small" onClick={() => { navigator.clipboard?.writeText(s.invite_link).then(() => toast("Invite link copied.", "success")).catch(() => toast(s.invite_link, "info")); }}>Copy your invite link</button>}
              </div>
              {c.claimed ? <span className="challenge-done">Claimed ✓</span>
                : <button className="btn sm challenge-claim" disabled={!ready || busy === c.key || !s.season.live} onClick={(e) => claim(c.key, e.currentTarget)}>+{c.reward} ✦</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StaffPremium() {
  const [d, setD] = useState<any>(null);
  const [user, setUser] = useState(""); const [slots, setSlots] = useState(2); const [days, setDays] = useState<number | "">(""); const [note, setNote] = useState("");
  const [kind, setKind] = useState<"free" | "discount">("free"); const [pct, setPct] = useState(100); const [uses, setUses] = useState(1); const [cDays, setCDays] = useState<number | "">(""); const [custom, setCustom] = useState("");
  const load = () => api.get("/api/staff/premium").then(setD).catch((e) => toast(errMsg(e), "error"));
  useEffect(() => { load(); }, []);
  const grant = async () => { try { await api.post("/api/staff/grants", { user, slots, days: days === "" ? null : days, note: note || undefined }); toast("Boosts granted.", "success"); setUser(""); load(); } catch (e) { toast(errMsg(e), "error"); } };
  const make = async () => { try { const r = await api.post<{ code: string }>("/api/staff/codes", { kind, percent_off: kind === "discount" ? pct : undefined, slots, duration_days: cDays === "" ? null : cDays, max_uses: uses, ...(custom ? { code: custom } : {}) }); navigator.clipboard?.writeText(r.code).catch(() => {}); toast(`Code ${r.code} created (copied).`, "success"); setCustom(""); load(); } catch (e) { toast(errMsg(e), "error"); } };
  if (!d) return null;
  return <div className="card staff">
    <h3><KeyRound size={18} /> Staff: free boosts</h3>
    <p className="muted small">Only SEND staff see this. Grants and codes don't involve payment.</p>
    <h4>Give boosts to someone</h4>
    <div className="row wrap"><input placeholder="username" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Username" /><input type="number" min={1} max={100} value={slots} onChange={(e) => setSlots(Number(e.target.value))} aria-label="Boosts" /><input type="number" min={1} placeholder="days (empty = forever)" value={days} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : "")} aria-label="Days" /><input placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" /><button className="btn primary" disabled={!user} onClick={grant}>Grant</button></div>
    <h4>Create a code</h4>
    <div className="row wrap"><Select value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Kind"><option value="free">Free boosts (developer code)</option><option value="discount">Discount at checkout</option></Select>
      {kind === "discount" && <input type="number" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Percent off" />}
      <input type="number" min={0} value={uses} onChange={(e) => setUses(Number(e.target.value))} aria-label="Max uses (0 = unlimited)" title="Max uses (0 = unlimited)" />
      <input type="number" min={1} placeholder="days (empty = forever)" value={cDays} onChange={(e) => setCDays(e.target.value ? Number(e.target.value) : "")} aria-label="Duration days" />
      <input placeholder="custom code (optional)" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom code" />
      <button className="btn primary" onClick={make}>Create code</button></div>
    <h4>Grants</h4>
    {d.grants.map((g: any) => <div key={g.id} className="boost-slot"><Avatar user={g.user} size={20} /><span className="grow">{g.user?.username} · {g.slots} boosts · {g.provider}{g.note ? ` · ${g.note}` : ""} · {g.status}{g.current_period_end ? ` · until ${new Date(g.current_period_end).toLocaleDateString()}` : ""}</span>
      {g.status === "active" && <button className="icon-btn sm danger" aria-label="End grant" onClick={async () => { if (await askConfirm({ title: "End this grant?", confirmLabel: "End", danger: true })) api.del(`/api/staff/grants/${g.id}`).then(load); }}><Trash2 size={14} /></button>}</div>)}
    <h4>Codes</h4>
    {d.codes.map((c: any) => <div key={c.code} className="boost-slot"><code>{c.code}</code><span className="grow muted small">{c.kind === "free" ? `${c.slots} free boosts` : `${c.percent_off}% off`} · used {c.uses}/{c.max_uses || "∞"}{c.duration_days ? ` · ${c.duration_days} days` : ""}</span><button className="icon-btn sm danger" aria-label="Delete code" onClick={() => api.del(`/api/staff/codes/${encodeURIComponent(c.code)}`).then(load)}><Trash2 size={14} /></button></div>)}
  </div>;
}
export { Toggle };
