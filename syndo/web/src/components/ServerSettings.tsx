import { Select } from "./Select.tsx";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChannelType, P, PERMISSION_INFO, has, isVoiceType, type Channel, type Guild, type Invite, type Member, type Role } from "@syndo/shared";
import { api, errMsg, upload } from "../api.ts";
import { loadMembers } from "../actions.ts";
import { navigate } from "../router.ts";
import { displayName, guildPerms, toast, useStore } from "../store.ts";
import { Avatar, Field, Modal, Toggle } from "./ui.tsx";

const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok, "success"); return true; } catch (e) { toast(errMsg(e), "error"); return false; } };

export function ServerSettings({ guildId, tab: initial, onClose }: { guildId: string; tab?: string; onClose: () => void }) {
  const guild = useStore((s) => s.guilds[guildId]);
  const [tab, setTab] = useState(initial ?? "overview");
  if (!guild) return null;
  const p = guildPerms(guild);
  const owner = guild.owner_id === guild.me.user.id;
  const tabs: [string, string, boolean][] = [
    ["overview", "Overview", has(p, P.MANAGE_GUILD)], ["roles", "Roles", has(p, P.MANAGE_ROLES)], ["permissions", "Channel permissions", has(p, P.MANAGE_ROLES)],
    ["members", "Members", has(p, P.MANAGE_ROLES) || has(p, P.KICK_MEMBERS) || has(p, P.BAN_MEMBERS) || has(p, P.MODERATE_MEMBERS)],
    ["bans", "Bans", has(p, P.BAN_MEMBERS)], ["invites", "Invites", has(p, P.MANAGE_GUILD)], ["audit", "Audit log", has(p, P.VIEW_AUDIT_LOG)],
    ["profile", "My server profile", true], ["danger", owner ? "Transfer / delete" : "", owner],
  ];
  return (
    <Modal title={`${guild.name} — settings`} onClose={onClose} wide>
      <div className="settings">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical">
          {tabs.filter(([, , ok]) => ok).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        <section className="settings-body" role="tabpanel">
          {tab === "overview" && <Overview guild={guild} />}
          {tab === "roles" && <Roles guild={guild} />}
          {tab === "permissions" && <ChannelPerms guild={guild} />}
          {tab === "members" && <Members guild={guild} />}
          {tab === "bans" && <Bans guild={guild} />}
          {tab === "invites" && <Invites guild={guild} />}
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
          {role.id !== guild.id && <button className="btn danger" onClick={() => confirm(`Delete ${role.name}?`) && run(() => api.del(`/api/guilds/${guild.id}/roles/${role.id}`)).then(() => setSel(guild.id))}><Trash2 size={14} /> Delete role</button>}
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
                {has(p, P.KICK_MEMBERS) && <button className="btn sm" onClick={() => confirm(`Kick ${displayName(m.user)}?`) && run(() => api.del(`/api/guilds/${guild.id}/members/${m.user.id}`), "Kicked.")}>Kick</button>}
                {has(p, P.BAN_MEMBERS) && <button className="btn danger sm" onClick={() => { const reason = prompt(`Ban ${displayName(m.user)}? Optional reason:`); if (reason !== null) run(() => api.put(`/api/guilds/${guild.id}/bans/${m.user.id}`, { reason: reason || undefined, delete_message_seconds: 3600 }), "Banned."); }}>Ban</button>}
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

const ACTION_LABEL: Record<string, string> = {
  guild_create: "created the server", guild_update: "updated the server", role_create: "created a role", role_update: "updated a role", role_delete: "deleted a role", role_reorder: "reordered roles",
  channel_create: "created a channel", channel_update: "updated a channel", channel_delete: "deleted a channel", channel_reorder: "reordered channels",
  overwrite_update: "changed channel permissions", overwrite_delete: "removed a channel permission", overwrite_sync: "synced channel permissions",
  member_update: "updated a member", member_kick: "kicked a member", member_ban: "banned a member", member_unban: "unbanned a member",
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
      <button className="btn" disabled={!to} onClick={() => confirm("Transfer ownership? You'll lose owner rights.") && run(() => api.post(`/api/guilds/${guild.id}/transfer`, { user_id: to }), "Ownership transferred.")}>Transfer</button>
      <h2>Delete server</h2>
      <p className="muted">This permanently deletes every channel, message and file in {guild.name}.</p>
      <button className="btn danger" onClick={() => { if (prompt(`Type the server name to confirm: ${guild.name}`) === guild.name) run(() => api.del(`/api/guilds/${guild.id}`)).then((ok) => { if (ok) { onClose(); navigate("/channels/@me"); } }); }}>Delete server</button>
    </div>
  );
}

export type { Channel };
