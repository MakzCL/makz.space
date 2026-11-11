import { ALL_PERMISSIONS, DEFAULT_PRIVACY, type Channel, type Guild, type InstanceLimits, type Member, type Message, type SelfUser, type User } from "@send/shared";
import { dispatch, useStore } from "./store.ts";

/** Local, labelled sample data. Never opens a gateway or sends requests to the real API. */
const now = new Date().toISOString();
const person = (id: string, username: string, display_name: string): User => ({ id, username, display_name, avatar: null, banner: null, bio: "Local preview account", pronouns: "", accent_color: null, profile_theme: null });
const karol = person("1001", "karol_preview", "Karol");
const alex = person("1002", "alex_preview", "Alex · sample");
const sam = person("1003", "sam_preview", "Sam · sample");
const people = [karol, alex, sam];
const me: SelfUser = { ...karol, email: "preview@example.invalid", email_verified: true, mfa_enabled: false, status: "online", custom_status: { text: "Exploring SEND" }, privacy: DEFAULT_PRIVACY, settings: {}, created_at: now };
const member = (user: User): Member => ({ guild_id: "2001", user, nick: null, roles: [], joined_at: now, communication_disabled_until: null, mute: false, deaf: false, guild_avatar: null, guild_bio: null });
const makeChannel = (id: string, name: string, type = 0): Channel => ({ id, name, type, guild_id: "2001", topic: "Local interface preview — sample data only", position: Number(id), parent_id: null, nsfw: false, rate_limit_per_user: 0, bitrate: 128000, user_limit: 0, permission_overwrites: [], permission_synced: false, last_message_id: null, my_permissions: String(ALL_PERMISSIONS) });
const channels = [makeChannel("3001", "general"), makeChannel("3002", "ideas"), makeChannel("3003", "Lounge", 2)];
const dm: Channel = { ...makeChannel("3004", "", 1), name: null, guild_id: null, recipients: [alex] };
const guild: Guild = { id: "2001", name: "SEND Preview", icon: null, banner: null, description: "Sample community, stored on this device", owner_id: me.id, system_channel_id: null, afk_channel_id: null, afk_timeout: 300, vanity_code: null, tag: "TRY", rules_channel_id: null, verification_level: 0, discoverable: false, created_at: now, member_count: people.length, me: member(me), channels, roles: [
  { id: "2001", guild_id: "2001", name: "@everyone", color: null, color2: null, permissions: String(ALL_PERMISSIONS), position: 0, hoist: false, mentionable: false, icon: null },
  { id: "2002", guild_id: "2001", name: "Friends", color: "#f7ba00", color2: null, permissions: "0", position: 1, hoist: false, mentionable: true, icon: null },
] };
const message = (id: string, cid: string, author: User, content: string): Message => ({ id, channel_id: cid, guild_id: cid === dm.id ? null : guild.id, author, content, type: 0, created_at: now, edited_at: null, pinned: false, reply_to: null, mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], nonce: null });
let messages: Message[] = [
  message("4001", "3001", alex, "Welcome to the **SEND interface preview**. These are sample conversations stored on your device — no real messages are sent."),
  message("4002", "3001", sam, "Try sending a message, typing @, reacting, pinning, or saving. Open **Saved messages** from Home to find your saves again."),
  message("4003", "3002", alex, "Explore **SEND Studio** from your profile menu to try colours, layouts and themes."),
  message("4004", "3004", alex, "This is a sample DM. Calls, uploads and real accounts need the live server."),
];
let savedIds = ["4002"];
let prefs: any[] = [];
let counter = BigInt(Date.now()) * 1000n;
const nextId = () => String(++counter);
const KEY = "send.preview.data.v1";
try {
  const old = JSON.parse(localStorage.getItem(KEY) ?? "null");
  if (old && Array.isArray(old.messages) && old.messages.every((m: any) => /^\d+$/.test(m.id) && /^\d+$/.test(m.channel_id) && typeof m.content === "string" && m.author?.id && Array.isArray(m.reactions) && Array.isArray(m.attachments))) {
    messages = old.messages; savedIds = Array.isArray(old.savedIds) ? old.savedIds.filter((x: unknown) => typeof x === "string") : [];
    me.settings = old.settings && typeof old.settings === "object" ? old.settings : {};
    prefs = Array.isArray(old.prefs) ? old.prefs : [];
    counter = messages.reduce((max, m) => BigInt(m.id) > max ? BigInt(m.id) : max, counter);
  }
} catch { /* Replace corrupt preview state with the samples. */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ messages, savedIds, settings: me.settings, prefs })); } catch { /* Storage may be disabled. */ } };
const limits: InstanceLimits = { max_upload_bytes: 104857600, max_message_length: 4000, max_guilds_per_user: 200, max_members_per_guild: 25000, max_group_dm_recipients: 10, max_emoji_per_guild: 250, max_voice_bitrate_kbps: 510, max_stream_height: 2160, max_stream_fps: 60, max_stream_bitrate_kbps: 20000, media_enabled: false, gif_provider: null };

