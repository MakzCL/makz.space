import { Select } from "../components/Select.tsx";
import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { Check, Crown, Flame, Gem, Gift, Headphones, Heart, Leaf, Moon, Star, Zap, Image as ImageIcon, KeyRound, MonitorUp, Smile, Sparkles, Trash2, Upload, Volume2 } from "lucide-react";
import { BOOST_EXTRA_PERKS, BOOST_LEVELS, P, TAG_BADGES, activePerk, has, type BoostExtraPerkId, type Guild, type GuildPerks, type TagBadge, type User } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { guildPerms, onEvent, toast, useStore } from "../store.ts";
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

/** Under the server name (when the server turns it on): level, boost count and the road to Level 3. */
export function ServerBoostBar({ guild }: { guild: Guild }) {
  const count = guild.premium_count ?? 0, tier = guild.premium_tier ?? 0;
  const max = BOOST_LEVELS[BOOST_LEVELS.length - 1]!.boosts;
  const next = BOOST_LEVELS.find((l) => l.boosts > count);
  const accent = activePerk(guild, "accent");
  return (
    <button className="server-boost-bar" style={accent ? ({ "--sbb-a": accent, "--sbb-b": `color-mix(in srgb, ${accent} 60%, #FFFFFF)` } as CSSProperties) : undefined} onClick={() => openBoostServer(guild)}
      title={next ? `${next.boosts - count} more for Level ${next.level}` : "Max level reached"}
      aria-label={`${tier ? `Level ${tier}` : "No boost level yet"}, ${count} boosts. ${next ? `${next.boosts - count} more for Level ${next.level}.` : "Max level."} Open Server Boost`}>
      <span className="sbb-top"><Sparkles size={15} /><b>{tier ? `Level ${tier}` : "Server Boost"}</b><span className="sbb-count">{count} {count === 1 ? "boost" : "boosts"}</span></span>
      <span className="sbb-track" aria-hidden>
        <i style={{ width: `${Math.min(100, (count / max) * 100)}%` }} />
        {BOOST_LEVELS.slice(1).map((l) => <em key={l.level} className={count >= l.boosts ? "on" : ""} style={{ left: `${(l.boosts / max) * 100}%` }}>{l.level}</em>)}
      </span>
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

const BADGE_ICONS: Record<TagBadge, typeof Star> = { star: Star, flame: Flame, bolt: Zap, heart: Heart, leaf: Leaf, moon: Moon, crown: Crown, gem: Gem };

/** The badge next to a server's tag (Server tag badge perk). Nothing when the perk isn't on. */
export function TagBadgeIcon({ guild, size = 12 }: { guild: Guild; size?: number }) {
  const b = activePerk(guild, "tag_badge");
  if (!b || !BADGE_ICONS[b]) return null;
  const Icon = BADGE_ICONS[b];
  return <Icon className="tag-badge" size={size} aria-label={`${b} badge`} />;
}

/** Server colour perk: CSS variables for the server's own colour, or nothing. */
export const accentVars = (guild: Guild): CSSProperties | undefined => {
  const a = activePerk(guild, "accent");
  return a ? ({ "--srv-accent": a } as CSSProperties) : undefined;
};

const ACCENTS = ["#3D6BFF", "#22CC88", "#FFC93C", "#FF5C5C", "#B05CFF", "#FF8FD1", "#2EC4D6", "#FF8A3D"];

function ExtraPerks({ guild, canManage }: { guild: Guild; canManage: boolean }) {
  const count = guild.premium_count ?? 0;
  const [busy, setBusy] = useState(false);
  const save = async (perks: Partial<GuildPerks>, msg: string) => {
    setBusy(true);
    try { await api.patch(`/api/guilds/${guild.id}`, { perks }); toast(msg, "success"); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  const art = (id: BoostExtraPerkId) => {
    const badge = guild.perks?.tag_badge ?? "star", Badge = BADGE_ICONS[badge] ?? Star;
    if (id === "tag_badge") return <span className="xp-tag"><Badge size={14} />{guild.tag || "SEND"}</span>;
    if (id === "animated_roles") return <span className="xp-role role-anim" style={{ backgroundImage: "linear-gradient(90deg, #5B8CFF, #FF8FD1, #FFC93C, #5B8CFF)" }}>Moderator</span>;
    return <span className="xp-swatches">{ACCENTS.slice(0, 5).map((c) => <i key={c} style={{ background: c }} className={guild.perks?.accent === c ? "on" : ""} />)}</span>;
  };
  return (
    <div className="xp-grid">
      {BOOST_EXTRA_PERKS.map((def) => {
        const afford = count >= def.boosts, on = !!activePerk(guild, def.id), set = !!guild.perks?.[def.id];
        return <article key={def.id} className={`xp-card ${on ? "on" : ""}`} aria-label={`${def.name}${on ? ", enabled" : ""}`}>
          <div className="xp-art" aria-hidden>{art(def.id)}</div>
          <div className="xp-body">
            <h4>{def.name}</h4>
            <p className="muted small">{def.description}</p>
            {canManage && afford && def.id === "tag_badge" && <div className="xp-pick" role="group" aria-label="Badge">{TAG_BADGES.map((b) => { const I = BADGE_ICONS[b]; return <button key={b} disabled={busy} className={guild.perks?.tag_badge === b ? "on" : ""} aria-pressed={guild.perks?.tag_badge === b} aria-label={b} title={b} onClick={() => save({ tag_badge: guild.perks?.tag_badge === b ? null : b }, guild.perks?.tag_badge === b ? "Badge removed." : "Badge set.")}><I size={15} /></button>; })}</div>}
            {canManage && afford && def.id === "accent" && <div className="xp-pick" role="group" aria-label="Server colour">{ACCENTS.map((c) => <button key={c} disabled={busy} className={`sw ${guild.perks?.accent === c ? "on" : ""}`} style={{ background: c }} aria-pressed={guild.perks?.accent === c} aria-label={c} onClick={() => save({ accent: guild.perks?.accent === c ? null : c }, guild.perks?.accent === c ? "Server colour removed." : "Server colour set.")} />)}<label className="sw custom" title="Custom colour"><input type="color" value={guild.perks?.accent ?? "#B05CFF"} onChange={(e) => save({ accent: e.target.value.toUpperCase() }, "Server colour set.")} aria-label="Custom colour" /></label></div>}
            {canManage && afford && def.id === "animated_roles" && <div className="xp-toggle"><Toggle label="Animate gradient roles" disabled={busy} checked={!!guild.perks?.animated_roles} onChange={(v) => save({ animated_roles: v }, v ? "Role colours now animate." : "Role colours are still.")} /></div>}
            <div className="xp-foot">
              <span className="xp-cost"><Sparkles size={13} /> {def.boosts} Boosts</span>
              {on ? <span className="xp-state on"><Check size={14} /> Enabled</span>
                : !afford ? <span className="xp-state">{def.boosts - count} more {def.boosts - count === 1 ? "boost" : "boosts"} needed</span>
                : set ? <span className="xp-state">Off</span>
                : <span className="xp-state">{canManage ? "Pick one to enable" : "Not turned on"}</span>}
            </div>
          </div>
        </article>;
      })}
    </div>
  );
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
  const canManage = has(guildPerms(live), P.MANAGE_GUILD);
  const spent = p ? p.boosts.filter((b) => b.guild_id).length : 0;
  const getBoosts = () => { onClose(); window.dispatchEvent(new CustomEvent("send:dialog", { detail: { kind: "userSettings", tab: "boosts" } })); };
  const perks = (l: (typeof BOOST_LEVELS)[number]): [JSX.Element, string][] => [
    [<Smile size={15} />, `${l.emoji} emoji slots`], [<Volume2 size={15} />, `${l.sounds} soundboard slots`],
    [<Upload size={15} />, `${l.upload_mb} MB uploads`], [<Headphones size={15} />, `${l.bitrate_kbps} kbps voice`],
    [<MonitorUp size={15} />, `${l.stream} screen share`], ...(l.animated_banner ? [[<ImageIcon size={15} />, "Animated banner & badge"] as [JSX.Element, string]] : []),
  ];
  return (
    <Modal title={<><Sparkles size={20} /> Server Boost</>} label="Server Boost" wide onClose={onClose}>
      <div className="boost-page">
        <div className="bp-main">
          <h3>Levels</h3>
          <p className="muted small">{guild.name} levels up on its own once it has enough boosts. {next ? `${next.boosts - count} more for Level ${next.level}.` : "It's at the top level."}</p>
          <div className="bp-levels">
            {BOOST_LEVELS.slice(1).map((l) => {
              const got = count >= l.boosts, prev = BOOST_LEVELS[l.level - 1]!.boosts;
              const fill = got ? 100 : Math.max(0, Math.min(100, ((count - prev) / (l.boosts - prev)) * 100));
              return <article key={l.level} className={`bp-level ${got ? "got" : ""} ${tier === l.level ? "cur" : ""}`} aria-label={`Level ${l.level}${got ? ", unlocked" : ""}`}>
                <div className="bp-track"><span className="bp-gem" aria-hidden><Sparkles size={14} /></span><i aria-hidden><b style={{ width: `${fill}%` }} /></i></div>
                <h4>Level {l.level}{got && <small className="tag">Unlocked</small>}</h4>
                <ul>{perks(l).map(([icon, text]) => <li key={text}>{icon}<span>{text}</span></li>)}</ul>
                <p className="bp-cost"><Sparkles size={14} /> {l.boosts} Boosts</p>
              </article>;
            })}
          </div>
          <h3>Additional perks</h3>
          <p className="muted small">Extras that only need enough boosts, whatever the level. {canManage ? "Turn them on here." : "People who can manage the server turn them on."}</p>
          <ExtraPerks guild={live} canManage={canManage} />
          {boosters.length > 0 && <><h3>Boosting this server</h3><div className="boosters">{boosters.map((b) => <div key={b.user.id} className="member"><Avatar user={b.user} size={28} /><span className="ellipsis">{b.user.display_name || b.user.username}</span><small className="muted">{b.boosts}× · since {new Date(b.since).toLocaleDateString()}</small></div>)}</div></>}
        </div>
        <aside className="bp-side" aria-label="Your boosts">
          <h3>Your boosts</h3>
          <div className="bp-stats">
            <div><b><Sparkles size={14} /> {free.length}</b><small>Available</small></div>
            <div><b>{spent}</b><small>Spent</small></div>
            <div><b>{p?.boosts.length ?? 0}</b><small>Total</small></div>
          </div>
          {free.length > 0 ? <>
            <button className="btn primary bp-boost" onClick={() => apply(1)}><Sparkles size={16} /> Boost this server</button>
            {free.length > 1 && <button className="btn bp-boost" onClick={() => apply(free.length)}>Use all {free.length}</button>}
          </> : <button className="btn primary bp-boost" onClick={getBoosts}><Sparkles size={16} /> Get boosts</button>}
          <p className="muted small">{count} {count === 1 ? "boost" : "boosts"} on this server · {tier ? `Level ${tier}` : "no level yet"}</p>
        </aside>
      </div>
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
