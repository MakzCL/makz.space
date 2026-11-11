import { useEffect, useState } from "react";
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
      <tr><td>Animated banner & server badge</td>{BOOST_LEVELS.map((l) => <td key={l.level} className={l.level === tier ? "cur" : ""}>{l.animated_banner ? "✓" : "—"}</td>)}</tr></tbody></table>;
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
  const load = () => api.get<Premium>("/api/premium").then(setP).catch(() => {});
  useEffect(() => { load(); return onEvent("PREMIUM_UPDATE", load); }, []);
  useEffect(() => { const q = new URLSearchParams(location.search).get("status"); if (q === "success") toast("Thanks! Your boosts are ready to use.", "success"); }, []);
  const redeem = async () => { try { const r = await api.post<{ slots: number; days: number | null }>("/api/premium/redeem", { code: code.trim() }); toast(`Code redeemed: ${r.slots} boosts${r.days ? ` for ${r.days} days` : ""}.`, "success"); setCode(""); load(); } catch (e) { toast(errMsg(e), "error"); } };
  const checkout = async () => { try { const r = await api.post<{ url: string }>("/api/premium/checkout", { units, ...(discount.trim() ? { code: discount.trim() } : {}) }); location.href = r.url; } catch (e) { toast(errMsg(e), "error"); } };
  const portal = async () => { try { const r = await api.post<{ url: string }>("/api/premium/portal"); location.href = r.url; } catch (e) { toast(errMsg(e), "error"); } };
  if (!p) return <p className="muted">Loading…</p>;
  const paid = p.subscriptions.some((s) => s.provider === "stripe" && s.status !== "canceled");
  return (
    <div className="settings-section">
      <h2><Sparkles size={20} /> Server Boosts</h2>
      <p className="muted">Boosts unlock bigger uploads, more emoji, sticker and sound slots, and higher voice and screen-share quality for a server. Everything SEND already gives every server stays free.</p>
      <div className="card">
        <h3>Your boosts ({p.boosts.length})</h3>
        {!p.boosts.length && <p className="muted">You don't have any boosts yet.</p>}
        {p.boosts.map((b) => (
          <div key={b.id} className="boost-slot">
            <Sparkles size={16} />
            {b.guild_id ? <span className="grow">Boosting <strong>{b.guild_name}</strong>{b.cooldown_until && new Date(b.cooldown_until) > new Date() ? <small className="muted"> · can move on {new Date(b.cooldown_until).toLocaleDateString()}</small> : null}</span> : <span className="grow muted">Not used yet</span>}
            <select value={b.guild_id ?? ""} onChange={(e) => (e.target.value ? api.put(`/api/premium/boosts/${b.id}`, { guild_id: e.target.value }) : api.del(`/api/premium/boosts/${b.id}`)).then(load).catch((x) => toast(errMsg(x), "error"))} aria-label="Server to boost">
              <option value="">{b.guild_id ? "Remove boost" : "Choose a server…"}</option>
              {Object.values(guilds).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {b.current_period_end && <small className="muted">until {new Date(b.current_period_end).toLocaleDateString()}</small>}
          </div>
        ))}
      </div>
      <div className="card">
        <h3><Gift size={18} /> Redeem a code</h3>
        <div className="row"><input placeholder="SEND-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" /><button className="btn primary" disabled={code.trim().length < 4} onClick={redeem}>Redeem</button></div>
      </div>
      <div className="card">
        <h3>Buy boosts</h3>
        {p.checkout_available ? <>
          <div className="row"><Field label="Packs"><select value={units} onChange={(e) => setUnits(Number(e.target.value))}>{[1, 2, 3, 5, 7].map((n) => <option key={n} value={n}>{n} × {p.slots_per_purchase} boosts</option>)}</select></Field>
            <Field label="Discount code (optional)"><input value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field></div>
          <div className="row"><button className="btn primary" onClick={checkout}>Continue to payment</button>{paid && <button className="btn" onClick={portal}>Manage subscription</button>}</div>
          <p className="muted small">Payments are handled by Stripe. You can cancel any time; boosts last until the end of the paid period.</p>
        </> : <p className="muted">Paid boosts aren't available on this server yet. Ask the SEND team for a code.</p>}
      </div>
      {p.staff && <StaffPremium />}
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
    <div className="row wrap"><select value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Kind"><option value="free">Free boosts (developer code)</option><option value="discount">Discount at checkout</option></select>
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
