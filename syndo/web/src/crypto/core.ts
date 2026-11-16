import sodium from "libsodium-wrappers";
export const PREFIX = "SEND_E2EE_V1:";
export type Identity = { publicKey: string; privateKey: string };
export type Envelope = { v: 1; sender: string; senderKey: string; channel: string; boxes: { user: string; nonce: string; ciphertext: string }[] };
export async function newIdentity(): Promise<Identity> { await sodium.ready; const k = sodium.crypto_box_keypair(); return { publicKey: sodium.to_hex(k.publicKey), privateKey: sodium.to_hex(k.privateKey) }; }
export async function identityFromSecret(secret: string): Promise<Identity> { await sodium.ready; const sk = sodium.from_hex(secret.trim()); if (sk.length !== 32) throw Error("Recovery key must contain 64 hexadecimal characters."); return { publicKey: sodium.to_hex(sodium.crypto_scalarmult_base(sk)), privateKey: sodium.to_hex(sk) }; }
export async function fingerprint(publicKey: string) { await sodium.ready; return sodium.to_hex(sodium.crypto_generichash(32, sodium.from_hex(publicKey), null)).toUpperCase().match(/.{1,4}/g)!.join(" "); }
export async function seal(identity: Identity, sender: string, channel: string, recipients: { user: string; publicKey: string }[], payload: unknown): Promise<string> {
  await sodium.ready;
  const clear = JSON.stringify({ v: 1, sender, channel, payload });
  const boxes = recipients.map(r => { const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES); return { user: r.user, nonce: sodium.to_hex(nonce), ciphertext: sodium.to_base64(sodium.crypto_box_easy(clear, nonce, sodium.from_hex(r.publicKey), sodium.from_hex(identity.privateKey)), sodium.base64_variants.URLSAFE_NO_PADDING) }; });
  return PREFIX + JSON.stringify({ v: 1, sender, senderKey: identity.publicKey, channel, boxes } satisfies Envelope);
}
export async function unseal(identity: Identity, user: string, channel: string, author: string, wire: string, expectedKey: string): Promise<any> {
  await sodium.ready;
  const env: Envelope = JSON.parse(wire.slice(PREFIX.length));
  if (env.v !== 1 || env.sender !== author || env.channel !== channel || env.senderKey !== expectedKey) throw Error("Encryption identity or conversation does not match.");
  const box = env.boxes.find(b => b.user === user); if (!box) throw Error("This device has no key for this message.");
  const clear = JSON.parse(sodium.to_string(sodium.crypto_box_open_easy(sodium.from_base64(box.ciphertext, sodium.base64_variants.URLSAFE_NO_PADDING), sodium.from_hex(box.nonce), sodium.from_hex(expectedKey), sodium.from_hex(identity.privateKey))));
  if (clear.v !== 1 || clear.channel !== channel || clear.sender !== author) throw Error("Encrypted message context does not match.");
  return clear.payload;
}
export async function encryptFile(bytes: Uint8Array) { await sodium.ready; const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES), nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES); return { bytes: sodium.crypto_secretbox_easy(bytes, nonce, key), key: sodium.to_hex(key), nonce: sodium.to_hex(nonce) }; }
export async function decryptFile(bytes: Uint8Array, key: string, nonce: string) { await sodium.ready; return sodium.crypto_secretbox_open_easy(bytes, sodium.from_hex(nonce), sodium.from_hex(key)); }
