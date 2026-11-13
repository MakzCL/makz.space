import { create } from "zustand";
import {
  ChannelType, P, has, type Activity, type Channel, type Guild, type GuildEvent, type InstanceLimits, type Member, type Message, type NotificationSetting, type ReadState,
  type Relationship, type SelfUser, type StageInstance, type User, type VoiceState,
} from "@send/shared";

export type SendState = "pending" | "failed";
export type UIMessage = Message & { _state?: SendState; _error?: string };
export interface ChannelMessages { list: UIMessage[]; hasMore: boolean; loaded: boolean; loading: boolean }
export interface CallInfo { channel_id: string; message_id: string; ringing: string[]; started_at: number }
export type ConnState = "booting" | "signed_out" | "connecting" | "ready" | "reconnecting";

interface S {
  conn: ConnState;
  me: SelfUser | null;
  guilds: Record<string, Guild>;
  dms: Record<string, Channel>;
  relationships: Record<string, Relationship>;
  presences: Record<string, string>;
  users: Record<string, User>;
  members: Record<string, Record<string, Member & { presence?: string }>>;
  messages: Record<string, ChannelMessages>;
  readStates: Record<string, ReadState>;
  typing: Record<string, Record<string, number>>;
  voice: Record<string, VoiceState>;
  calls: Record<string, CallInfo>;
  limits: InstanceLimits | null;
  sessionId: string | null;
  notice: { id: number; text: string; kind: "info" | "error" | "success" }[];
  /** Threads I can see (active ones per server, plus any I opened), keyed by id. */
  threads: Record<string, Channel>;
  joinedThreads: string[];
  /** Notification settings by scope id (server, channel/category, or "0" for DMs). */
  notif: Record<string, NotificationSetting>;
  /** "Playing …" etc. by user id. */
  activities: Record<string, Activity>;
  customStatuses: Record<string, { text: string; emoji?: string | null }>;
  events: Record<string, GuildEvent[]>;
  stages: Record<string, StageInstance>;
}

export const useStore = create<S>(() => ({
  conn: "booting", me: null, guilds: {}, dms: {}, relationships: {}, presences: {}, users: {}, members: {},
  messages: {}, readStates: {}, typing: {}, voice: {}, calls: {}, limits: null, sessionId: null, notice: [],
  threads: {}, joinedThreads: [], notif: {}, activities: {}, customStatuses: {}, events: {}, stages: {},
}));
const set = useStore.setState;
const get = useStore.getState;

let noticeId = 0;
export function toast(text: string, kind: "info" | "error" | "success" = "info") {
  const id = ++noticeId;
  set((s) => ({ notice: [...s.notice, { id, text, kind }] }));
  setTimeout(() => set((s) => ({ notice: s.notice.filter((n) => n.id !== id) })), kind === "error" ? 6000 : 3500);
}

