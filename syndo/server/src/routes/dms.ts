import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ChannelType, DEFAULT_PRIVACY, MessageType, RelationshipType } from "@send/shared";
import { config } from "../config.ts";
import { q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { bad, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { dropVoice, toUser, voiceStateOf } from "../gateway.ts";
import { removeFromRoom } from "../media.ts";
import { isBlockedBetween, type ChanRow } from "../perms.ts";
import { privateChannelsFor } from "../ready.ts";
import { createSystemMessage } from "./messages.ts";

const ID = z.string().regex(/^\d{1,20}$/);

async function channelFor(userId: string, channelId: string) {
  return (await privateChannelsFor(userId)).find((c) => c.id === channelId) ?? null;
}
async function recipients(channelId: string) {
  return (await q<{ user_id: string }>("select user_id::text from channel_recipients where channel_id = $1", [channelId])).map((r) => r.user_id);
}
async function emitChannel(channelId: string, t = "CHANNEL_UPDATE") {
  for (const u of await recipients(channelId)) toUser(u, t, await channelFor(u, channelId));
}
const isFriend = async (a: string, b: string) => !!(await q1("select 1 from relationships where user_id = $1 and other_id = $2 and type = $3", [a, b, RelationshipType.FRIEND]));

/** May `from` start a 1:1 conversation with `to`? Friends always; server-mates if `to` allows it; never across a block. */
async function canDm(from: string, to: string) {
  if (await isBlockedBetween(from, to)) return false;
  if (await isFriend(from, to)) return true;
  const t = await q1<any>("select privacy from users where id = $1 and deleted_at is null", [to]);
  if (!t) return false;
  if (!({ ...DEFAULT_PRIVACY, ...(t.privacy ?? {}) }).dms_from_server_members) return false;
  return !!(await q1("select 1 from members m1 join members m2 on m1.guild_id = m2.guild_id where m1.user_id = $1 and m2.user_id = $2 limit 1", [from, to]));
}

export async function patchGroupDm(req: FastifyRequest, ch: ChanRow) {
  if (ch.type !== ChannelType.GROUP_DM) throw bad("Only group conversations can be renamed.");
  const b = z.object({ name: z.string().trim().max(100).nullable() }).parse(req.body);
  await q("update channels set name = $2 where id = $1", [ch.id, b.name || null]);
  await createSystemMessage(ch.id, null, uid(req), MessageType.GROUP_RENAME, b.name ?? "");
  await emitChannel(ch.id);
  return channelFor(uid(req), ch.id);
}

export async function leaveGroupDm(req: FastifyRequest, ch: ChanRow) {
  const me = uid(req);
  if (!(await recipients(ch.id)).includes(me)) throw notFound("Channel");
  if (ch.type === ChannelType.DM) {
    // 1:1 DMs are "closed" client-side; history is kept for both people.
    toUser(me, "CHANNEL_DELETE", { id: ch.id });
    return { ok: true };
  }
  await removeRecipient(ch, me, me);
  return { ok: true };
}

async function removeRecipient(ch: ChanRow, target: string, actor: string) {
  await q("delete from channel_recipients where channel_id = $1 and user_id = $2", [ch.id, target]);
  if (voiceStateOf(target)?.channel_id === ch.id) { await dropVoice(target); await removeFromRoom(ch.id, target); }
  toUser(target, "CHANNEL_DELETE", { id: ch.id });
  const left = await recipients(ch.id);
  if (!left.length) { await q("delete from channels where id = $1", [ch.id]); return; }
  if (ch.owner_id === target) await q("update channels set owner_id = $2 where id = $1", [ch.id, left[0]]);
  await createSystemMessage(ch.id, null, actor, MessageType.RECIPIENT_REMOVE, "", [target]);
  await emitChannel(ch.id);
}

export async function dmRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/users/@me/channels", async (req) => privateChannelsFor(uid(req)));

  /** Open a 1:1 DM ({recipient_id}) or create a group DM ({recipients: [...]}). */
  app.post("/api/users/@me/channels", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ recipient_id: ID.optional(), recipients: z.array(ID).max(config.limits.max_group_dm_recipients).optional(), name: z.string().trim().max(100).optional() }).parse(req.body);
    const me = uid(req);
    if (b.recipient_id) {
      const other = b.recipient_id;
      if (other === me) throw bad("You can't message yourself here: try saved messages.");
      const [low, high] = BigInt(me) < BigInt(other) ? [me, other] : [other, me];
      const existing = await q1<any>("select channel_id::text from dm_pairs where low_id = $1 and high_id = $2", [low, high]);
      if (existing) {
        const c = await channelFor(me, existing.channel_id);
        toUser(me, "CHANNEL_CREATE", c);
        return c;
      }
      if (!(await q1("select 1 from users where id = $1 and deleted_at is null", [other]))) throw notFound("User");
      if (!(await canDm(me, other))) throw forbidden("You can't message this person. You need to be friends, or share a server with them and have them allow messages from server members.");
      const id = newId();
      await tx(async (c) => {
        await c.query("insert into channels(id, type) values ($1, $2)", [id, ChannelType.DM]);
        await c.query("insert into channel_recipients(channel_id, user_id) values ($1,$2),($1,$3)", [id, me, other]);
        await c.query("insert into dm_pairs(low_id, high_id, channel_id) values ($1,$2,$3)", [low, high, id]);
      });
      const c = await channelFor(me, id);
      toUser(me, "CHANNEL_CREATE", c);
      return c;
    }
    const list = [...new Set(b.recipients ?? [])].filter((x) => x !== me);
    if (list.length < 1) throw bad("Pick at least one friend.");
    if (list.length + 1 > config.limits.max_group_dm_recipients) throw bad(`Group conversations hold up to ${config.limits.max_group_dm_recipients} people.`);
    for (const u of list) if (!(await isFriend(me, u)) || (await isBlockedBetween(me, u))) throw forbidden("You can only add friends to a group conversation.");
    const id = newId();
    await tx(async (c) => {
      await c.query("insert into channels(id, type, owner_id, name) values ($1,$2,$3,$4)", [id, ChannelType.GROUP_DM, me, b.name || null]);
      for (const u of [me, ...list]) await c.query("insert into channel_recipients(channel_id, user_id) values ($1,$2)", [id, u]);
    });
    for (const u of [me, ...list]) toUser(u, "CHANNEL_CREATE", await channelFor(u, id));
    return channelFor(me, id);
  });

  app.put<{ Params: { cid: string; uid: string } }>("/api/channels/:cid/recipients/:uid", async (req) => {
    const me = uid(req);
    const ch = await q1<ChanRow>("select * from channels where id = $1 and type = $2", [req.params.cid, ChannelType.GROUP_DM]);
    if (!ch || !(await recipients(ch.id)).includes(me)) throw notFound("Channel");
    const target = req.params.uid;
    const current = await recipients(ch.id);
    if (current.includes(target)) return channelFor(me, ch.id);
    if (current.length >= config.limits.max_group_dm_recipients) throw bad(`Group conversations hold up to ${config.limits.max_group_dm_recipients} people.`);
    if (!(await isFriend(me, target))) throw forbidden("You can only add friends.");
    for (const u of current) if (await isBlockedBetween(u, target)) throw forbidden("That person can't be added to this conversation.");
    await q("insert into channel_recipients(channel_id, user_id) values ($1,$2)", [ch.id, target]);
    await createSystemMessage(ch.id, null, me, MessageType.RECIPIENT_ADD, "", [target]);
    toUser(target, "CHANNEL_CREATE", await channelFor(target, ch.id));
    await emitChannel(ch.id);
    return channelFor(me, ch.id);
  });

  app.delete<{ Params: { cid: string; uid: string } }>("/api/channels/:cid/recipients/:uid", async (req) => {
    const me = uid(req);
    const ch = await q1<ChanRow>("select * from channels where id = $1 and type = $2", [req.params.cid, ChannelType.GROUP_DM]);
    if (!ch || !(await recipients(ch.id)).includes(me)) throw notFound("Channel");
    if (req.params.uid !== me && ch.owner_id !== me) throw forbidden("Only the group owner can remove people.");
    if (!(await recipients(ch.id)).includes(req.params.uid)) throw notFound("Recipient");
    await removeRecipient(ch, req.params.uid, me);
    return { ok: true };
  });
}
