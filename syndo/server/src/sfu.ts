import { config } from "./config.ts";
import { ApiError } from "./errors.ts";
import { toUsers } from "./gateway.ts";
export type Publication = { name:string; mid:string; kind:"mic"|"camera"|"screen"|"screen-audio" };
export type SfuPeer = { id:string; consumer:string; user:string; name:string; auth:string; channel:string; publications:Publication[]; consumerMids:Set<string>; touched:number; tail:Promise<unknown> };
export const sfuPeers=new Map<string,SfuPeer>();
export const sfuConfigured=()=>!!(config.sfu.appId&&config.sfu.secret);
export async function sfuRequest(path:string,method="POST",body?:unknown):Promise<any>{
 const r=await fetch(`https://rtc.live.cloudflare.com/v1/apps/${config.sfu.appId}${path}`,{method,headers:{authorization:`Bearer ${config.sfu.secret}`,"content-type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const text=await r.text();let data:any;try{data=JSON.parse(text);}catch{data={errorCode:`http_${r.status}`,errorDescription:text.slice(0,200)};}
 const failed=!r.ok||data.errorCode||data.tracks?.some((t:any)=>t.errorCode);
 if(failed){const detail=[data.errorCode,data.errorDescription,...(data.tracks??[]).filter((t:any)=>t.errorCode).map((t:any)=>`${t.trackName??t.mid}: ${t.errorCode} ${t.errorDescription??""}`)].filter(Boolean).join("; ");console.error("[sfu]",method,path.replace(/[0-9a-f]{32,}/g,"…"),r.status,detail);
  // 409/422-style errors are not gateway failures; report them as such so proxies don't replace the body with an error page.
  const e=new ApiError(409,"media_error","The media service couldn't complete this connection. Leave and try again.");(e as any).references=detail.slice(0,300);throw e;}
 return data;
}
export async function openSfu(user:string,auth:string,channel:string,name=user){
 await closeSfuAccount(user);
 const [producer,consumer]=await Promise.all([sfuRequest("/sessions/new"),sfuRequest("/sessions/new")]);
 const p:SfuPeer={id:producer.sessionId,consumer:consumer.sessionId,user,name,auth,channel,publications:[],consumerMids:new Set(),touched:Date.now(),tail:Promise.resolve()};sfuPeers.set(p.id,p);announceMedia(channel,user);return p;
}
export async function serial<T>(p:SfuPeer,fn:()=>Promise<T>):Promise<T>{const work=p.tail.then(fn);p.tail=work.catch(()=>{});return work;}
async function closeMatching(matches:(p:SfuPeer)=>boolean){
 const peers=[...sfuPeers.values()].filter(matches);
 // Revoke admission first, then wait for any already-running publication to finish before closing its tracks.
 for(const p of peers)sfuPeers.delete(p.id);for(const p of peers)announceMedia(p.channel,p.user);
 await Promise.allSettled(peers.map(async p=>{await p.tail;await Promise.allSettled([close(p.id,p.publications.map(t=>t.mid)),close(p.consumer,[...p.consumerMids])]);}));
}
export const closeSfuUser=(channel:string,user:string)=>closeMatching(p=>p.channel===channel&&p.user===user);
export const closeSfuSession=(auth:string)=>closeMatching(p=>p.auth===auth);
export const closeSfuAccount=(user:string)=>closeMatching(p=>p.user===user);
export async function close(session:string,mids:string[]){if(mids.length)await sfuRequest(`/sessions/${session}/tracks/close`,"PUT",{force:true,tracks:mids.map(mid=>({mid}))});}
export async function restrictSfu(channel:string,user:string,speak:boolean,video:boolean){for(const p of sfuPeers.values())if(p.channel===channel&&p.user===user){const remove=p.publications.filter(t=>t.kind==="mic"?!speak:!video);await close(p.id,remove.map(t=>t.mid));p.publications=p.publications.filter(t=>!remove.includes(t));}}
const sweep=setInterval(()=>{for(const p of sfuPeers.values())if(Date.now()-p.touched>120000)closeSfuUser(p.channel,p.user).catch(()=>{});},30000);sweep.unref();

/**
 * Short-lived Cloudflare TURN credentials. Without a relay, anyone whose network blocks direct UDP
 * (strict NAT, corporate/school Wi-Fi, some mobile carriers) can never connect media. TURN over TLS on
 * port 443 gets through those networks. Falls back to STUN only if TURN isn't configured or unreachable.
 */
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
export async function iceServers(): Promise<RTCIceServerLike[]> {
 if (!config.sfu.turnKeyId || !config.sfu.turnKeyToken) return STUN;
 try {
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${config.sfu.turnKeyId}/credentials/generate-ice-servers`, { method: "POST", headers: { authorization: `Bearer ${config.sfu.turnKeyToken}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`TURN credentials ${r.status}`);
  const data: any = await r.json();
  const list = (Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers]).filter(Boolean)
   // Browsers time out on port-53 TURN URLs (often blocked); drop them.
   .map((s: any) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u: string) => !/:53(\?|$)/.test(u)) }));
  return list.length ? list : STUN;
 } catch (e) { console.error("[turn]", (e as Error).message); return STUN; }
}
type RTCIceServerLike = { urls: string[] | string; username?: string; credential?: string };

/** Tell everyone else in the call that publications changed, so they subscribe now instead of on their next poll. */
export function announceMedia(channel:string,except:string){const users=new Set([...sfuPeers.values()].filter(p=>p.channel===channel&&p.user!==except).map(p=>p.user));if(users.size)toUsers(users,"VOICE_MEDIA_UPDATE",{channel_id:channel});}
