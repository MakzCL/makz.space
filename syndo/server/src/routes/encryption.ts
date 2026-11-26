import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, uid } from "../auth.ts";
import { q, q1 } from "../db.ts";
import { bad, conflict } from "../errors.ts";
import { requireChannel } from "../perms.ts";
import { config } from "../config.ts";
export const PREFIX = "SEND_E2EE_V1:";
const hexKey = z.string().regex(/^[0-9a-f]{64}$/);
const envelope = z.object({ v: z.literal(1), sender: z.string(), senderKey: hexKey, channel: z.string(), boxes: z.array(z.object({ user: z.string().regex(/^\d{1,20}$/), nonce: z.string().regex(/^[0-9a-f]{48}$/), ciphertext: z.string().min(22).max(40000).regex(/^[A-Za-z0-9_-]+$/) }).strict()).min(2).max(11) }).strict();
export async function validateDmWire(content: string, channel: { id: string; guild_id: string | null }, sender: string) {
  if (channel.guild_id) { if (content.length > config.limits.max_message_length || content.startsWith(PREFIX)) throw bad("Invalid server message."); return; }
  if (!content.startsWith(PREFIX)) { if (content.length > config.limits.max_message_length) throw bad("Message is too long."); if (config.requireDmE2ee) throw bad("Update SEND: new direct messages require end-to-end encryption.", "encryption_required"); return; }
  let raw; try { raw = JSON.parse(content.slice(PREFIX.length)); } catch { throw bad("Invalid encrypted message."); }
  const e = envelope.parse(raw);
  if (e.channel !== channel.id || e.sender !== sender) throw bad("Encryption context does not match this conversation.");
  const keys = await q<{ user_id: string; public_key: string }>("select r.user_id::text, k.public_key from channel_recipients r left join dm_identity_keys k on k.user_id=r.user_id where r.channel_id=$1", [channel.id]);
  if (keys.find(k => k.user_id === sender)?.public_key !== e.senderKey) throw bad("Sender encryption identity does not match.");
  if (keys.length !== e.boxes.length || new Set(e.boxes.map(b => b.user)).size !== keys.length || keys.some(k => !k.public_key || !e.boxes.some(b => b.user === k.user_id))) throw bad("Every current recipient needs an encrypted copy. Refresh the conversation.");
}
export async function encryptionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);
  app.get("/api/encryption/identity", async req => ({ identity: await q1("select user_id::text, public_key from dm_identity_keys where user_id=$1", [uid(req)]) }));
  app.put("/api/encryption/identity", async req => {
    const { public_key } = z.object({public_key:hexKey}).strict().parse(req.body);
    await q("insert into dm_identity_keys(user_id,public_key) values($1,$2) on conflict(user_id) do nothing", [uid(req),public_key]);
    const row = await q1<any>("select public_key from dm_identity_keys where user_id=$1",[uid(req)]);
    if (row.public_key !== public_key) throw conflict("Restore your existing recovery key on this device. Your encryption identity cannot be silently replaced.");
    return { ok:true };
  });
  app.get<{Params:{cid:string}}>("/api/channels/:cid/encryption", async req => {
    const {channel}=await requireChannel(uid(req),req.params.cid);if(channel.guild_id)throw bad("This is not a direct conversation.");
    return { identities: await q("select r.user_id::text, k.public_key from channel_recipients r left join dm_identity_keys k on k.user_id=r.user_id where r.channel_id=$1 order by r.user_id",[channel.id]) };
  });
}