/* ------------------------------------------------------------- helpers -- */
export const displayName = (u: User | null | undefined) => (u ? u.display_name || u.username : "Unknown");
export function memberName(guildId: string | null, u: User | null | undefined) {
  if (!u) return "Unknown";
  if (guildId) { const m = get().members[guildId]?.[u.id]; if (m?.nick) return m.nick; }
  return displayName(u);
}
export function channelById(id: string | null | undefined): Channel | null {
  if (!id) return null;
  const s = get();
  if (s.dms[id]) return s.dms[id]!;
  for (const g of Object.values(s.guilds)) { const c = g.channels.find((c) => c.id === id); if (c) return c; }
  if (s.threads[id]) return s.threads[id]!;
  return null;
}
export const isThreadType = (t: number) => t === ChannelType.PUBLIC_THREAD || t === ChannelType.PRIVATE_THREAD;
/** A thread inherits what I can do from its parent channel. */
export function withParentPerms(t: Channel): Channel {
  const parent = t.parent_id ? channelById(t.parent_id) : null;
  return parent && parent.id !== t.id ? { ...t, my_permissions: parent.my_permissions, permission_overwrites: [] } : t;
}
export function putThreads(list: Channel[]) {
  set((s) => { const threads = { ...s.threads }; for (const t of list) threads[t.id] = withParentPerms({ ...(threads[t.id] ?? {}), ...t } as Channel); return { threads }; });
}
/** Effective notification level for a channel: 0 all, 1 mentions, 2 nothing. */
export function notifLevel(ch: Channel | null): 0 | 1 | 2 {
  if (!ch) return 1;
  const n = get().notif;
  const own = n[ch.id]?.level ?? (ch.parent_id ? n[ch.parent_id]?.level : null);
  if (own != null) return own;
  if (!ch.guild_id) return n["0"]?.level ?? 0;
  return n[ch.guild_id]?.level ?? 1;
}
export function isMutedScope(id: string | null | undefined) {
  if (!id) return false;
  const x = get().notif[id];
  return !!x?.muted && (!x.muted_until || new Date(x.muted_until).getTime() > Date.now());
}
export const myPerms = (ch: Channel | null) => (ch?.my_permissions ? BigInt(ch.my_permissions) : ch && !ch.guild_id ? ~0n : 0n);
export const can = (ch: Channel | null, flag: bigint) => has(myPerms(ch), flag);
export function isUnread(ch: Channel) {
  const rs = get().readStates[ch.id];
  if (!ch.last_message_id) return false;
  if (!rs?.last_read_id) return true;
  return BigInt(ch.last_message_id) > BigInt(rs.last_read_id);
}
export function guildPerms(g: Guild): bigint {
  if (g.owner_id === g.me.user.id) return ~0n;
  let p = BigInt(g.roles.find((r) => r.id === g.id)?.permissions ?? "0");
  for (const r of g.roles) if (g.me.roles.includes(r.id)) p |= BigInt(r.permissions);
  return has(p, P.ADMINISTRATOR) ? ~0n : p;
}
export const dmTitle = (c: Channel) => c.name || (c.recipients ?? []).map(displayName).join(", ") || "Empty group";

function remember(users: (User | null | undefined)[]) {
  const add: Record<string, User> = {};
  for (const u of users) if (u) add[u.id] = u;
  if (Object.keys(add).length) set((s) => ({ users: { ...s.users, ...add } }));
}

/* ------------------------------------------------------------- messages -- */
function upsertMessages(channelId: string, incoming: UIMessage[], opts: { hasMore?: boolean; replace?: boolean } = {}) {
  set((s) => {
    const cur = s.messages[channelId] ?? { list: [], hasMore: true, loaded: false, loading: false };
    const byId = new Map<string, UIMessage>(opts.replace ? [] : cur.list.map((m) => [m.id, m]));
    for (const m of incoming) {
      // Replace an optimistic copy that shares the nonce.
      if (m.nonce) for (const [k, v] of byId) if (v._state && v.nonce === m.nonce) byId.delete(k);
      const prev = byId.get(m.id);
      byId.set(m.id, prev ? { ...prev, ...m, reactions: m.reactions ?? prev.reactions } : m);
    }
    const list = [...byId.values()].sort((a, b) => {
      if (a._state && !b._state) return 1;
      if (!a._state && b._state) return -1;
      return BigInt(a.id.replace(/\D/g, "") || "0") < BigInt(b.id.replace(/\D/g, "") || "0") ? -1 : 1;
    });
    return { messages: { ...s.messages, [channelId]: { ...cur, list, loaded: true, loading: false, hasMore: opts.hasMore ?? cur.hasMore } } };
  });
  remember(incoming.flatMap((m) => [m.author, m.reply_to?.author]));
}
export const messagesApi = { upsertMessages };

export function patchChannel(id: string, patch: Partial<Channel>) {
  set((s) => {
    if (s.dms[id]) return { dms: { ...s.dms, [id]: { ...s.dms[id]!, ...patch } } };
    if (s.threads[id]) return { threads: { ...s.threads, [id]: { ...s.threads[id]!, ...patch } } };
    const guilds = { ...s.guilds };
    for (const g of Object.values(guilds)) {
      const i = g.channels.findIndex((c) => c.id === id);
      if (i >= 0) { const chans = [...g.channels]; chans[i] = { ...chans[i]!, ...patch }; guilds[g.id] = { ...g, channels: chans }; return { guilds }; }
    }
    return {};
  });
}

