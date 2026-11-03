import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { startServer,stopServer,Client } from "./helpers.ts";
import { config } from "../src/config.ts";
import { closeSfuUser } from "../src/sfu.ts";
before(startServer);after(stopServer);
test("SFU signaling isolates accounts and channels, authorizes publishing and closes tracks",async()=>{
 const a=await new Client("voiceana").register(),b=await new Client("voiceben").register(),c=await new Client("voicecam").register();
 await a.post("/api/users/@me/relationships",{username:b.user.username});await b.put(`/api/users/@me/relationships/${a.user.id}`,{type:1});
 const dm=(await a.post("/api/users/@me/channels",{recipient_id:b.user.id})).body;
 const original=globalThis.fetch,previous={...config.sfu};let next=0,closed=0;
 config.sfu.appId="test-app";config.sfu.secret="test-secret";
 globalThis.fetch=(async(input:any,init:any)=>{if(!String(input).startsWith("https://rtc.live.cloudflare.com/"))return original(input,init);let result:any={};if(String(input).endsWith("/sessions/new"))result={sessionId:"test-session-"+(++next)};if(String(input).endsWith("/tracks/new"))result={sessionDescription:{type:"answer",sdp:"fake-test-sdp"},tracks:[]};if(String(input).endsWith("/tracks/close"))closed++;return new Response(JSON.stringify(result),{headers:{"content-type":"application/json"}})}) as typeof fetch;
 try{
  const joined=await a.post("/api/voice/token",{channel_id:dm.id});assert.equal(joined.status,200);assert.equal(joined.body.provider,"cloudflare");const id=joined.body.session;
  assert.equal((await b.post(`/api/voice/sfu/${id}/peers`,{})).status,403);
  assert.equal((await c.post("/api/voice/token",{channel_id:dm.id})).status,404);
  assert.equal((await a.post(`/api/voice/sfu/${id}/publish`,{sessionDescription:{type:"offer",sdp:"test-sdp"},tracks:[{mid:"0",kind:"mic",name:"mic_test"}]})).status,200);
  assert.equal((await a.post(`/api/voice/sfu/${id}/subscribe`,{tracks:[{session:"not-in-channel",name:"secret"}]})).status,403);
  assert.equal((await a.post(`/api/voice/sfu/${id}/leave`,{})).status,200);assert.ok(closed>0);
  assert.equal((await a.post(`/api/voice/sfu/${id}/peers`,{})).status,403);
 }finally{await closeSfuUser(dm.id,a.user.id);Object.assign(config.sfu,previous);globalThis.fetch=original;}
});
