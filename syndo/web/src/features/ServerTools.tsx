import { useEffect, useMemo, useState } from "react";
import { Bot, Copy, Plus, RefreshCw, ShieldCheck, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { ChannelType, P, has, type Application, type AutomodRule, type Channel, type ForumTag, type Guild, type Onboarding, type Webhook } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { guildPerms, toast } from "../store.ts";
import { Avatar, Field, Toggle } from "../components/ui.tsx";
import { askConfirm } from "../components/overlay.tsx";
import { BoostPerks } from "./Boosts.tsx";

const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); return true; } catch (e) { toast(errMsg(e), "error"); return false; } };
const textChannels = (g: Guild) => g.channels.filter((c) => c.type === ChannelType.TEXT || c.type === ChannelType.ANNOUNCEMENT);

/** A Discord-style "Careful — you have unsaved changes!" bar. */
export function UnsavedBar({ dirty, onReset, onSave, busy }: { dirty: boolean; onReset: () => void; onSave: () => void; busy?: boolean }) {
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", on); return () => window.removeEventListener("beforeunload", on);
  }, [dirty]);
  if (!dirty) return null;
  return <div className="unsaved-bar" role="status"><span>Careful — you have unsaved changes!</span><button className="link" onClick={onReset}>Reset</button><button className="btn primary sm" disabled={busy} onClick={onSave}>Save changes</button></div>;
}