/* ------------------------------------------------------- gateway events -- */
export type Handler = (d: any) => void;
const extra: Record<string, Handler[]> = {};
export const onEvent = (t: string, fn: Handler) => { (extra[t] ??= []).push(fn); return () => { extra[t] = extra[t]!.filter((f) => f !== fn); }; };

export function dispatch(t: string, d: any) {
  const s = get();
  switch (t) {
    case "READY": {
      const guilds: Record<string, Guild> = {};
      for (const g of d.guilds) guilds[g.id] = g;
      const dms: Record<string, Channel> = {};
      for (const c of d.private_channels) dms[c.id] = c;
      const relationships: Record<string, Relationship> = {};
      for (const r of d.relationships) relationships[r.id] = r;
      const readStates: Record<string, ReadState> = {};
      for (const r of d.read_states) readStates[r.channel_id] = r;
      const voice: Record<string, VoiceState> = {};
      for (const v of d.voice_states) voice[v.user_id] = v;
      const notif: Record<string, NotificationSetting> = {};
      for (const n of d.notification_settings ?? []) notif[n.scope_id] = n;
      const stages: Record<string, StageInstance> = {};
      for (const g of d.guilds) for (const st of g.stage_instances ?? []) stages[st.channel_id] = st;
      set({ conn: "ready", me: { ...d.user, has_passkey: d.has_passkey }, guilds, dms, relationships, readStates, voice, presences: d.presences, limits: d.limits, sessionId: d.session_id,
        notif, stages, activities: d.activities ?? {}, customStatuses: d.custom_statuses ?? {}, joinedThreads: d.joined_threads ?? [] });
      remember([d.user, ...d.relationships.map((r: Relationship) => r.user), ...d.private_channels.flatMap((c: Channel) => c.recipients ?? []), ...d.voice_states.map((v: VoiceState) => v.user).filter(Boolean)]);
      break;
    }
    case "USER_UPDATE": set({ me: d }); remember([d]); break;
    case "USER_SETTINGS_UPDATE": if (s.me) set({ me: { ...s.me, settings: d } }); break;
    case "USER_PUBLIC_UPDATE": remember([d]); set((st) => {
      const relationships = { ...st.relationships };
      if (relationships[d.id]) relationships[d.id] = { ...relationships[d.id]!, user: d };
      return { relationships };
    }); break;
    case "PRESENCE_UPDATE": set((st) => {
      const activities = { ...st.activities };
      if (d.activity) activities[d.user_id] = d.activity; else delete activities[d.user_id];
      const customStatuses = { ...st.customStatuses };
      if (d.custom_status) customStatuses[d.user_id] = d.custom_status; else if ("custom_status" in d || d.status === "offline") delete customStatuses[d.user_id];
      return { presences: { ...st.presences, [d.user_id]: d.status }, activities, customStatuses, me: d.self_status && st.me ? { ...st.me, status: d.self_status } : st.me };
    }); break;
    case "THREAD_CREATE": case "THREAD_UPDATE": putThreads([d]); break;
    case "THREAD_DELETE": set((st) => { const threads = { ...st.threads }; delete threads[d.id]; return { threads }; }); break;
    case "THREAD_MEMBERS_UPDATE": set((st) => {
      const me = st.me?.id ?? "";
      let j = st.joinedThreads.filter((x) => x !== d.id || !(d.removed ?? []).includes(me));
      if ((d.added ?? []).includes(me) && !j.includes(d.id)) j = [...j, d.id];
      return { joinedThreads: j };
    }); break;
    case "NOTIFICATION_SETTINGS_UPDATE": set((st) => ({ notif: { ...st.notif, [d.scope_id]: d } })); break;
    case "VOICE_CHANNEL_STATUS_UPDATE": patchChannel(d.id, { voice_status: d.status }); break;
    case "STAGE_INSTANCE_CREATE": case "STAGE_INSTANCE_UPDATE": set((st) => ({ stages: { ...st.stages, [d.channel_id]: d } })); break;
    case "STAGE_INSTANCE_DELETE": set((st) => { const stages = { ...st.stages }; delete stages[d.channel_id]; return { stages }; }); break;
    case "GUILD_EVENT_CREATE": case "GUILD_EVENT_UPDATE": set((st) => {
      const list = (st.events[d.guild_id] ?? []).filter((e) => e.id !== d.id);
      const keep = d.status === 1 || d.status === 2;
      return { events: { ...st.events, [d.guild_id]: (keep ? [...list, d] : list).sort((a, b) => a.start_at.localeCompare(b.start_at)) } };
    }); break;
    case "GUILD_EVENT_DELETE": set((st) => ({ events: { ...st.events, [d.guild_id]: (st.events[d.guild_id] ?? []).filter((e) => e.id !== d.id) } })); break;
    case "POLL_VOTES": set((st) => {
      const cur = st.messages[d.channel_id];
      if (!cur) return {};
      const list = cur.list.map((m) => {
        if (m.id !== d.message_id || !m.poll) return m;
        const mine = d.user_id === st.me?.id;
        const answers = m.poll.answers.map((a) => ({ ...a, votes: d.counts.find((c: any) => c.answer_id === a.id)?.n ?? 0, me: mine ? d.answer_ids.includes(a.id) : a.me }));
        return { ...m, poll: { ...m.poll, answers, total_votes: answers.reduce((n, a) => n + a.votes, 0) } };
      });
      return { messages: { ...st.messages, [d.channel_id]: { ...cur, list } } };
    }); break;
    case "RELATIONSHIP_ADD": remember([d.user]); set((st) => ({ relationships: { ...st.relationships, [d.id]: d }, presences: d.presence ? { ...st.presences, [d.id]: d.presence } : st.presences })); break;
    case "RELATIONSHIP_REMOVE": set((st) => { const r = { ...st.relationships }; delete r[d.id]; return { relationships: r }; }); break;
    case "GUILD_CREATE": case "GUILD_SYNC": set((st) => ({ guilds: { ...st.guilds, [d.id]: d } })); break;
    case "GUILD_DELETE": set((st) => { const g = { ...st.guilds }; delete g[d.id]; return { guilds: g }; }); break;
    case "GUILD_MEMBER_ADD": case "GUILD_MEMBER_UPDATE": {
      remember([d.user]);
      set((st) => ({ members: { ...st.members, [d.guild_id]: { ...(st.members[d.guild_id] ?? {}), [d.user.id]: d } } }));
      const g = s.guilds[d.guild_id];
      if (g && d.user.id === s.me?.id) set((st) => ({ guilds: { ...st.guilds, [g.id]: { ...g, me: { ...g.me, ...d } } } }));
      if (t === "GUILD_MEMBER_ADD" && g) set((st) => ({ guilds: { ...st.guilds, [g.id]: { ...st.guilds[g.id]!, member_count: g.member_count + 1 } } }));
      break;
    }
    case "GUILD_MEMBER_REMOVE": set((st) => {
      const m = { ...(st.members[d.guild_id] ?? {}) }; delete m[d.user_id];
      const g = st.guilds[d.guild_id];
      return { members: { ...st.members, [d.guild_id]: m }, guilds: g ? { ...st.guilds, [g.id]: { ...g, member_count: Math.max(0, g.member_count - 1) } } : st.guilds };
    }); break;
    case "CHANNEL_CREATE": case "CHANNEL_UPDATE":
      if (d && !d.guild_id) { remember(d.recipients ?? []); set((st) => ({ dms: { ...st.dms, [d.id]: d } })); }
      break;
    case "CHANNEL_DELETE": set((st) => { const dms = { ...st.dms }; delete dms[d.id]; return { dms }; }); break;
    case "MESSAGE_CREATE": {
      upsertMessages(d.channel_id, [d]);
      if (s.threads[d.channel_id]) patchChannel(d.channel_id, { thread: { ...s.threads[d.channel_id]!.thread!, message_count: (s.threads[d.channel_id]!.thread?.message_count ?? 0) + 1, last_activity_at: d.created_at, archived: false } });
      patchChannel(d.channel_id, { last_message_id: d.id });
      if (d.author.id === s.me?.id) set((st) => ({ readStates: { ...st.readStates, [d.channel_id]: { channel_id: d.channel_id, last_read_id: d.id, mention_count: 0 } } }));
      set((st) => { const ty = { ...(st.typing[d.channel_id] ?? {}) }; delete ty[d.author.id]; return { typing: { ...st.typing, [d.channel_id]: ty } }; });
      if (!d.guild_id && !s.dms[d.channel_id]) import("./actions.ts").then((a) => a.refreshDms());
      break;
    }
    case "MESSAGE_UPDATE": if (s.messages[d.channel_id]?.list.some((m) => m.id === d.id)) upsertMessages(d.channel_id, [d]); break;
    case "MESSAGE_DELETE": case "MESSAGE_DELETE_BULK": {
      const ids = new Set<string>(d.ids ?? [d.id]);
      set((st) => {
        const cur = st.messages[d.channel_id];
        if (!cur) return {};
        return { messages: { ...st.messages, [d.channel_id]: { ...cur, list: cur.list.filter((m) => !ids.has(m.id)) } } };
      });
      break;
    }
    case "MESSAGE_REACTION_ADD": case "MESSAGE_REACTION_REMOVE": {
      const add = t === "MESSAGE_REACTION_ADD";
      const mine = d.user_id === s.me?.id;
      // Someone else's super reaction plays its burst for everyone looking at the message (yours plays on click).
      if (add && d.burst && !mine && typeof window !== "undefined") setTimeout(() => window.dispatchEvent(new CustomEvent("send:burst", { detail: d })), 60);
      set((st) => {
        const cur = st.messages[d.channel_id];
        if (!cur) return {};
        const list = cur.list.map((m) => {
          if (m.id !== d.message_id) return m;
          const rs = [...m.reactions];
          const burst = !!d.burst;
          const i = rs.findIndex((r) => r.emoji === d.emoji && !!r.burst === burst);
          if (add) {
            if (i >= 0) { if (mine && rs[i]!.me) return m; rs[i] = { ...rs[i]!, count: rs[i]!.count + 1, me: rs[i]!.me || mine }; }
            else rs.push(burst ? { emoji: d.emoji, count: 1, me: mine, burst: true } : { emoji: d.emoji, count: 1, me: mine });
          } else if (i >= 0) {
            const c = rs[i]!.count - 1;
            if (c <= 0) rs.splice(i, 1); else rs[i] = { ...rs[i]!, count: c, me: mine ? false : rs[i]!.me };
          }
          return { ...m, reactions: rs };
        });
        return { messages: { ...st.messages, [d.channel_id]: { ...cur, list } } };
      });
      break;
    }
    case "TYPING_START": set((st) => ({ typing: { ...st.typing, [d.channel_id]: { ...(st.typing[d.channel_id] ?? {}), [d.user_id]: Date.now() + 9000 } } })); break;
    case "MESSAGE_ACK": set((st) => ({ readStates: { ...st.readStates, [d.channel_id]: { channel_id: d.channel_id, last_read_id: d.last_read_id, mention_count: 0 } } })); break;
    case "MENTION": set((st) => {
      const cur = st.readStates[d.channel_id] ?? { channel_id: d.channel_id, last_read_id: null, mention_count: 0 };
      return { readStates: { ...st.readStates, [d.channel_id]: { ...cur, mention_count: cur.mention_count + 1 } } };
    }); break;
    case "VOICE_STATE_UPDATE": if (d.user) remember([d.user]); set((st) => {
      const v = { ...st.voice };
      if (d.channel_id) v[d.user_id] = d; else delete v[d.user_id];
      return { voice: v };
    }); break;
    case "CALL_UPDATE": set((st) => ({ calls: { ...st.calls, [d.channel_id]: d } })); break;
    case "CALL_DELETE": set((st) => { const c = { ...st.calls }; delete c[d.channel_id]; return { calls: c }; }); break;
  }
  for (const fn of extra[t] ?? []) fn(d);
}

/** Text-capable channels, in display order, grouped under categories. */
export function channelTree(g: Guild) {
  const sorted = [...g.channels].sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const cats = sorted.filter((c) => c.type === ChannelType.CATEGORY);
  const loose = sorted.filter((c) => c.type !== ChannelType.CATEGORY && !c.parent_id);
  return { loose, cats: cats.map((c) => ({ cat: c, children: sorted.filter((x) => x.parent_id === c.id) })) };
}
