import { askConfirm, askText } from "./overlay.tsx";
import { Select } from "./Select.tsx";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChannelType, EXPRESSION_LIMITS, P, PERMISSION_INFO, has, isVoiceType, type Channel, type Guild, type Invite, type Member, type Role } from "@syndo/shared";
import { emojiNameFrom, pickFile, playClip, uploadEmoji, uploadSound } from "../expressions.ts";
import { Range } from "./Range.tsx";
import { api, errMsg, upload } from "../api.ts";
import { loadMembers } from "../actions.ts";
import { navigate } from "../router.ts";
import { displayName, guildPerms, toast, useStore } from "../store.ts";
import { Avatar, Field, Modal, Toggle } from "./ui.tsx";

const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); return true; } catch (e) { toast(errMsg(e), "error"); return false; } };

export function ServerSettings({ guildId, tab: initial, onClose }: { guildId: string; tab?: string; onClose: () => void }) {
  const guild = useStore((s) => s.guilds[guildId]);
  const [tab, setTab] = useState(initial ?? "overview");
  // Phones show the section list first, then the chosen section full-screen with a back button.
  const [pane, setPane] = useState<"list" | "detail">(initial ? "detail" : "list");
  if (!guild) return null;
  const p = guildPerms(guild);
  const owner = guild.owner_id === guild.me.user.id;
  const tabs: [string, string, boolean][] = [
    ["overview", "Overview", has(p, P.MANAGE_GUILD)], ["roles", "Roles", has(p, P.MANAGE_ROLES)], ["permissions", "Channel permissions", has(p, P.MANAGE_ROLES)],
    ["members", "Members", has(p, P.MANAGE_ROLES) || has(p, P.KICK_MEMBERS) || has(p, P.BAN_MEMBERS) || has(p, P.MODERATE_MEMBERS)],
    // Shown once the server supports expressions (it then sends `emojis`, even if empty).
    ["emoji", "Emoji", has(p, P.MANAGE_EXPRESSIONS) && guild.emojis !== undefined], ["soundboard", "Soundboard", has(p, P.MANAGE_EXPRESSIONS) && guild.sounds !== undefined],
    ["bans", "Bans", has(p, P.BAN_MEMBERS)], ["invites", "Invites", has(p, P.MANAGE_GUILD)], ["audit", "Audit log", has(p, P.VIEW_AUDIT_LOG)],
    ["profile", "My server profile", true], ["danger", owner ? "Transfer / delete" : "", owner],
  ];
  return (
    <Modal title={`${guild.name} — settings`} onClose={onClose} wide>
      <div className="settings" data-pane={pane}>
        <nav className="settings-nav" role="tablist" aria-orientation="vertical">
          {tabs.filter(([, , ok]) => ok).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setPane("detail"); }}>{label}</button>)}
        </nav>
        <section className="settings-body" role="tabpanel">
          <button className="settings-back m-only" onClick={() => setPane("list")}>‹ All settings</button>
          {tab === "overview" && <Overview guild={guild} />}
          {tab === "roles" && <Roles guild={guild} />}
          {tab === "permissions" && <ChannelPerms guild={guild} />}
          {tab === "members" && <Members guild={guild} />}
          {tab === "bans" && <Bans guild={guild} />}
          {tab === "invites" && <Invites guild={guild} />}
          {tab === "emoji" && <EmojiTab guild={guild} />}
          {tab === "soundboard" && <SoundboardTab guild={guild} />}
          {tab === "audit" && <Audit guild={guild} />}
          {tab === "profile" && <MyProfile guild={guild} />}
          {tab === "danger" && <Danger guild={guild} onClose={onClose} />}
        </section>
      </div>
    </Modal>
  );
}

