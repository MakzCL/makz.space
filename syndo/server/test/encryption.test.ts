import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { startServer,stopServer,Client } from "./helpers.ts";
import { newIdentity,seal,unseal,encryptFile,decryptFile } from "../../web/src/crypto/core.ts";
import { config } from "../src/config.ts";
import { q1 } from "../src/db.ts";
let base="";before(async()=>{base=await startServer();});after(stopServer);
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
  const plain=new TextEncoder().encode("private attachment bytes"),file=await encryptFile(plain),form=new FormData();form.set("encrypted","1");form.set("file",new Blob([new Uint8Array(file.bytes)],{type:"application/octet-stream"}),"encrypted.send");
  const uploaded=await a.req("POST",`/api/channels/${dm.id}/attachments`,form);assert.equal(uploaded.status,200);assert.equal(uploaded.body.filename,"encrypted.send");assert.equal(uploaded.body.content_type,"application/octet-stream");
  assert.equal((await b.get(uploaded.body.url)).status,404,"unattached ciphertext stays private to its uploader");
  const wire=await seal(ka,a.user.id,dm.id,[{user:a.user.id,publicKey:ka.publicKey},{user:b.user.id,publicKey:kb.publicKey}],{content:"private hello",files:[{id:uploaded.body.id,name:"private-notes.txt",type:"text/plain",size:plain.length,key:file.key,nonce:file.nonce}]});
  const sent=await a.post(`/api/channels/${dm.id}/messages`,{content:wire,attachment_ids:[uploaded.body.id]});assert.equal(sent.status,200);
  const stored=await q1<any>("select content from messages where id=$1",[sent.body.id]);assert.equal(stored.content,wire);assert.ok(!stored.content.includes("private hello"));
  const history=(await b.get(`/api/channels/${dm.id}/messages`)).body;assert.equal((await unseal(kb,b.user.id,dm.id,a.user.id,history[0].content,ka.publicKey)).content,"private hello");
  const decoded=await unseal(kb,b.user.id,dm.id,a.user.id,history[0].content,ka.publicKey);assert.equal(decoded.files[0].name,"private-notes.txt");
  const download=await fetch(base+uploaded.body.url,{headers:{cookie:b.cookie,origin:"http://send.test"}});assert.equal(download.status,200);const bytes=new Uint8Array(await download.arrayBuffer());assert.deepEqual(bytes,file.bytes);assert.ok(!new TextDecoder().decode(bytes).includes("private attachment bytes"));assert.deepEqual(await decryptFile(bytes,decoded.files[0].key,decoded.files[0].nonce),plain);
  assert.equal((await a.patch(`/api/channels/${dm.id}/messages/${sent.body.id}`,{content:"unencrypted edit"})).status,400);
 }finally{config.requireDmE2ee=previous;}
});