/* ----------------------------------------------------------------------------- AutoMod -- */
const TRIGGERS: Record<number, string> = { 1: "Custom words", 4: "Commonly flagged words", 3: "Spam (repeated messages)", 5: "Mention spam" };
export function AutoModTab({ guild }: { guild: Guild }) {
  const [rules, setRules] = useState<AutomodRule[] | null>(null);
  const [edit, setEdit] = useState<Partial<AutomodRule> | null>(null);
  const [test, setTest] = useState(""); const [testRes, setTestRes] = useState<{ rule: string; matched: string }[] | null>(null);
  const load = () => api.get<AutomodRule[]>(`/api/guilds/${guild.id}/automod/rules`).then(setRules).catch(() => setRules([]));
  useEffect(() => { load(); }, [guild.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, enabled: edit.enabled ?? true, trigger_type: edit.trigger_type, trigger_meta: edit.trigger_meta ?? {}, actions: edit.actions ?? [{ type: 1 }], exempt_roles: edit.exempt_roles ?? [], exempt_channels: edit.exempt_channels ?? [] };
    if (await run(() => (edit.id ? api.patch(`/api/guilds/${guild.id}/automod/rules/${edit.id}`, body) : api.post(`/api/guilds/${guild.id}/automod/rules`, body)), "Rule saved.")) { setEdit(null); load(); }
  };
  const actions = edit?.actions ?? [{ type: 1 }];
  const hasAct = (t: number) => actions.some((a) => a.type === t);
  const toggleAct = (t: 1 | 2 | 3, on: boolean, extra: any = {}) => setEdit({ ...edit!, actions: on ? [...actions.filter((a) => a.type !== t), { type: t, ...extra }] : actions.filter((a) => a.type !== t) });
  const patchAct = (t: number, p: any) => setEdit({ ...edit!, actions: actions.map((a) => (a.type === t ? { ...a, ...p } : a)) });
  return (
    <div className="settings-section">
      <h2><ShieldCheck size={20} /> AutoMod</h2>
      <p className="muted">Stop messages before anyone sees them. Admins and people with Manage Server are never filtered.</p>
      {!edit && <div className="row wrap">{[1, 4, 3, 5].map((t) => <button key={t} className="btn" onClick={() => setEdit({ name: TRIGGERS[t], trigger_type: t as any, trigger_meta: t === 4 ? { presets: ["profanity", "slurs"] } : t === 5 ? { mention_limit: 10 } : { keywords: [] }, actions: [{ type: 1 }], enabled: true })}><Plus size={14} /> {TRIGGERS[t]}</button>)}</div>}
      {edit && <div className="card">
        <Field label="Rule name"><input value={edit.name ?? ""} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        {edit.trigger_type === 1 && <>
          <Field label="Words and phrases" hint="Comma separated. word = whole word, word* = starts with, *word = ends with, *word* = anywhere."><textarea rows={3} value={(edit.trigger_meta?.keywords ?? []).join(", ")} onChange={(e) => setEdit({ ...edit, trigger_meta: { ...edit.trigger_meta, keywords: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} /></Field>
          <Field label="Patterns (advanced, optional)" hint="One regular expression per line."><textarea rows={2} value={(edit.trigger_meta?.regex ?? []).join("\n")} onChange={(e) => setEdit({ ...edit, trigger_meta: { ...edit.trigger_meta, regex: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) } })} /></Field>
        </>}
        {edit.trigger_type === 4 && <fieldset className="radio-list"><legend>Lists</legend>{(["profanity", "sexual", "slurs"] as const).map((p) => <label key={p}><input type="checkbox" checked={(edit.trigger_meta?.presets ?? []).includes(p)} onChange={(e) => setEdit({ ...edit, trigger_meta: { ...edit.trigger_meta, presets: e.target.checked ? [...(edit.trigger_meta?.presets ?? []), p] : (edit.trigger_meta?.presets ?? []).filter((x) => x !== p) } })} /> {p === "profanity" ? "Insults and swearing" : p === "sexual" ? "Sexual content" : "Slurs"}</label>)}</fieldset>}
        {(edit.trigger_type === 1 || edit.trigger_type === 4) && <Field label="Allowed words (exceptions)"><input value={(edit.trigger_meta?.allow ?? []).join(", ")} onChange={(e) => setEdit({ ...edit, trigger_meta: { ...edit.trigger_meta, allow: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} /></Field>}
        {edit.trigger_type === 5 && <Field label="Unique mentions per message"><input type="number" min={1} max={50} value={edit.trigger_meta?.mention_limit ?? 10} onChange={(e) => setEdit({ ...edit, trigger_meta: { mention_limit: Number(e.target.value) } })} /></Field>}
        <h4>Responses</h4>
        <Toggle label="Block the message" checked={hasAct(1)} onChange={(v) => toggleAct(1, v)} />
        {hasAct(1) && <Field label="Custom reply (optional)"><input maxLength={150} value={actions.find((a) => a.type === 1)?.message ?? ""} onChange={(e) => patchAct(1, { message: e.target.value })} placeholder="Your message was blocked by AutoMod." /></Field>}
        <Toggle label="Send an alert to a channel" checked={hasAct(2)} onChange={(v) => toggleAct(2, v, { channel_id: textChannels(guild)[0]?.id })} />
        {hasAct(2) && <select value={actions.find((a) => a.type === 2)?.channel_id ?? ""} onChange={(e) => patchAct(2, { channel_id: e.target.value })} aria-label="Alert channel">{textChannels(guild).map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>}
        <Toggle label="Time out the member" checked={hasAct(3)} onChange={(v) => toggleAct(3, v, { duration_seconds: 60 })} />
        {hasAct(3) && <select value={actions.find((a) => a.type === 3)?.duration_seconds ?? 60} onChange={(e) => patchAct(3, { duration_seconds: Number(e.target.value) })} aria-label="Timeout length">{[[60, "60 seconds"], [300, "5 minutes"], [600, "10 minutes"], [3600, "1 hour"], [86400, "1 day"], [604800, "1 week"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
        <h4>Exceptions</h4>
        <Field label="Roles that skip this rule"><select multiple value={edit.exempt_roles ?? []} onChange={(e) => setEdit({ ...edit, exempt_roles: [...e.target.selectedOptions].map((o) => o.value) })}>{guild.roles.filter((r) => r.id !== guild.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Channels where it doesn't apply"><select multiple value={edit.exempt_channels ?? []} onChange={(e) => setEdit({ ...edit, exempt_channels: [...e.target.selectedOptions].map((o) => o.value) })}>{guild.channels.filter((c) => c.type !== ChannelType.CATEGORY).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <div className="row"><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save rule</button></div>
      </div>}
      {rules?.map((r) => <div key={r.id} className="card rule-row">
        <div className="grow"><strong>{r.name}</strong><small className="muted block">{TRIGGERS[r.trigger_type]} · {r.actions.map((a) => (a.type === 1 ? "block" : a.type === 2 ? "alert" : "timeout")).join(", ")}</small></div>
        <Toggle label="On" checked={r.enabled} onChange={(v) => run(() => api.patch(`/api/guilds/${guild.id}/automod/rules/${r.id}`, { enabled: v })).then(load)} />
        <button className="btn sm" onClick={() => setEdit(r)}>Edit</button>
        <button className="icon-btn sm danger" aria-label="Delete rule" onClick={async () => { if (await askConfirm({ title: `Delete “${r.name}”?`, confirmLabel: "Delete", danger: true })) run(() => api.del(`/api/guilds/${guild.id}/automod/rules/${r.id}`)).then(load); }}><Trash2 size={14} /></button>
      </div>)}
      {rules && rules.length > 0 && <div className="card"><h4>Try it</h4><div className="row"><input value={test} onChange={(e) => setTest(e.target.value)} placeholder="Type a message to test the word rules" /><button className="btn sm" onClick={() => api.post<{ matches: any[] }>(`/api/guilds/${guild.id}/automod/test`, { content: test }).then((r) => setTestRes(r.matches))}>Test</button></div>
        {testRes && <p className="small">{testRes.length ? testRes.map((m) => `“${m.matched}” (${m.rule})`).join(", ") : "Nothing would be caught."}</p>}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------------- onboarding -- */
export function OnboardingTab({ guild }: { guild: Guild }) {
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [orig, setOrig] = useState("");
  useEffect(() => { api.get<Onboarding>(`/api/guilds/${guild.id}/onboarding`).then((o) => { setOb(o); setOrig(JSON.stringify(o)); }); }, [guild.id]);
  if (!ob) return <p className="muted">Loading…</p>;
  const dirty = JSON.stringify(ob) !== orig;
  const save = () => run(() => api.put<Onboarding>(`/api/guilds/${guild.id}/onboarding`, ob).then((o) => { setOb(o); setOrig(JSON.stringify(o)); }), "Onboarding saved.");
  const screening = ob.screening ?? { enabled: false, description: "", rules: [] };
  const roles = guild.roles.filter((r) => r.id !== guild.id);
  return (
    <div className="settings-section">
      <h2>Onboarding</h2>
      <p className="muted">What new members see when they join.</p>
      <div className="card">
        <h3>Rules screening</h3>
        <Toggle label="Members must accept the rules before taking part" hint="Until they agree they can read but not send messages, react or join voice." checked={screening.enabled} onChange={(v) => setOb({ ...ob, screening: { ...screening, enabled: v } })} />
        <Field label="Intro"><input maxLength={300} value={screening.description} onChange={(e) => setOb({ ...ob, screening: { ...screening, description: e.target.value } })} /></Field>
        {screening.rules.map((r, i) => <div key={i} className="row"><span>{i + 1}.</span><input className="grow" maxLength={300} value={r} onChange={(e) => setOb({ ...ob, screening: { ...screening, rules: screening.rules.map((x, j) => (j === i ? e.target.value : x)) } })} /><button className="icon-btn sm" aria-label="Remove rule" onClick={() => setOb({ ...ob, screening: { ...screening, rules: screening.rules.filter((_, j) => j !== i) } })}><Trash2 size={14} /></button></div>)}
        {screening.rules.length < 16 && <button className="btn sm" onClick={() => setOb({ ...ob, screening: { ...screening, rules: [...screening.rules, ""] } })}><Plus size={14} /> Add a rule</button>}
      </div>
      <div className="card">
        <h3>Questions</h3>
        <Toggle label="Ask new members questions" hint="Each answer can give roles (and through them, channels)." checked={ob.enabled} onChange={(v) => setOb({ ...ob, enabled: v })} />
        {ob.prompts.map((p, i) => <div key={p.id ?? i} className="card inner">
          <div className="row"><input className="grow" placeholder="Question" value={p.title} onChange={(e) => setOb({ ...ob, prompts: ob.prompts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <label className="small"><input type="checkbox" checked={p.single_select} onChange={(e) => setOb({ ...ob, prompts: ob.prompts.map((x, j) => (j === i ? { ...x, single_select: e.target.checked } : x)) })} /> One answer</label>
            <label className="small"><input type="checkbox" checked={p.required} onChange={(e) => setOb({ ...ob, prompts: ob.prompts.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> Required</label>
            <button className="icon-btn sm" aria-label="Remove question" onClick={() => setOb({ ...ob, prompts: ob.prompts.filter((_, j) => j !== i) })}><Trash2 size={14} /></button></div>
          {p.options.map((o, k) => <div key={o.id ?? k} className="row wrap">
            <input style={{ width: 52 }} placeholder="🙂" value={o.emoji ?? ""} onChange={(e) => setOb({ ...ob, prompts: ob.prompts.map((x, j) => (j === i ? { ...x, options: x.options.map((y, l) => (l === k ? { ...y, emoji: e.target.value || null } : y)) } : x)) })} aria-label="Emoji" />
            <input placeholder="Answer" value={o.title} onChange={(e) => setOb({ ...ob, prompts: ob.prompts.map((x, j) => (j === i ? { ...x, options: x.options.map((y, l) => (l === k ? { ...y, title: e.target.value } : y)) } : x)) })} />
            <select multiple value={o.role_ids} onChange={(e) => { const ids = [...e.target.selectedOptions].map((x) => x.value); setOb({ ...ob, prompts: ob.prompts.map((x, j) => (j === i ? { ...x, options: x.options.map((y, l) => (l === k ? { ...y, role_ids: ids } : y)) } : x)) }); }} aria-label="Roles given">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            <button className="icon-btn sm" aria-label="Remove answer" onClick={() => setOb({ ...ob, prompts: ob.prompts.map((x, j) => (j === i ? { ...x, options: x.options.filter((_, l) => l !== k) } : x)) })}><Trash2 size={14} /></button>
          </div>)}
          <button className="btn sm" onClick={() => setOb({ ...ob, prompts: ob.prompts.map((x, j) => (j === i ? { ...x, options: [...x.options, { id: String(Date.now()), title: "", description: null, emoji: null, role_ids: [], channel_ids: [] }] } : x)) })}><Plus size={14} /> Add an answer</button>
        </div>)}
        <button className="btn sm" onClick={() => setOb({ ...ob, prompts: [...ob.prompts, { id: String(Date.now()), title: "", single_select: false, required: false, options: [{ id: String(Date.now() + 1), title: "", description: null, emoji: null, role_ids: [], channel_ids: [] }] }] })}><Plus size={14} /> Add a question</button>
        <Field label="Default channels everyone sees"><select multiple value={ob.default_channel_ids} onChange={(e) => setOb({ ...ob, default_channel_ids: [...e.target.selectedOptions].map((o) => o.value) })}>{guild.channels.filter((c) => c.type !== ChannelType.CATEGORY).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <div className="card">
        <h3>Welcome screen</h3>
        <Toggle label="Show a welcome screen" checked={!!ob.welcome} onChange={(v) => setOb({ ...ob, welcome: v ? { description: "", channels: [] } : null })} />
        {ob.welcome && <>
          <Field label="Description"><textarea rows={2} maxLength={300} value={ob.welcome.description} onChange={(e) => setOb({ ...ob, welcome: { ...ob.welcome!, description: e.target.value } })} /></Field>
          {ob.welcome.channels.map((w, i) => <div key={i} className="row wrap">
            <input style={{ width: 52 }} value={w.emoji ?? ""} placeholder="👋" onChange={(e) => setOb({ ...ob, welcome: { ...ob.welcome!, channels: ob.welcome!.channels.map((x, j) => (j === i ? { ...x, emoji: e.target.value || null } : x)) } })} aria-label="Emoji" />
            <select value={w.channel_id} onChange={(e) => setOb({ ...ob, welcome: { ...ob.welcome!, channels: ob.welcome!.channels.map((x, j) => (j === i ? { ...x, channel_id: e.target.value } : x)) } })} aria-label="Channel">{textChannels(guild).map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>
            <input className="grow" maxLength={60} placeholder="What it's for" value={w.description} onChange={(e) => setOb({ ...ob, welcome: { ...ob.welcome!, channels: ob.welcome!.channels.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) } })} />
            <button className="icon-btn sm" aria-label="Remove" onClick={() => setOb({ ...ob, welcome: { ...ob.welcome!, channels: ob.welcome!.channels.filter((_, j) => j !== i) } })}><Trash2 size={14} /></button>
          </div>)}
          {ob.welcome.channels.length < 5 && <button className="btn sm" onClick={() => setOb({ ...ob, welcome: { ...ob.welcome!, channels: [...ob.welcome!.channels, { channel_id: textChannels(guild)[0]?.id ?? "", description: "", emoji: null }] } })}><Plus size={14} /> Add a channel</button>}
        </>}
      </div>
      <UnsavedBar dirty={dirty} onReset={() => setOb(JSON.parse(orig))} onSave={save} />
    </div>
  );
}

/* ----------------------------------------------------------------------------- insights -- */
export function InsightsTab({ guild }: { guild: Guild }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); api.get(`/api/guilds/${guild.id}/insights?days=${days}`).then(setD).catch((e) => toast(errMsg(e), "error")); }, [guild.id, days]);
  const chart = (key: string, label: string) => {
    const max = Math.max(1, ...d.series.map((x: any) => x[key]));
    return <div className="card"><h4>{label}</h4><div className="bars" role="img" aria-label={`${label} per day`}>{d.series.map((x: any) => <i key={x.day} style={{ height: `${(x[key] / max) * 100}%` }} title={`${x.day}: ${x[key]}`} />)}</div></div>;
  };
  return (
    <div className="settings-section">
      <h2>Server Insights</h2>
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
      {!d ? <p className="muted">Loading…</p> : <>
        <div className="stat-row">
          <div className="stat"><strong>{d.members}</strong><span>Members</span></div>
          <div className="stat"><strong>{d.new_members}</strong><span>New members</span></div>
          <div className="stat"><strong>{d.totals.messages}</strong><span>Messages</span></div>
          <div className="stat"><strong>{d.retention ?? "—"}{d.retention != null ? "%" : ""}</strong><span>New members still active after a week</span></div>
        </div>
        {chart("messages", "Messages")}
        {chart("active", "Members who talked")}
        {chart("joins", "Joins")}
        {chart("leaves", "Leaves")}
        <div className="card"><h4>Most active channels</h4>{d.top_channels.map((c: any) => <div key={c.id} className="row"><span className="grow">#{c.name}</span><span className="muted">{c.messages}</span></div>)}</div>
      </>}
    </div>
  );
}

/* ---------------------------------------------------------------------- integrations -- */
export function IntegrationsTab({ guild }: { guild: Guild }) {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [cmds, setCmds] = useState<{ app: { id: string; name: string } }[]>([]);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const load = () => { api.get<Webhook[]>(`/api/guilds/${guild.id}/webhooks`).then(setHooks).catch(() => setHooks([])); api.get(`/api/guilds/${guild.id}/commands`).then(setCmds).catch(() => {}); };
  useEffect(load, [guild.id]);
  const bots = useMemo(() => [...new Map(cmds.filter((c) => c.app).map((c) => [c.app.id, c.app])).values()], [cmds]);
  const create = async () => {
    const ch = textChannels(guild)[0]; if (!ch) return;
    try { const w = await api.post<Webhook>(`/api/channels/${ch.id}/webhooks`, { name: "Webhook" }); setNewUrl(location.origin + w.url); load(); } catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <div className="settings-section">
      <h2>Integrations</h2>
      <div className="card"><h3><Bot size={18} /> Apps in this server</h3>
        {!bots.length ? <p className="muted">No apps with commands yet. Add apps from the App Directory (Settings → Apps).</p> : bots.map((a) => <div key={a.id} className="row"><Bot size={16} /> <strong>{a.name}</strong></div>)}
      </div>
      <div className="card"><h3><WebhookIcon size={18} /> Webhooks</h3>
        <p className="muted small">Webhooks let other services post messages into a channel with a secret URL.</p>
        <button className="btn primary sm" onClick={create}><Plus size={14} /> New webhook</button>
        {newUrl && <div className="secret-box"><p className="small">Copy the URL now — it's shown only once.</p><code>{newUrl}</code><button className="btn sm" onClick={() => { navigator.clipboard.writeText(newUrl); toast("Copied.", "success"); }}><Copy size={14} /> Copy</button></div>}
        {hooks?.map((w) => <WebhookRow key={w.id} w={w} guild={guild} onChange={load} onUrl={setNewUrl} />)}
      </div>
    </div>
  );
}
function WebhookRow({ w, guild, onChange, onUrl }: { w: Webhook; guild: Guild; onChange: () => void; onUrl: (u: string) => void }) {
  const [name, setName] = useState(w.name);
  return <div className="hook-row">
    <Avatar user={{ id: w.id, username: w.name, display_name: w.name, avatar: w.avatar, banner: null, bio: "", pronouns: "", accent_color: null, profile_theme: null }} size={32} />
    {w.type === 2 ? <span className="grow">Following <strong>{w.source_channel?.guild_name} #{w.source_channel?.name}</strong> → #{guild.channels.find((c) => c.id === w.channel_id)?.name}</span> : <>
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== w.name && run(() => api.patch(`/api/webhooks/${w.id}`, { name })).then(onChange)} aria-label="Webhook name" />
      <select value={w.channel_id} onChange={(e) => run(() => api.patch(`/api/webhooks/${w.id}`, { channel_id: e.target.value })).then(onChange)} aria-label="Channel">{textChannels(guild).map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>
      <button className="btn sm" title="Make a new URL (the old one stops working)" onClick={() => api.post<Webhook>(`/api/webhooks/${w.id}/reset-token`).then((x) => onUrl(location.origin + x.url!)).catch((e) => toast(errMsg(e), "error"))}><RefreshCw size={14} /> New URL</button>
    </>}
    <button className="icon-btn sm danger" aria-label="Delete webhook" onClick={async () => { if (await askConfirm({ title: `Delete ${w.name}?`, confirmLabel: "Delete", danger: true })) run(() => api.del(`/api/webhooks/${w.id}`)).then(onChange); }}><Trash2 size={14} /></button>
  </div>;
}

/* ---------------------------------------------------------------------------- discovery -- */
const CATS = ["gaming", "music", "education", "science", "entertainment", "creative", "technology", "anime", "sports", "community", "language", "other"];
export function DiscoveryTab({ guild }: { guild: Guild }) {
  const [cat, setCat] = useState(guild.discovery_category ?? "");
  const [kw, setKw] = useState((guild.discovery_keywords ?? []).join(", "));
  const save = (discoverable?: boolean) => run(() => api.patch(`/api/guilds/${guild.id}/discovery`, { discoverable, category: cat || null, keywords: kw.split(",").map((x) => x.trim()).filter(Boolean) }), "Saved.");
  return <div className="settings-section">
    <h2>Discovery</h2>
    <p className="muted">List {guild.name} in Server Discovery so anyone can find and join it. Needs a description (Overview) and at least 3 members.</p>
    <Toggle label="Show in Server Discovery" checked={guild.discoverable} onChange={(v) => save(v)} />
    <Field label="Category"><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Pick one</option>{CATS.map((c) => <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>)}</select></Field>
    <Field label="Keywords" hint="Up to 10, comma separated."><input value={kw} onChange={(e) => setKw(e.target.value)} /></Field>
    <button className="btn primary" onClick={() => save()}>Save</button>
  </div>;
}

/* ------------------------------------------------------------------------ boost status -- */
export function BoostStatusTab({ guild }: { guild: Guild }) {
  return <div className="settings-section"><h2>Server Boost status</h2><p className="muted">{guild.premium_count ?? 0} boosts · Level {guild.premium_tier ?? 0}</p><BoostPerks tier={guild.premium_tier ?? 0} /></div>;
}

/* ----------------------------------------------------------------------------- prune -- */
export function PruneSection({ guild }: { guild: Guild }) {
  const [days, setDays] = useState(30);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { setCount(null); api.get<{ pruned: number }>(`/api/guilds/${guild.id}/prune?days=${days}`).then((r) => setCount(r.pruned)).catch(() => {}); }, [guild.id, days]);
  if (!has(guildPerms(guild), P.KICK_MEMBERS)) return null;
  return <div className="card"><h3>Prune inactive members</h3>
    <p className="muted small">Removes members without roles who haven't said anything or joined voice for this long. They can rejoin with an invite.</p>
    <div className="row"><select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Inactive for">{[7, 30, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
      <span className="muted">{count === null ? "Counting…" : `${count} member${count === 1 ? "" : "s"} would be removed`}</span>
      <button className="btn danger sm" disabled={!count} onClick={async () => { if (await askConfirm({ title: `Remove ${count} inactive members?`, confirmLabel: "Prune", danger: true })) run(() => api.post(`/api/guilds/${guild.id}/prune`, { days }), "Done.").then(() => setCount(0)); }}>Prune</button></div>
  </div>;
}

/* --------------------------------------------------------------------------- forum tags -- */
export function ForumTab({ guild }: { guild: Guild }) {
  const forums = guild.channels.filter((c) => c.type === ChannelType.FORUM || c.type === ChannelType.MEDIA);
  if (!forums.length) return <div className="settings-section"><h2>Forums</h2><p className="muted">Create a Forum or Media channel first.</p></div>;
  return <div className="settings-section"><h2>Forum & media channels</h2>{forums.map((f) => <ForumEditor key={f.id} c={f} />)}</div>;
}
function ForumEditor({ c }: { c: Channel }) {
  const [tags, setTags] = useState<ForumTag[]>(c.available_tags ?? []);
  const [req, setReq] = useState(!!c.require_tag);
  const [sort, setSort] = useState(c.default_sort ?? 0);
  const [react, setReact] = useState(c.default_reaction ?? "");
  const save = () => run(() => api.patch(`/api/channels/${c.id}/forum`, { available_tags: tags.map((t) => ({ ...(t.id && !t.id.startsWith("new") ? { id: t.id } : {}), name: t.name, emoji: t.emoji, moderated: t.moderated })), require_tag: req, default_sort: sort, default_reaction: react || null }), "Saved.");
  return <div className="card"><h3>#{c.name}</h3>
    {tags.map((t, i) => <div key={t.id} className="row"><input style={{ width: 52 }} value={t.emoji ?? ""} placeholder="🏷️" onChange={(e) => setTags(tags.map((x, j) => (j === i ? { ...x, emoji: e.target.value || null } : x)))} aria-label="Emoji" /><input maxLength={20} value={t.name} onChange={(e) => setTags(tags.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Tag name" /><label className="small"><input type="checkbox" checked={t.moderated} onChange={(e) => setTags(tags.map((x, j) => (j === i ? { ...x, moderated: e.target.checked } : x)))} /> Moderators only</label><button className="icon-btn sm" aria-label="Remove tag" onClick={() => setTags(tags.filter((_, j) => j !== i))}><Trash2 size={14} /></button></div>)}
    {tags.length < 20 && <button className="btn sm" onClick={() => setTags([...tags, { id: `new${Date.now()}`, name: "", emoji: null, moderated: false }])}><Plus size={14} /> Add a tag</button>}
    <Toggle label="Posts need a tag" checked={req} onChange={setReq} />
    <Field label="Default sort"><select value={sort} onChange={(e) => setSort(Number(e.target.value) as 0 | 1)}><option value={0}>Recently active</option><option value={1}>Date posted</option></select></Field>
    <Field label="Default reaction (optional)"><input value={react} onChange={(e) => setReact(e.target.value)} placeholder="👍" /></Field>
    <button className="btn primary sm" onClick={save}>Save</button>
  </div>;
}
export type { Application };