function Overview({ guild }: { guild: Guild }) {
  const [f, setF] = useState({ name: guild.name, description: guild.description ?? "", vanity_code: guild.vanity_code ?? "", tag: guild.tag ?? "", system_channel_id: guild.system_channel_id ?? "", afk_channel_id: guild.afk_channel_id ?? "", afk_timeout: guild.afk_timeout, rules_channel_id: guild.rules_channel_id ?? "" });
  const [pct, setPct] = useState<number | null>(null);
  const img = (kind: "icon" | "banner") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    upload(`/api/guilds/${guild.id}/${kind}`, fd, setPct).promise.then(() => toast("Updated.", "success")).catch((x) => toast(errMsg(x), "error")).finally(() => setPct(null));
  };
  const text = guild.channels.filter((c) => c.type === ChannelType.TEXT || c.type === ChannelType.ANNOUNCEMENT);
  const voice = guild.channels.filter((c) => c.type === ChannelType.VOICE);
  const save = () => run(() => api.patch(`/api/guilds/${guild.id}`, {
    name: f.name, description: f.description || null, vanity_code: f.vanity_code || null, tag: f.tag || null,
    system_channel_id: f.system_channel_id || null, afk_channel_id: f.afk_channel_id || null, afk_timeout: f.afk_timeout, rules_channel_id: f.rules_channel_id || null,
  }), "Saved.");
  return (
    <div className="stack">
      <h2>Overview</h2>
      <div className="row wrap">
        <div className="guild-icon-edit">{guild.icon ? <img src={guild.icon} alt="Server icon" /> : <span>{guild.name.slice(0, 2)}</span>}</div>
        <label className="btn">Upload icon (animated OK)<input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/avif" onChange={img("icon")} /></label>
        <label className="btn">Upload banner / invite background<input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/avif" onChange={img("banner")} /></label>
        {pct !== null && <progress max={1} value={pct} />}
      </div>
      <Field label="Server name"><input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Description" hint="Shown on invites."><textarea value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="row wrap">
        <Field label="Custom invite link" hint={f.vanity_code ? `${location.origin}/invite/${f.vanity_code}` : "Free for every server, first come first served."}><input value={f.vanity_code} maxLength={32} onChange={(e) => setF({ ...f, vanity_code: e.target.value.toLowerCase() })} placeholder="my-community" /></Field>
        <Field label="Server tag" hint="2–4 letters/numbers, shown next to the name."><input value={f.tag} maxLength={4} onChange={(e) => setF({ ...f, tag: e.target.value })} /></Field>
      </div>
      <div className="row wrap">
        <Field label="System messages channel" hint="Join messages go here."><Select value={f.system_channel_id} onChange={(e) => setF({ ...f, system_channel_id: e.target.value })}><option value="">None</option>{text.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</Select></Field>
        <Field label="Rules channel"><Select value={f.rules_channel_id} onChange={(e) => setF({ ...f, rules_channel_id: e.target.value })}><option value="">None</option>{text.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</Select></Field>
      </div>
      <div className="row wrap">
        <Field label="Inactive (AFK) channel"><Select value={f.afk_channel_id} onChange={(e) => setF({ ...f, afk_channel_id: e.target.value })}><option value="">None</option>{voice.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Inactive timeout"><Select value={f.afk_timeout} onChange={(e) => setF({ ...f, afk_timeout: +e.target.value })}>{[60, 300, 900, 1800, 3600].map((s) => <option key={s} value={s}>{s / 60} min</option>)}</Select></Field>
      </div>
      <button className="btn primary" onClick={save}>Save changes</button>
    </div>
  );
}

function PermGrid({ value, onChange, mine, tri }: { value: { allow: bigint; deny: bigint }; onChange: (v: { allow: bigint; deny: bigint }) => void; mine: bigint; tri?: boolean }) {
  return (
    <div className="perm-grid">
      {PERMISSION_INFO.map((g) => (
        <fieldset key={g.group}><legend>{g.group}</legend>
          {g.items.map((it) => {
            const bit = P[it.key];
            const state = has(value.allow, bit) ? "allow" : has(value.deny, bit) ? "deny" : "inherit";
            const disabled = !has(mine, bit);
            const set = (s: string) => onChange({ allow: s === "allow" ? value.allow | bit : value.allow & ~bit, deny: s === "deny" ? value.deny | bit : value.deny & ~bit });
            return (
              <div key={it.key} className="perm-row">
                <span><strong>{it.label}</strong>{it.help && <small className="block muted">{it.help}</small>}</span>
                {tri ? (
                  <div className="tri" role="radiogroup" aria-label={it.label}>
                    {(["deny", "inherit", "allow"] as const).map((s) => <button key={s} role="radio" aria-checked={state === s} disabled={disabled} className={`tri-${s} ${state === s ? "on" : ""}`} onClick={() => set(s)} aria-label={`${s} ${it.label}`}>{s === "deny" ? "✕" : s === "allow" ? "✓" : "/"}</button>)}
                  </div>
                ) : <input type="checkbox" role="switch" className="toggle" aria-label={it.label} disabled={disabled} checked={state === "allow"} onChange={(e) => set(e.target.checked ? "allow" : "inherit")} />}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function Roles({ guild }: { guild: Guild }) {
  const roles = [...guild.roles].sort((a, b) => b.position - a.position);
  const [sel, setSel] = useState<string>(roles[0]?.id ?? guild.id);
  const role = guild.roles.find((r) => r.id === sel) ?? roles[0]!;
  const mine = guildPerms(guild);
  const [edit, setEdit] = useState<Role>(role);
  useEffect(() => setEdit(role), [role.id, role.permissions, role.name, role.color, role.position]); // eslint-disable-line
  const move = (r: Role, dir: 1 | -1) => {
    const order = roles.filter((x) => x.id !== guild.id).map((x) => x.id);
    const i = order.indexOf(r.id); const j = i - dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    run(() => api.patch(`/api/guilds/${guild.id}/roles`, order.map((id, k) => ({ id, position: order.length - k }))));
  };
  return (
    <div className="roles-ed">
      <div className="role-list">
        <button className="btn primary sm" onClick={() => run(async () => { const r = await api.post<Role>(`/api/guilds/${guild.id}/roles`, { name: "new role" }); setSel(r.id); })}>Create role</button>
        {roles.map((r) => (
          <div key={r.id} className={`role-item ${sel === r.id ? "active" : ""}`}>
            <button onClick={() => setSel(r.id)}><i style={{ background: r.color ?? "var(--textFaint)" }} /> {r.name}</button>
            {r.id !== guild.id && <><button className="icon-btn sm" aria-label={`Move ${r.name} up`} onClick={() => move(r, 1)}><ArrowUp size={14} /></button><button className="icon-btn sm" aria-label={`Move ${r.name} down`} onClick={() => move(r, -1)}><ArrowDown size={14} /></button></>}
          </div>
        ))}
      </div>
      <div className="stack">
        <h2>{role.id === guild.id ? "@everyone — default permissions" : `Edit role — ${role.name}`}</h2>
        {role.id !== guild.id && (
          <>
            <Field label="Role name"><input value={edit.name} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="row wrap">
              <Field label="Colour"><input type="color" value={edit.color ?? "#99AAB5"} onChange={(e) => setEdit({ ...edit, color: e.target.value.toUpperCase() })} /></Field>
              <Field label="Gradient end (optional)"><div className="row"><input type="color" value={edit.color2 ?? edit.color ?? "#99AAB5"} onChange={(e) => setEdit({ ...edit, color2: e.target.value.toUpperCase() })} /><button className="btn sm" onClick={() => setEdit({ ...edit, color2: null })}>None</button></div></Field>
              <span className="role-preview" style={edit.color2 ? { backgroundImage: `linear-gradient(90deg, ${edit.color}, ${edit.color2})`, WebkitBackgroundClip: "text", color: "transparent" } : { color: edit.color ?? undefined }}>{edit.name}</span>
            </div>
            <Toggle label="Show members separately in the member list" checked={edit.hoist} onChange={(v) => setEdit({ ...edit, hoist: v })} />
            <Toggle label="Anyone can @mention this role" checked={edit.mentionable} onChange={(v) => setEdit({ ...edit, mentionable: v })} />
          </>
        )}
        <PermGrid mine={mine} value={{ allow: BigInt(edit.permissions), deny: 0n }} onChange={(v) => setEdit({ ...edit, permissions: v.allow.toString() })} />
        <div className="row sticky-actions">
          <button className="btn primary" onClick={() => run(() => api.patch(`/api/guilds/${guild.id}/roles/${role.id}`, role.id === guild.id ? { permissions: edit.permissions } : { name: edit.name, color: edit.color, color2: edit.color2, hoist: edit.hoist, mentionable: edit.mentionable, permissions: edit.permissions }), "Role saved.")}>Save</button>
          {role.id !== guild.id && <button className="btn danger" onClick={async () => (await askConfirm({ title: `Delete ${role.name}?`, body: "Members lose this role and its permissions. This can't be undone.", confirmLabel: "Delete role", danger: true })) && run(() => api.del(`/api/guilds/${guild.id}/roles/${role.id}`)).then(() => setSel(guild.id))}><Trash2 size={14} /> Delete role</button>}
        </div>
      </div>
    </div>
  );
}

function ChannelPerms({ guild }: { guild: Guild }) {
  const chans = [...guild.channels].sort((a, b) => a.position - b.position);
  const [cid, setCid] = useState(chans[0]?.id ?? "");
  const ch = guild.channels.find((c) => c.id === cid);
  const members = useStore((s) => s.members[guild.id]);
  const [target, setTarget] = useState(guild.id);
  useEffect(() => { if (!members) loadMembers(guild.id); }, []); // eslint-disable-line
  if (!ch) return <p className="muted">No channels.</p>;
  const ow = ch.permission_overwrites.find((o) => o.target_id === target);
  const val = { allow: BigInt(ow?.allow ?? 0), deny: BigInt(ow?.deny ?? 0) };
  const isRole = guild.roles.some((r) => r.id === target);
  const save = (v: { allow: bigint; deny: bigint }) => run(() => api.put(`/api/channels/${ch.id}/permissions/${target}`, { type: isRole ? 0 : 1, allow: v.allow.toString(), deny: v.deny.toString() }));
  const parent = ch.parent_id ? guild.channels.find((c) => c.id === ch.parent_id) : null;
  return (
    <div className="stack">
      <h2>Channel permissions</h2>
      <div className="row wrap">
        <Field label="Channel"><Select value={cid} onChange={(e) => setCid(e.target.value)}>{chans.map((c) => <option key={c.id} value={c.id}>{c.type === ChannelType.CATEGORY ? `▾ ${c.name}` : isVoiceType(c.type) ? `🔊 ${c.name}` : `# ${c.name}`}</option>)}</Select></Field>
        <Field label="Role or member"><Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <optgroup label="Roles">{[...guild.roles].sort((a, b) => b.position - a.position).map((r) => <option key={r.id} value={r.id}>{r.name}{ch.permission_overwrites.some((o) => o.target_id === r.id) ? " •" : ""}</option>)}</optgroup>
          <optgroup label="Members">{Object.values(members ?? {}).map((m) => <option key={m.user.id} value={m.user.id}>{m.nick || displayName(m.user)}{ch.permission_overwrites.some((o) => o.target_id === m.user.id) ? " •" : ""}</option>)}</optgroup>
        </Select></Field>
      </div>
      {ch.type === ChannelType.CATEGORY && <p className="muted small">Changes here also apply to channels that are synced with this category.</p>}
      {parent && <p className="small">{ch.permission_synced ? <>Synced with <strong>{parent.name}</strong>. Editing will unsync this channel.</> : <>Not synced with <strong>{parent.name}</strong>. <button className="link" onClick={() => run(() => api.post(`/api/channels/${ch.id}/sync-permissions`), "Synced with category.")}>Sync now</button></>}</p>}
      <PermGrid tri mine={guildPerms(guild)} value={val} onChange={save} />
      {ow && target !== guild.id && <button className="btn danger sm" onClick={() => run(() => api.del(`/api/channels/${ch.id}/permissions/${target}`))}>Remove overwrite</button>}
    </div>
  );
}

function Members({ guild }: { guild: Guild }) {
  const members = useStore((s) => s.members[guild.id]);
  const [q, setQ] = useState("");
  const p = guildPerms(guild);
  useEffect(() => { loadMembers(guild.id); }, [guild.id]);
  const roles = [...guild.roles].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
  const list = Object.values(members ?? {}).filter((m) => !q || (m.nick ?? displayName(m.user)).toLowerCase().includes(q.toLowerCase()) || m.user.username.includes(q.toLowerCase()));
  const toggleRole = (m: Member, rid: string) => run(() => api.patch(`/api/guilds/${guild.id}/members/${m.user.id}`, { roles: m.roles.includes(rid) ? m.roles.filter((x) => x !== rid) : [...m.roles, rid] }));
  return (
    <div className="stack">
      <h2>Members — {guild.member_count}</h2>
      <input placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
      <ul className="member-admin">
        {list.map((m) => (
          <li key={m.user.id}>
            <Avatar user={m.user} size={32} />
            <div className="grow"><strong>{m.nick || displayName(m.user)}</strong> <span className="muted small">@{m.user.username}</span>
              {m.communication_disabled_until && new Date(m.communication_disabled_until) > new Date() && <span className="tag warn">Timed out</span>}
              {has(p, P.MANAGE_ROLES) && <div className="role-chips">{roles.map((r) => <label key={r.id} className={`role-chip ${m.roles.includes(r.id) ? "on" : ""}`}><input type="checkbox" checked={m.roles.includes(r.id)} onChange={() => toggleRole(m, r.id)} /><i style={{ background: r.color ?? "var(--textFaint)" }} />{r.name}</label>)}</div>}
            </div>
            {m.user.id !== guild.owner_id && m.user.id !== guild.me.user.id && (
              <div className="row">
                {has(p, P.MODERATE_MEMBERS) && <Select aria-label="Timeout" value="" onChange={(e) => { const s = +e.target.value; run(() => api.patch(`/api/guilds/${guild.id}/members/${m.user.id}`, { communication_disabled_until: s ? new Date(Date.now() + s * 1000).toISOString() : null }), s ? "Timed out." : "Timeout removed."); }}>
                  <option value="">Timeout…</option><option value={60}>60 seconds</option><option value={300}>5 minutes</option><option value={3600}>1 hour</option><option value={86400}>1 day</option><option value={604800}>1 week</option><option value={0}>Remove timeout</option></Select>}
                {has(p, P.KICK_MEMBERS) && <button className="btn sm" onClick={async () => (await askConfirm({ title: `Kick ${displayName(m.user)}?`, body: "They can rejoin with a new invite.", confirmLabel: "Kick", danger: true })) && run(() => api.del(`/api/guilds/${guild.id}/members/${m.user.id}`), "Kicked.")}>Kick</button>}
                {has(p, P.BAN_MEMBERS) && <button className="btn danger sm" onClick={async () => { const reason = await askText({ title: `Ban ${displayName(m.user)}?`, body: "They are removed and can't rejoin. Their messages from the last hour are deleted.", label: "Reason (optional, shown in the audit log)", optional: true, confirmLabel: "Ban", danger: true }); if (reason !== null) run(() => api.put(`/api/guilds/${guild.id}/bans/${m.user.id}`, { reason: reason || undefined, delete_message_seconds: 3600 }), "Banned."); }}>Ban</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bans({ guild }: { guild: Guild }) {
  const [list, setList] = useState<any[] | null>(null);
  const load = () => api.get(`/api/guilds/${guild.id}/bans`).then(setList).catch((e) => toast(errMsg(e), "error"));
  useEffect(() => { load(); }, []); // eslint-disable-line
  return (
    <div className="stack"><h2>Bans</h2>
      {!list ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">No bans.</p> : (
        <ul className="member-admin">{list.map((b) => <li key={b.user.id}><Avatar user={b.user} size={32} /><div className="grow"><strong>{displayName(b.user)}</strong><div className="muted small">{b.reason ?? "No reason given"}</div></div><button className="btn sm" onClick={() => run(() => api.del(`/api/guilds/${guild.id}/bans/${b.user.id}`), "Unbanned.").then(load)}>Revoke ban</button></li>)}</ul>
      )}
    </div>
  );
}

function Invites({ guild }: { guild: Guild }) {
  const [list, setList] = useState<Invite[] | null>(null);
  const load = () => api.get<Invite[]>(`/api/guilds/${guild.id}/invites`).then(setList).catch((e) => toast(errMsg(e), "error"));
  useEffect(() => { load(); }, []); // eslint-disable-line
  return (
    <div className="stack"><h2>Invites</h2>
      {!list ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">No active invites.</p> : (
        <table className="caps"><thead><tr><th>Code</th><th>By</th><th>Uses</th><th>Expires</th><th /></tr></thead><tbody>
          {list.map((i) => <tr key={i.code}><td><code>{i.code}</code></td><td>{displayName(i.inviter)}</td><td>{i.uses}{i.max_uses ? `/${i.max_uses}` : ""}</td><td>{i.expires_at ? new Date(i.expires_at).toLocaleString() : "Never"}</td><td><button className="btn danger sm" onClick={() => run(() => api.del(`/api/invites/${i.code}`)).then(load)}>Revoke</button></td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}

function EmojiTab({ guild }: { guild: Guild }) {
  const emojis = guild.emojis ?? [];
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const files = await new Promise<File[]>((res) => { const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.accept = "image/png,image/gif,image/webp,image/jpeg,image/avif"; i.onchange = () => res([...(i.files ?? [])]); i.addEventListener("cancel", () => res([])); i.click(); });
    if (!files.length) return;
    setBusy(true);
    for (const f of files) {
      const name = files.length === 1 ? await askText({ title: "Name this emoji", label: "Name (letters, numbers, _)", initial: emojiNameFrom(f.name), confirmLabel: "Upload" }) : emojiNameFrom(f.name);
      if (!name) continue;
      await run(() => uploadEmoji(guild.id, f, name.trim()), files.length === 1 ? `:${name.trim()}: added` : undefined);
    }
    setBusy(false);
  };
  return (
    <div className="stack"><h2>Emoji</h2>
      <p className="muted">Add up to {EXPRESSION_LIMITS.emojis} custom emoji that everyone here can use (animated GIF/WebP too). Up to {EXPRESSION_LIMITS.emojiBytes / 1024} KB each; 128×128 looks best. Type <code>:name</code> in a message, or pick them from the emoji menu.</p>
      <div className="row"><button className="btn primary" disabled={busy || emojis.length >= EXPRESSION_LIMITS.emojis} onClick={add}>{busy ? "Uploading…" : "Upload emoji"}</button><span className="muted small">{emojis.length} / {EXPRESSION_LIMITS.emojis}</span></div>
      {emojis.length > 0 && <table className="caps expr-table"><thead><tr><th>Image</th><th>Name</th><th>Uploaded by</th><th /></tr></thead><tbody>
        {emojis.map((e) => <tr key={e.id}><td><img className="expr-emoji" src={e.url} alt="" /></td><td><code>:{e.name}:</code>{e.animated && <span className="tag">GIF</span>}</td><td>{e.creator_id ? displayName(useStore.getState().users[e.creator_id]) || "—" : "—"}</td>
          <td className="row"><button className="btn sm" onClick={async () => { const n = await askText({ title: "Rename emoji", label: "Name", initial: e.name }); if (n && n !== e.name) run(() => api.patch(`/api/guilds/${guild.id}/emojis/${e.id}`, { name: n.trim() })); }}>Rename</button>
            <button className="btn danger sm" aria-label={`Delete :${e.name}:`} onClick={async () => { if (await askConfirm({ title: `Delete :${e.name}:?`, body: "It disappears from messages and reactions that use it.", confirmLabel: "Delete", danger: true })) run(() => api.del(`/api/guilds/${guild.id}/emojis/${e.id}`)); }}><Trash2 size={14} /></button></td></tr>)}
      </tbody></table>}
    </div>
  );
}

function SoundboardTab({ guild }: { guild: Guild }) {
  const sounds = guild.sounds ?? [];
  const [draft, setDraft] = useState<{ file: File; name: string; emoji: string; volume: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async () => { const f = await pickFile("audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,.mp3,.ogg,.wav,.m4a,.webm"); if (f) setDraft({ file: f, name: f.name.replace(/\.[^.]+$/, "").slice(0, 32), emoji: "", volume: 1 }); };
  const save = async () => { if (!draft) return; setBusy(true); if (await run(() => uploadSound(guild.id, draft.file, { name: draft.name.trim(), emoji: draft.emoji.trim() || null, volume: draft.volume }), "Sound added")) setDraft(null); setBusy(false); };
  return (
    <div className="stack"><h2>Soundboard</h2>
      <p className="muted">Short sounds people can play in this server's voice channels (needs the “Use soundboard” permission). MP3, OGG, WAV, WebM or M4A, up to {EXPRESSION_LIMITS.soundMs / 1000} seconds and {EXPRESSION_LIMITS.soundBytes / 1024} KB. Up to {EXPRESSION_LIMITS.sounds} sounds.</p>
      {!draft ? <div className="row"><button className="btn primary" disabled={sounds.length >= EXPRESSION_LIMITS.sounds} onClick={choose}>Upload sound</button><span className="muted small">{sounds.length} / {EXPRESSION_LIMITS.sounds}</span></div>
        : <div className="card stack">
          <strong>{draft.file.name}</strong>
          <div className="row wrap">
            <Field label="Name"><input value={draft.name} maxLength={32} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Emoji (optional)"><input value={draft.emoji} maxLength={8} placeholder="📯" onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} style={{ width: 80 }} /></Field>
            <Field label={`Volume — ${Math.round(draft.volume * 100)}%`}><Range min={0} max={1} step={0.05} value={draft.volume} onChange={(e) => setDraft({ ...draft, volume: +e.target.value })} /></Field>
          </div>
          <div className="row"><button className="btn" onClick={() => playClip(URL.createObjectURL(draft.file), draft.volume)}>Preview</button><span className="grow" /><button className="btn" onClick={() => setDraft(null)}>Cancel</button><button className="btn primary" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? "Uploading…" : "Add sound"}</button></div>
        </div>}
      {sounds.length > 0 && <div className="sb-grid">{sounds.map((s) => <div key={s.id} className="sb-tile card">
        <button className="sb-play" onClick={() => playClip(s.url, s.volume)} aria-label={`Preview ${s.name}`}><span className="sb-emoji" aria-hidden>{s.emoji || "🔊"}</span><span className="ellipsis">{s.name}</span></button>
        <small className="muted">{(s.duration_ms / 1000).toFixed(1)} s · {Math.round(s.volume * 100)}%</small>
        <div className="row"><button className="btn sm" onClick={async () => { const n = await askText({ title: "Rename sound", label: "Name", initial: s.name }); if (n && n !== s.name) run(() => api.patch(`/api/guilds/${guild.id}/soundboard/${s.id}`, { name: n.trim() })); }}>Rename</button>
          <button className="btn danger sm" aria-label={`Delete ${s.name}`} onClick={async () => { if (await askConfirm({ title: `Delete “${s.name}”?`, confirmLabel: "Delete", danger: true })) run(() => api.del(`/api/guilds/${guild.id}/soundboard/${s.id}`)); }}><Trash2 size={14} /></button></div>
      </div>)}</div>}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  guild_create: "created the server", guild_update: "updated the server", role_create: "created a role", role_update: "updated a role", role_delete: "deleted a role", role_reorder: "reordered roles",
  channel_create: "created a channel", channel_update: "updated a channel", channel_delete: "deleted a channel", channel_reorder: "reordered channels",
  overwrite_update: "changed channel permissions", overwrite_delete: "removed a channel permission", overwrite_sync: "synced channel permissions",
  member_update: "updated a member", member_kick: "kicked a member", member_ban: "banned a member", member_unban: "unbanned a member",
  emoji_create: "added an emoji", emoji_update: "renamed an emoji", emoji_delete: "deleted an emoji", sound_create: "added a sound", sound_update: "edited a sound", sound_delete: "deleted a sound",
  channel_banner_update: "set a category banner", channel_banner_remove: "removed a category banner",
  invite_create: "created an invite", invite_delete: "revoked an invite", message_delete: "deleted a message", message_bulk_delete: "bulk-deleted messages", guild_transfer: "transferred ownership",
};
function Audit({ guild }: { guild: Guild }) {
  const [list, setList] = useState<any[] | null>(null);
  const users = useStore((s) => s.users);
  useEffect(() => { api.get(`/api/guilds/${guild.id}/audit-log`).then(setList).catch((e) => toast(errMsg(e), "error")); }, [guild.id]);
  const name = (id: string | null) => (id ? guild.roles.find((r) => r.id === id)?.name ?? guild.channels.find((c) => c.id === id)?.name ?? (users[id] ? displayName(users[id]) : id) : "");
  return (
    <div className="stack"><h2>Audit log</h2>
      {!list ? <p className="muted">Loading…</p> : <ul className="audit">{list.map((e) => (
        <li key={e.id}><Avatar user={e.user} size={24} /><span><strong>{displayName(e.user)}</strong> {ACTION_LABEL[e.action] ?? e.action} {e.target_id && <em>{name(e.target_id)}</em>}{e.reason && <span className="muted"> — “{e.reason}”</span>}<small className="block muted">{new Date(e.created_at).toLocaleString()}</small></span></li>
      ))}</ul>}
    </div>
  );
}

function MyProfile({ guild }: { guild: Guild }) {
  const [nick, setNick] = useState(guild.me.nick ?? ""); const [bio, setBio] = useState(guild.me.guild_bio ?? "");
  return (
    <div className="stack"><h2>My profile in {guild.name}</h2>
      <p className="muted small">A nickname and bio just for this server.</p>
      <Field label="Nickname"><input value={nick} maxLength={32} onChange={(e) => setNick(e.target.value)} /></Field>
      <Field label="Server bio"><textarea value={bio} maxLength={400} onChange={(e) => setBio(e.target.value)} /></Field>
      <button className="btn primary" onClick={() => run(() => api.patch(`/api/guilds/${guild.id}/members/@me`, { nick: nick || null, bio: bio || null }), "Saved.")}>Save</button>
    </div>
  );
}

function Danger({ guild, onClose }: { guild: Guild; onClose: () => void }) {
  const members = useStore((s) => s.members[guild.id]);
  const [to, setTo] = useState("");
  return (
    <div className="stack"><h2>Ownership</h2>
      <Field label="Transfer ownership to"><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a member…</option>{Object.values(members ?? {}).filter((m) => m.user.id !== guild.owner_id).map((m) => <option key={m.user.id} value={m.user.id}>{m.nick || displayName(m.user)}</option>)}</Select></Field>
      <button className="btn" disabled={!to} onClick={async () => (await askConfirm({ title: "Transfer ownership?", body: "You'll lose owner rights. Only the new owner can give them back.", confirmLabel: "Transfer", danger: true })) && run(() => api.post(`/api/guilds/${guild.id}/transfer`, { user_id: to }), "Ownership transferred.")}>Transfer</button>
      <h2>Delete server</h2>
      <p className="muted">This permanently deletes every channel, message and file in {guild.name}.</p>
      <button className="btn danger" onClick={async () => { if (await askText({ title: `Delete ${guild.name}?`, body: "This permanently deletes the server, its channels and messages for everyone.", mustEqual: guild.name, confirmLabel: "Delete server", danger: true }) === guild.name) run(() => api.del(`/api/guilds/${guild.id}`)).then((ok) => { if (ok) { onClose(); navigate("/channels/@me"); } }); }}>Delete server</button>
    </div>
  );
}

export type { Channel };
