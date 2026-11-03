import { api } from "../api.ts";
import { channelById, useStore } from "../store.ts";
import { PREFIX, newIdentity, identityFromSecret, seal, unseal, fingerprint, encryptFile, decryptFile, type Identity, type Envelope } from "./core.ts";
export { PREFIX, fingerprint, decryptFile };
type FileMeta = { id?: string; name: string; type: string; size: number; key: string; nonce: string };
const pendingFiles = new Map<string, FileMeta>();
let boot: { user: string; promise: Promise<Identity> } | null = null;
const db = () => new Promise<IDBDatabase>((resolve,reject) => { const r=indexedDB.open("send-private-keys",1);r.onupgradeneeded=()=>r.result.createObjectStore("identities");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error("Private key storage is unavailable. Encryption cannot start.")); });
async function vault(user: string, value?: Identity) { const d=await db();return new Promise<Identity|undefined>((resolve,reject)=>{const t=d.transaction("identities",value?"readwrite":"readonly"),s=t.objectStore("identities"),r=value?s.put(value,user):s.get(user);let result:any;r.onsuccess=()=>{result=r.result};t.oncomplete=()=>{d.close();resolve(value??result)};t.onerror=()=>{d.close();reject(Error("Couldn't save the local encryption key."))};}); }
export async function ensureIdentity(): Promise<Identity> {
  const user=useStore.getState().me?.id;if(!user)throw Error("Sign in before unlocking encrypted messages.");
  if(boot?.user===user)return boot.promise;
  const promise=(async()=>{let key=await vault(user);const {identity}=await api.get<any>("/api/encryption/identity");
    if(!key&&identity)throw Error("Restore your DM recovery key in Privacy & safety on this device.");
    key??=await newIdentity();if(identity&&identity.public_key!==key.publicKey)throw Error("This device's key does not match your account. Restore the correct recovery key.");
    await vault(user,key);await api.put("/api/encryption/identity",{public_key:key.publicKey});return key;})();
  boot={user,promise};try{return await promise}catch(e){boot=null;throw e;}
}
export async function restoreIdentity(secret:string) { const user=useStore.getState().me?.id;if(!user)throw Error("Sign in first.");const key=await identityFromSecret(secret);await api.put("/api/encryption/identity",{public_key:key.publicKey});await vault(user,key);boot=null;await ensureIdentity(); }
function pin(user:string,key:string) {const owner=useStore.getState().me!.id,k=`send.contact-key.${owner}.${user}`,previous=localStorage.getItem(k);if(previous&&previous!==key)throw Error("Contact encryption key changed. Sending and decryption are blocked until you verify their identity.");if(!previous)localStorage.setItem(k,key);}
export async function channelIdentities(channel:string) { await ensureIdentity();const r=await api.get<{identities:{user_id:string;public_key:string|null}[]}>(`/api/channels/${channel}/encryption`);for(const i of r.identities)if(i.public_key)pin(i.user_id,i.public_key);return r.identities; }
export async function encodeBody(channel:string, body:any, messageId?:string) {
  const ch=channelById(channel);if(!ch)throw Error("Refresh this conversation before sending.");if(ch.guild_id)return body;
  if (!String(body.content??"").trim() && !(body.attachment_ids?.length)) throw Error("Messages cannot be empty.");
  const key=await ensureIdentity(),me=useStore.getState().me!.id,keys=await channelIdentities(channel);
  const expected=new Set([me,...(ch.recipients??[]).map(u=>u.id)]);
  if(keys.length!==expected.size||keys.some(k=>!expected.has(k.user_id)))throw Error("Conversation members changed. Refresh before sending.");
  if(keys.some(k=>!k.public_key))throw Error("Everyone must open the updated SEND app to set up encryption before you can message them.");
  if(String(body.content??"").length>4000)throw Error("Messages can be up to 4000 characters.");
  const existing=messageId?useStore.getState().messages[channel]?.list.find(m=>m.id===messageId):undefined;
  const files=(body.attachment_ids??existing?.attachments.map(a=>a.id)??[]).map((id:string)=>{const a=existing?.attachments.find(a=>a.id===id);const f=pendingFiles.get(id)??(a?.encryption?{name:a.filename,type:a.content_type,size:a.size,...a.encryption}:undefined);if(!f)throw Error("Encrypted attachment key is missing. Upload the file again.");return {...f,id};});
  const content=await seal(key,me,channel,keys.map(k=>({user:k.user_id,publicKey:k.public_key!})),{content:body.content??"",files});return {...body,content};
}
async function decodeContent(wire:string,channel:string,author:string) {const me=useStore.getState().me!.id,key=await ensureIdentity(),env:Envelope=JSON.parse(wire.slice(PREFIX.length));pin(author,env.senderKey);const payload=await unseal(key,me,channel,author,wire,env.senderKey);if(typeof payload?.content!=="string"||payload.content.length>4000||!Array.isArray(payload.files)||payload.files.length>10)throw Error("Invalid encrypted message payload.");return payload;}
export async function decodeWire<T>(data:T):Promise<T> {
  if(Array.isArray(data))return await Promise.all(data.map(x=>decodeWire(x))) as T;
  if(!data||typeof data!=="object")return data;
  const m=data as any;
  if(m.channel_id&&typeof m.content==="string"&&m.author){let out={...m};
    if(m.content.startsWith(PREFIX)){try{const p=await decodeContent(m.content,m.channel_id,m.author.id);out.content=p.content;out._encrypted=true;out.attachments=(m.attachments??[]).filter((a:any)=>p.files.some((f:FileMeta)=>f.id===a.id)&&/^\/api\/attachments\/\d+\//.test(a.url)).map((a:any)=>{const f=p.files?.find((f:FileMeta)=>f.id===a.id);return f?{...a,filename:f.name,content_type:f.type,size:f.size,encryption:{key:f.key,nonce:f.nonce}}:a;});}catch(e){out.content="Encrypted message unavailable — "+(e instanceof Error?e.message:"check your recovery key");out._encryptionError=true;out.attachments=[];}}
    if(m.reply_to?.content?.startsWith(PREFIX)){try{const p=await decodeContent(m.reply_to.content,m.channel_id,m.reply_to.author.id);out.reply_to={...m.reply_to,content:p.content};}catch{out.reply_to={...m.reply_to,content:"Encrypted message"};}}
    return out;
  }
  const out:any={...m};for(const k of Object.keys(out))if(out[k]&&typeof out[k]==="object")out[k]=await decodeWire(out[k]);return out;
}
export async function encryptedUpload(channel:string,form:FormData):Promise<{form:FormData;meta?:FileMeta}> { const ch=channelById(channel);if(!ch)throw Error("Refresh the conversation before uploading.");if(ch.guild_id)return {form};await ensureIdentity();const file=form.get("file");if(!(file instanceof File))throw Error("Choose a file.");const enc=await encryptFile(new Uint8Array(await file.arrayBuffer()));const replacement=new FormData();replacement.set("encrypted","1");replacement.set("file",new Blob([new Uint8Array(enc.bytes)],{type:"application/octet-stream"}),"encrypted.send");return {form:replacement,meta:{name:file.name,type:file.type==="image/svg+xml"?"application/octet-stream":file.type||"application/octet-stream",size:file.size,key:enc.key,nonce:enc.nonce}}; }
export function rememberUpload(id:string,meta:FileMeta){pendingFiles.set(id,meta);}
