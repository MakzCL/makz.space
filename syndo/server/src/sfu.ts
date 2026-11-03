import { config } from "./config.ts";
import { ApiError } from "./errors.ts";
export type Publication = { name:string; mid:string; kind:"mic"|"camera"|"screen"|"screen-audio" };
export type SfuPeer = { id:string; consumer:string; user:string; name:string; auth:string; channel:string; publications:Publication[]; consumerMids:Set<string>; touched:number; tail:Promise<unknown> };
export const sfuPeers=new Map<string,SfuPeer>();
export const sfuConfigured=()=>!!(config.sfu.appId&&config.sfu.secret);
export async function sfuRequest(path:string,method="POST",body?:unknown):Promise<any>{
 const r=await fetch(`https://rtc.live.cloudflare.com/v1/apps/${config.sfu.appId}${path}`,{method,headers:{authorization:`Bearer ${config.sfu.secret}`,"content-type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const data:any=await r.json();if(!r.ok||data.errorCode||data.tracks?.some((t:any)=>t.errorCode))throw new ApiError(502,"media_error","The media service couldn't complete this connection. Leave and try again.");return data;
}
export async function openSfu(user:string,auth:string,channel:string,name=user){
 await closeSfuAccount(user);
 const [producer,consumer]=await Promise.all([sfuRequest("/sessions/new"),sfuRequest("/sessions/new")]);
 const p:SfuPeer={id:producer.sessionId,consumer:consumer.sessionId,user,name,auth,channel,publications:[],consumerMids:new Set(),touched:Date.now(),tail:Promise.resolve()};sfuPeers.set(p.id,p);return p;
}
export async function serial<T>(p:SfuPeer,fn:()=>Promise<T>):Promise<T>{const work=p.tail.then(fn);p.tail=work.catch(()=>{});return work;}
async function closeMatching(matches:(p:SfuPeer)=>boolean){
 const peers=[...sfuPeers.values()].filter(matches);
 // Revoke admission first, then wait for any already-running publication to finish before closing its tracks.
 for(const p of peers)sfuPeers.delete(p.id);
 await Promise.allSettled(peers.map(async p=>{await p.tail;await Promise.allSettled([close(p.id,p.publications.map(t=>t.mid)),close(p.consumer,[...p.consumerMids])]);}));
}
export const closeSfuUser=(channel:string,user:string)=>closeMatching(p=>p.channel===channel&&p.user===user);
export const closeSfuSession=(auth:string)=>closeMatching(p=>p.auth===auth);
export const closeSfuAccount=(user:string)=>closeMatching(p=>p.user===user);
export async function close(session:string,mids:string[]){if(mids.length)await sfuRequest(`/sessions/${session}/tracks/close`,"PUT",{force:true,tracks:mids.map(mid=>({mid}))});}
export async function restrictSfu(channel:string,user:string,speak:boolean,video:boolean){for(const p of sfuPeers.values())if(p.channel===channel&&p.user===user){const remove=p.publications.filter(t=>t.kind==="mic"?!speak:!video);await close(p.id,remove.map(t=>t.mid));p.publications=p.publications.filter(t=>!remove.includes(t));}}
const sweep=setInterval(()=>{for(const p of sfuPeers.values())if(Date.now()-p.touched>120000)closeSfuUser(p.channel,p.user).catch(()=>{});},30000);sweep.unref();
