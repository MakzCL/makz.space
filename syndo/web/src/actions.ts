import { ApiError, api, errMsg, upload, uploadLarge } from "./api.ts";
import { connectGateway, disconnectGateway } from "./gateway.ts";
import { navigate } from "./router.ts";
import { messagesApi, toast, useStore, type UIMessage } from "./store.ts";
import type { Channel, Message , Sticker } from "@syndo/shared";
import { previewMode } from "./preview-mode.ts";

const set = useStore.setState;
const get = useStore.getState;

export async function boot() {
  if (previewMode) { (await import("./preview.ts")).startPreview(); return; }
  try {
    await api.get("/api/users/@me");
    set({ conn: "connecting" });
    connectGateway();
  } catch (e) {
    set({ conn: "signed_out" });
    if (e instanceof ApiError && e.code === "mfa_required") navigate("/login?mfa=1", true);
  }
}

export function signedIn() { set({ conn: "connecting" }); connectGateway(); }

export function signedOut(reason?: string) {
  disconnectGateway();
  useStore.setState({ conn: "signed_out", me: null, guilds: {}, dms: {}, relationships: {}, messages: {}, readStates: {}, voice: {}, calls: {}, members: {} });
  import("./voice/session.ts").then((v) => v.leaveVoice()).catch(() => {});
  if (reason) toast(reason, "info");
  navigate("/login");
}

export async function logout() {
  await api.post("/api/auth/logout").catch(() => {});
  signedOut();
}

/* ------------------------------------------------------------- messages -- */
export async function loadMessages(channelId: string, opts: { before?: string; around?: string; latest?: boolean } = {}) {
  const cur = get().messages[channelId];
  if (cur?.loading) return;
  set((s) => ({ messages: { ...s.messages, [channelId]: { ...(cur ?? { list: [], hasMore: true, loaded: false }), loading: true } } }));
  try {
    const qs = opts.before ? `&before=${opts.before}` : opts.around ? `&around=${opts.around}` : "";
    const list = await api.get<Message[]>(`/api/channels/${channelId}/messages?limit=50${qs}`);
    messagesApi.upsertMessages(channelId, list, { hasMore: opts.around ? true : list.length === 50, replace: !!opts.around || !!opts.latest });
  } catch (e) {
    set((s) => ({ messages: { ...s.messages, [channelId]: { ...(s.messages[channelId] ?? { list: [], hasMore: false, loaded: true }), loading: false, loaded: true } } }));
    if (!(e instanceof ApiError && e.status === 404)) toast(errMsg(e), "error");
  }
}

/** After a reconnect: fetch anything newer than the newest message each loaded channel already has. */
export async function resyncOpenChannels() {
  for (const [cid, m] of Object.entries(get().messages)) {
    const last = [...m.list].reverse().find((x) => !x._state);
    if (!last) continue;
    try {
      let after = last.id;
      for (let i = 0; i < 5; i++) {
        const newer = await api.get<Message[]>(`/api/channels/${cid}/messages?after=${after}&limit=100`);
        if (!newer.length) break;
        messagesApi.upsertMessages(cid, newer);
        after = newer[0]!.id;
        if (newer.length < 100) break;
      }
    } catch { /* channel may be gone */ }
  }
}

const nonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export interface SendExtras { mention_author?: boolean; silent?: boolean; flags?: number; poll?: { question: string; answers: { text: string; emoji?: string | null }[]; duration_hours: number; allow_multiselect: boolean }; forward?: { message_id: string; channel_id: string } }
export async function sendMessage(channelId: string, content: string, opts: { reply_to?: string; attachment_ids?: string[]; sticker?: Sticker; retryOf?: UIMessage; extra?: SendExtras } = {}) {
  const sticker = opts.sticker ?? opts.retryOf?.stickers?.[0];
  const me = get().me!;
  const n = opts.retryOf?.nonce ?? nonce();
  const tempId = opts.retryOf?.id ?? `pending-${n}`;
  const temp: UIMessage = {
    id: tempId, channel_id: channelId, guild_id: null, author: me, content, type: 0, created_at: new Date().toISOString(),
    edited_at: null, pinned: false, reply_to: null, mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], nonce: n, _state: "pending", stickers: sticker ? [sticker] : [],
  };
  messagesApi.upsertMessages(channelId, [temp]);
  try {
    const extra = opts.extra ?? (opts.retryOf as any)?._extra ?? {};
    if (/^@silent\s/.test(content)) { content = content.replace(/^@silent\s+/, ""); extra.silent = true; }
    const m = await api.post<Message>(`/api/channels/${channelId}/messages`, { content, nonce: n, reply_to: opts.reply_to, attachment_ids: opts.attachment_ids ?? [], ...(sticker ? { sticker_ids: [sticker.id] } : {}), ...extra });
    messagesApi.upsertMessages(channelId, [m]);
  } catch (e) {
    const msg = errMsg(e);
    // Keep content so the user can retry; same nonce makes the retry idempotent.
    set((s) => {
      const cur = s.messages[channelId]; if (!cur) return {};
      return { messages: { ...s.messages, [channelId]: { ...cur, list: cur.list.map((x) => (x.id === tempId ? { ...x, _state: "failed", _error: msg, _extra: opts.extra } as UIMessage : x)) } } };
    });
  }
}

