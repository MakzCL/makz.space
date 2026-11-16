import test from "node:test";
import assert from "node:assert/strict";
import { newIdentity, identityFromSecret, seal, unseal, encryptFile, decryptFile, PREFIX } from "../src/crypto/core.ts";

test("authenticated DM encryption reaches each intended recipient, survives recovery and hides text", async () => {
  const a=await newIdentity(),b=await newIdentity(),other=await newIdentity();
  const wire=await seal(a,"1","10",[{user:"1",publicKey:a.publicKey},{user:"2",publicKey:b.publicKey}],{content:"secret hello",files:[]});
  assert.ok(!wire.includes("secret hello"));
  assert.equal((await unseal(b,"2","10","1",wire,a.publicKey)).content,"secret hello");
  assert.equal((await unseal(a,"1","10","1",wire,a.publicKey)).content,"secret hello");
  const recovered=await identityFromSecret(b.privateKey);assert.equal(recovered.publicKey,b.publicKey);
  assert.equal((await unseal(recovered,"2","10","1",wire,a.publicKey)).content,"secret hello");
  await assert.rejects(unseal(other,"2","10","1",wire,a.publicKey));
  await assert.rejects(unseal(b,"2","11","1",wire,a.publicKey));
  await assert.rejects(unseal(b,"2","10","3",wire,a.publicKey));
  await assert.rejects(unseal(b,"2","10","1",wire,other.publicKey));
  const e=JSON.parse(wire.slice(PREFIX.length));e.boxes[1].ciphertext=(e.boxes[1].ciphertext[0]==="A"?"B":"A")+e.boxes[1].ciphertext.slice(1);
  await assert.rejects(unseal(b,"2","10","1",PREFIX+JSON.stringify(e),a.publicKey));
});
test("attachment encryption authenticates bytes and rejects corruption",async()=>{
 const clear=new TextEncoder().encode("private attachment");const e=await encryptFile(clear);
 assert.notDeepEqual(e.bytes,clear);assert.deepEqual(await decryptFile(e.bytes,e.key,e.nonce),clear);
 e.bytes[0]^=1;await assert.rejects(decryptFile(e.bytes,e.key,e.nonce));
});
