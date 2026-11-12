// Pure-Node zip read/write (deflate via zlib), so packaging works on any build machine without `zip`/`unzip`.
// Supports what the packaging needs: stored and deflated entries, files up to 4 GiB, no zip64, no encryption.
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Extract every entry of `zipFile` into `dir`, refusing paths that would escape it. */
export function unzipTo(zipFile, dir) {
  const b = fs.readFileSync(zipFile); let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`${zipFile}: not a zip file`);
  const count = b.readUInt16LE(eocd + 10); let p = b.readUInt32LE(eocd + 16); const root = path.resolve(dir);
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nlen); p += 46 + nlen + xlen + clen;
    const out = path.resolve(root, name); if (out !== root && !out.startsWith(root + path.sep)) throw new Error(`unsafe path in zip: ${name}`);
    if (name.endsWith("/")) { fs.mkdirSync(out, { recursive: true }); continue; }
    const lh = off, data0 = lh + 30 + b.readUInt16LE(lh + 26) + b.readUInt16LE(lh + 28); const raw = b.subarray(data0, data0 + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : (() => { throw new Error(`${name}: unsupported compression ${method}`); })();
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data);
  }
}

/** Zip `parent/folder` (folder included as the top-level entry) into `out`, deflate level 9. */
export function zipFolder(parent, folder, out) {
  const files = []; const walk = (rel) => { const abs = path.join(parent, rel); if (fs.statSync(abs).isDirectory()) { for (const e of fs.readdirSync(abs).sort()) walk(path.join(rel, e)); } else files.push(rel); }; walk(folder);
  const fd = fs.openSync(out, "w"); let off = 0; const central = [];
  const write = (buf) => { fs.writeSync(fd, buf); off += buf.length; };
  const dos = (() => { const d = new Date(2026, 0, 1); return { time: (d.getHours() << 11) | (d.getMinutes() << 5), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; })();
  for (const rel of files) {
    const data = fs.readFileSync(path.join(parent, rel)); const name = Buffer.from(rel.split(path.sep).join("/"), "utf8");
    const def = zlib.deflateRawSync(data, { level: 9 }); const store = def.length >= data.length; const body = store ? data : def; const crc = crc32(data);
    if (off > 0xffffffff - body.length - 100) throw new Error("zip too large without zip64");
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt16LE(dos.time, 10); lh.writeUInt16LE(dos.date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const at = off; write(lh); write(name); write(body);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(store ? 0 : 8, 10); ch.writeUInt16LE(dos.time, 12); ch.writeUInt16LE(dos.date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(at, 42);
    central.push(Buffer.concat([ch, name]));
  }
  const cdStart = off; for (const c of central) write(c);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length, 8); e.writeUInt16LE(central.length, 10); e.writeUInt32LE(off - cdStart, 12); e.writeUInt32LE(cdStart, 16);
  write(e); fs.closeSync(fd);
}