export function discardFailed(channelId: string, id: string) {
  set((s) => { const cur = s.messages[channelId]; if (!cur) return {}; return { messages: { ...s.messages, [channelId]: { ...cur, list: cur.list.filter((m) => m.id !== id) } } }; });
}

let lastAck: Record<string, string> = {};
export function ackChannel(ch: Channel) {
  if (!ch.last_message_id || lastAck[ch.id] === ch.last_message_id) return;
  const rs = get().readStates[ch.id];
  if (rs?.last_read_id && BigInt(rs.last_read_id) >= BigInt(ch.last_message_id) && !rs.mention_count) return;
  lastAck[ch.id] = ch.last_message_id;
  set((s) => ({ readStates: { ...s.readStates, [ch.id]: { channel_id: ch.id, last_read_id: ch.last_message_id, mention_count: 0 } } }));
  api.post(`/api/channels/${ch.id}/messages/${ch.last_message_id}/ack`).catch(() => { delete lastAck[ch.id]; });
}

let lastTyping = 0;
export function sendTyping(channelId: string) {
  if (Date.now() - lastTyping < 8000) return;
  lastTyping = Date.now();
  api.post(`/api/channels/${channelId}/typing`).catch(() => {});
}

export async function toggleReaction(m: Message, emoji: string) {
  const mine = m.reactions.find((r) => r.emoji === emoji)?.me;
  const path = `/api/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}/@me`;
  try { mine ? await api.del(path) : await api.put(path); } catch (e) { toast(errMsg(e), "error"); }
}

export interface PendingUpload { key: string; file: File; progress: number; status: "uploading" | "done" | "error"; error?: string; id?: string; cancel?: () => void; spoiler?: boolean }

/** Files bigger than this go to storage in pieces (Cloudflare caps a single request at 100 MB). */
export const LARGE_UPLOAD_FROM = 20 * 1024 * 1024;

export function startUpload(channelId: string, file: File, onUpdate: (u: PendingUpload) => void, extraFields: Record<string, string> = {}) {
  const key = nonce();
  const u: PendingUpload = { key, file, progress: 0, status: "uploading" };
  // Big files (not end-to-end-encrypted ones) skip the single-request upload and go to storage in pieces.
  const big = file.size > LARGE_UPLOAD_FROM && extraFields.encrypted !== "1";
  const form = new FormData();
  if (!big) { for (const [k, v] of Object.entries(extraFields)) form.append(k, v); form.append("file", file, file.name); }
  const { promise, cancel } = big
    ? uploadLarge<{ id: string }>(channelId, file, extraFields, (p) => onUpdate({ ...u, progress: p, cancel }))
    : upload<{ id: string }>(`/api/channels/${channelId}/attachments`, form, (p) => onUpdate({ ...u, progress: p, cancel }));
  u.cancel = cancel;
  onUpdate(u);
  promise.then((r) => onUpdate({ ...u, progress: 1, status: "done", id: r.id }))
    .catch((e) => onUpdate({ ...u, status: "error", error: errMsg(e) }));
  return u;
}

export async function refreshDms() {
  // A DM we didn't know about yet (someone messaged us first).
  try {
    const list = await api.get<Channel[]>("/api/users/@me/channels");
    set({ dms: Object.fromEntries(list.map((c) => [c.id, c])) });
  } catch { /* */ }
}

export async function openDm(userId: string) {
  try {
    const c = await api.post<Channel>("/api/users/@me/channels", { recipient_id: userId });
    set((s) => ({ dms: { ...s.dms, [c.id]: c } }));
    navigate(`/channels/@me/${c.id}`);
  } catch (e) { toast(errMsg(e), "error"); }
}

export async function loadMembers(guildId: string) {
  try {
    const list = await api.get<any[]>(`/api/guilds/${guildId}/members?limit=1000`);
    const map: Record<string, any> = {};
    for (const m of list) map[m.user.id] = m;
    set((s) => ({ members: { ...s.members, [guildId]: map }, presences: { ...s.presences, ...Object.fromEntries(list.map((m) => [m.user.id, m.presence])) }, users: { ...s.users, ...Object.fromEntries(list.map((m) => [m.user.id, m.user])) } }));
  } catch { /* */ }
}

export async function updateSettings(patch: Record<string, unknown>) {
  const me = get().me;
  if (me) set({ me: { ...me, settings: { ...me.settings, ...patch } } });
  try { await api.patch("/api/users/@me/settings", patch); } catch (e) { toast(errMsg(e), "error"); }
}

/** Persist before confirming the change; failed writes leave the old mute state intact. */
export async function setConversationMuted(channelId: string, muted: boolean) {
  const me = get().me;
  if (!me) return;
  const previous = me.settings?.muted_channels;
  const ids = Array.isArray(previous) ? previous.filter((x): x is string => typeof x === "string") : [];
  const next = muted ? [...new Set([...ids, channelId])] : ids.filter((id) => id !== channelId);
  const settings = await api.patch<Record<string, unknown>>("/api/users/@me/settings", { muted_channels: next });
  set((s) => s.me?.id === me.id ? { me: { ...s.me, settings } } : {});
}