export function startPreview() {
  for (const ch of [...channels, dm]) ch.last_message_id = messages.filter((m) => m.channel_id === ch.id).at(-1)?.id ?? null;
  dispatch("READY", { user: me, guilds: [guild], private_channels: [dm], relationships: [alex, sam].map((user) => ({ id: user.id, user, type: 1, since: now })), read_states: [], presences: { [alex.id]: "online", [sam.id]: "idle" }, voice_states: [], limits, session_id: "local-preview" });
  useStore.setState({ users: Object.fromEntries(people.map((u) => [u.id, u])), members: { [guild.id]: Object.fromEntries(people.map((u) => [u.id, member(u)])) } });
}

export async function previewRequest<T>(method: string, path: string, body: any = {}): Promise<T> {
  const url = new URL(path, location.origin); const p = url.pathname; const parts = p.split("/"); let result: any;
  if (p === "/api/users/@me") {
    if (method === "PATCH") { Object.assign(me, body); dispatch("USER_UPDATE", { ...me }); } result = me;
  } else if (p === "/api/users/@me/settings") {
    Object.assign(me.settings, body); dispatch("USER_SETTINGS_UPDATE", me.settings); result = me.settings;
  } else if (p === "/api/users/@me/channels") result = method === "GET" ? [dm] : dm;
  else if (p === "/api/users/@me/saved") result = messages.filter((m) => savedIds.includes(m.id)).reverse();
  else if (p.startsWith("/api/users/@me/saved/")) {
    const mid = parts.at(-1)!; savedIds = savedIds.filter((x) => x !== mid); if (method === "PUT") savedIds.push(mid);
    dispatch("SAVED_UPDATE", { message_id: mid, saved: method === "PUT" }); result = { ok: true };
  } else if (/\/guilds\/\d+\/members$/.test(p)) {
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    result = people.filter((u) => `${u.username} ${u.display_name}`.toLowerCase().includes(q)).map(member);
  } else if (p === "/api/appearance") result = { prefs, presets: [], shared: [], storage: { used: 0, count: 0, quota: 104857600, max_file: 104857600 } };
  else if (p === "/api/appearance/assets") result = [];
  else if (/^\/api\/appearance\/(global|guild\/\d+|channel\/\d+)$/.test(p)) {
    const scope = parts[3], scope_id = parts[4] ?? ""; const old = prefs.find((x) => x.scope === scope && x.scope_id === scope_id);
    const rev = (old?.rev ?? 0) + 1; prefs = prefs.filter((x) => x !== old);
    if (method !== "DELETE") prefs.push({ scope, scope_id, data: body.data, rev }); result = { data: body.data, rev, warnings: [] };
  } else if (/\/channels\/\d+\/messages$/.test(p)) {
    const cid = parts[3];
    if (method === "POST") {
      const duplicate = messages.find((m) => m.channel_id === cid && m.nonce === body.nonce && body.nonce);
      const m = duplicate ?? { ...message(nextId(), cid, me, body.content ?? ""), nonce: body.nonce ?? null };
      if (body.reply_to) { const r = messages.find((m) => m.id === body.reply_to); if (r) m.reply_to = { id: r.id, author: r.author, content: r.content, deleted: false }; }
      if (!duplicate) { messages.push(m); dispatch("MESSAGE_CREATE", m); } result = m;
    } else result = messages.filter((m) => m.channel_id === cid && (!url.searchParams.get("before") || BigInt(m.id) < BigInt(url.searchParams.get("before")!))).slice(-50).reverse();
  } else if (/\/channels\/\d+\/messages\/\d+\/reactions\//.test(p)) {
    const m = messages.find((m) => m.id === parts[5]); const emoji = decodeURIComponent(parts[7]); if (!m) throw new Error("Sample message not found.");
    m.reactions = m.reactions.filter((r) => r.emoji !== emoji); if (method === "PUT") m.reactions.push({ emoji, count: 1, me: true });
    dispatch("MESSAGE_UPDATE", m); result = { ok: true };
  } else if (/\/channels\/\d+\/messages\/\d+$/.test(p)) {
    const mid = parts.at(-1)!; const m = messages.find((m) => m.id === mid); if (!m) throw new Error("Sample message not found.");
    if (method === "DELETE") { messages = messages.filter((x) => x.id !== mid); dispatch("MESSAGE_DELETE", { id: mid, channel_id: m.channel_id }); }
    else if (method === "PATCH") { m.content = body.content; m.edited_at = new Date().toISOString(); dispatch("MESSAGE_UPDATE", m); } result = m;
  } else if (/\/channels\/\d+\/pins/.test(p)) {
    const cid = parts[3], mid = parts[5]; const m = messages.find((m) => m.id === mid); if (m) { m.pinned = method === "PUT"; dispatch("MESSAGE_UPDATE", m); }
    result = method === "GET" ? messages.filter((m) => m.channel_id === cid && m.pinned) : { ok: true };
  } else if (/\/(ack|unread|typing)$/.test(p)) result = { ok: true };
  else if (p === "/api/search") {
    const q = url.searchParams.get("q")?.toLowerCase() ?? ""; const cid = url.searchParams.get("channel_id");
    const found = messages.filter((m) => (!cid || m.channel_id === cid) && m.content.toLowerCase().includes(q)); result = { total: found.length, messages: found };
  } else if (p === "/api/auth/logout") result = { ok: true };
  else throw new Error("This action needs the live server. You're exploring local sample data.");
  persist(); return structuredClone(result) as T;
}
