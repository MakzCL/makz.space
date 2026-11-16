import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { remoteStorage } from "../src/storage-remote.ts";

test("remote uploads preserve bytes, ranges and directory boundaries", async () => {
  const objects = new Map<string,Buffer>();
  const server = createServer(async (req,res) => {
    assert.equal(req.headers.authorization,"Bearer test-secret");
    const url = new URL(req.url!,"http://local");
    const key = url.pathname.slice('/__storage/'.length);
    if(req.method === 'PUT') {
      const chunks=[]; for await(const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks); assert.equal(bytes.length,Number(req.headers['content-length']));
      objects.set(key,bytes); res.writeHead(204).end(); return;
    }
    if(req.method === 'DELETE') {
      const prefix=url.searchParams.get('prefix');
      for(const k of objects.keys()) if(prefix?k.startsWith(prefix):k===key) objects.delete(k);
      res.writeHead(204).end();return;
    }
    const data=objects.get(key);
    if(!data){res.writeHead(404).end();return;}
    if(req.method === 'HEAD'){res.writeHead(200,{'content-length':data.length}).end();return;}
    const range=req.headers.range?.match(/bytes=(\d+)-(\d+)/);
    const body=range?data.subarray(Number(range[1]),Number(range[2])+1):data;
    res.writeHead(range?206:200,{'content-length':body.length}).end(body);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number};
  const storage=remoteStorage(`http://127.0.0.1:${address.port}`,'test-secret');
  try {
    const bytes=Buffer.from('persistent upload');
    assert.equal(await storage.put('att/g1/c1/file',Readable.from([bytes.subarray(0,4),bytes.subarray(4)]),100),bytes.length);
    assert.equal(await storage.size('att/g1/c1/file'),bytes.length);
    const chunks=[]; for await(const chunk of storage.open('att/g1/c1/file',{start:2,end:5}))chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(),'rsis');
    await storage.put('att/g1/c10/file',Buffer.from('keep'));
    await storage.removePrefix('att/g1/c1');
    await assert.rejects(storage.size('att/g1/c1/file'),{code:'ENOENT'});
    assert.equal(await storage.size('att/g1/c10/file'),4);
    await assert.rejects(storage.put('oversized',Readable.from([Buffer.alloc(11)]),10),{code:'too_large'});
    assert.equal(objects.has('oversized'),false);
    assert.throws(()=>storage.open('../secret'),/bad storage key/);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
