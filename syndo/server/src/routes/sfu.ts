import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { P,has } from "@syndo/shared";
import { requireUser,uid } from "../auth.ts";
import { requireChannel } from "../perms.ts";
import { q1 } from "../db.ts";
import { bad,forbidden } from "../errors.ts";
import { sfuPeers,sfuRequest,serial,close,closeSfuUser } from "../sfu.ts";
import { voiceStates } from "../gateway.ts";
const desc=z.object({type:z.enum(["offer","answer"]),sdp:z.string().max(200000)});
const kinds=z.enum(["mic","camera","screen","screen-audio"]);
export async function sfuRoutes(app:FastifyInstance){app.addHook("preHandler",requireUser);
 app.post<{Params:{id:string;op:string}}>("/api/voice/sfu/:id/:op",async req=>{
  const p=sfuPeers.get(req.params.id);if(!p||p.user!==uid(req)||p.auth!==req.session!.id)throw forbidden("This media session is not yours.");
  const {channel,perms}=await requireChannel(uid(req),p.channel,P.CONNECT);p.touched=Date.now();
  if(req.params.op==="leave"){await closeSfuUser(p.channel,p.user);return {ok:true};}
  return serial(p,async()=>{
   if(sfuPeers.get(p.id)!==p)throw forbidden("This media session has ended.");
   if(req.params.op==="peers")return {peers:[...sfuPeers.values()].filter(x=>x.channel===p.channel&&x.id!==p.id).map(x=>({id:x.user,name:x.name,session:x.id,tracks:x.publications.map(t=>({name:t.name,kind:t.kind})),muted:voiceStates().find(v=>v.user_id===x.user)?.self_mute??false}))};
   if(req.params.op==="publish"){
    const b=z.object({sessionDescription:desc,tracks:z.array(z.object({mid:z.string().regex(/^\d+$/),kind:kinds,name:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)})).max(4)}).parse(req.body);
    const member=channel.guild_id?await q1<any>("select mute from members where guild_id=$1 and user_id=$2",[channel.guild_id,p.user]):null;
    if(b.tracks.some(t=>t.kind==="mic"?(!has(perms,P.SPEAK)||member?.mute):!has(perms,P.VIDEO)))throw forbidden("You cannot publish this media.");
    const r=await sfuRequest(`/sessions/${p.id}/tracks/new`,"POST",{sessionDescription:b.sessionDescription,tracks:b.tracks.map(t=>({location:"local",mid:t.mid,trackName:t.name}))});
    for(const t of b.tracks){p.publications=p.publications.filter(x=>x.kind!==t.kind);p.publications.push({mid:t.mid,name:t.name,kind:t.kind});}return r;
   }
   if(req.params.op==="subscribe"){
    const {tracks}=z.object({tracks:z.array(z.object({session:z.string().max(80),name:z.string().max(80)})).max(64)}).parse(req.body);
    for(const t of tracks){const owner=sfuPeers.get(t.session);if(!owner||owner.channel!==p.channel||!owner.publications.some(x=>x.name===t.name))throw forbidden("Track is outside this channel.");}
    if(!tracks.length)return {tracks:[]};
    const r=await sfuRequest(`/sessions/${p.consumer}/tracks/new`,"POST",{tracks:tracks.map(t=>({location:"remote",sessionId:t.session,trackName:t.name}))});for(const t of r.tracks??[])if(t.mid)p.consumerMids.add(t.mid);return r;
   }
   if(req.params.op==="answer"){const b=z.object({sessionDescription:desc}).parse(req.body);return sfuRequest(`/sessions/${p.consumer}/renegotiate`,"PUT",b);}
   if(req.params.op==="close"){const {kind}=z.object({kind:kinds}).parse(req.body);const ts=p.publications.filter(t=>t.kind===kind);await close(p.id,ts.map(t=>t.mid));p.publications=p.publications.filter(t=>t.kind!==kind);return {ok:true};}
   if(req.params.op==="unsubscribe"){const {mids}=z.object({mids:z.array(z.string()).max(64)}).parse(req.body);if(mids.some(mid=>!p.consumerMids.has(mid)))throw forbidden();await close(p.consumer,mids);for(const mid of mids)p.consumerMids.delete(mid);return {ok:true};}
   throw bad("Unknown media action.");
  });
 });
}
