import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { startServer,stopServer,Client } from "./helpers.ts";
import { newIdentity,seal,unseal } from "../../web/src/crypto/core.ts";
import { config } from "../src/config.ts";
import { q1 } from "../src/db.ts";
before(startServer);after(stopServer);
test("production DMs fail closed, store only ciphertext and preserve key identity",async()=>{
 const a=new Client("cryptoana"),b=new Client("cryptoben"),c=new Client("cryptocam");await a.register();await b.register();await c.register();
 const ka=await newIdentity(),kb=await newIdentity();
 assert.equal((await a.put("/api/encryption/identity",{public_key:ka.publicKey})).status,200);
 assert.equal((await b.put("/api/encryption/identity",{public_key:kb.publicKey})).status,200);
 assert.equal((await a.put("/api/encryption/identity",{public_key:kb.publicKey})).status,409);
 await a.post("/api/users/@me/relationships",{username:b.user.username});await b.put(`/api/users/@me/relationships/${a.user.id}`,{type:1});
 const opened=await a.post("/api/users/@me/channels",{recipient_id:b.user.id});assert.equal(opened.status,200);const dm=opened.body;
 assert.ok([403,404].includes((await c.get(`/api/channels/${dm.id}/encryption`)).status));
 const previous=config.requireDmE2ee;config.requireDmE2ee=true;
 try{
  assert.equal((await a.post(`/api/channels/${dm.id}/messages`,{content:"plaintext must not pass"})).status,400);
  const wire=await seal(ka,a.user.id,dm.id,[{user:a.user.id,publicKey:ka.publicKey},{user:b.user.id,publicKey:kb.publicKey}],{content:"private hello",files:[]});
  const sent=await a.post(`/api/channels/${dm.id}/messages`,{content:wire});assert.equal(sent.status,200);
  const stored=await q1<any>("select content from messages where id=$1",[sent.body.id]);assert.equal(stored.content,wire);assert.ok(!stored.content.includes("private hello"));
  const history=(await b.get(`/api/channels/${dm.id}/messages`)).body;assert.equal((await unseal(kb,b.user.id,dm.id,a.user.id,history[0].content,ka.publicKey)).content,"private hello");
  assert.equal((await a.patch(`/api/channels/${dm.id}/messages/${sent.body.id}`,{content:"unencrypted edit"})).status,400);
 }finally{config.requireDmE2ee=previous;}
});
