import { useEffect, useState } from "react";
import { channelIdentities, ensureIdentity, fingerprint, restoreIdentity } from "../crypto/dm.ts";
import { errMsg } from "../api.ts";
import { toast, useStore } from "../store.ts";
import { previewMode } from "../preview-mode.ts";

export function DmKeySettings() {
  const [fp,setFp]=useState(""),[secret,setSecret]=useState(""),[restore,setRestore]=useState(""),[error,setError]=useState("");
  const load=()=>ensureIdentity().then(async k=>{setFp(await fingerprint(k.publicKey));setError("")}).catch(e=>setError(errMsg(e)));
  useEffect(()=>{if(!previewMode)load()},[]);
  return <div className="stack dm-key-settings"><h3>Private messages</h3><p className="muted small">New direct messages and attachments are encrypted on your device. SEND keeps ciphertext, not your private key. Older messages stay unencrypted. Calls use a separate media connection.</p>
    {previewMode ? <p className="muted">Encryption keys are available in the live app.</p> : <>
    {error&&<p role="alert" className="error">{error}</p>}
    {fp&&<><label className="field"><span className="field-l">Your encryption fingerprint</span><code className="key-fingerprint">{fp}</code></label><button className="btn" onClick={()=>ensureIdentity().then(k=>setSecret(k.privateKey)).catch(e=>setError(errMsg(e)))}>Show recovery key</button></>}
    {secret&&<label className="field"><span className="field-l">Keep this recovery key private</span><input readOnly value={secret} onFocus={e=>e.target.select()} aria-label="DM recovery key"/><span className="muted small">Save it in a password manager. Use it to restore messages on another device. Losing every copy means losing access to encrypted messages.</span><button className="link" onClick={()=>setSecret("")}>Hide recovery key</button></label>}
    <label className="field"><span className="field-l">Restore on this device</span><input type="password" autoComplete="off" value={restore} onChange={e=>setRestore(e.target.value)} placeholder="Your 64-character recovery key" aria-label="Restore DM recovery key"/></label><button className="btn" disabled={!restore} onClick={()=>restoreIdentity(restore).then(()=>{setRestore("");load();toast("Encryption key restored. Reload the conversation.","success")}).catch(e=>setError(errMsg(e)))}>Restore encryption key</button>
    <p className="muted small">Compare fingerprints with your contact through another trusted channel. Beta encryption uses long-term keys and does not yet provide forward secrecy. Your contacts, timestamps and reactions remain metadata.</p></>}
  </div>;
}
export function DmPrivacyBar({channel}:{channel:string}) {
  const [open,setOpen]=useState(false),[rows,setRows]=useState<{user_id:string;public_key:string|null;fp?:string}[]>([]),[error,setError]=useState("");
  const me=useStore(s=>s.me);
  useEffect(()=>{if(previewMode)return;let live=true;channelIdentities(channel).then(async list=>{const r=await Promise.all(list.map(async i=>({...i,fp:i.public_key?await fingerprint(i.public_key):undefined})));if(live){setRows(r);setError("")}}).catch(e=>{if(live)setError(errMsg(e))});return()=>{live=false}},[channel]);
  return <aside className="dm-privacy"><button className="link" aria-expanded={open} onClick={()=>setOpen(!open)}>♧ {previewMode?"Local sample conversation":error?"Encryption needs attention":rows.some(r=>!r.public_key)?"Waiting for encryption setup":"End-to-end encrypted messages"} · Privacy details</button>
    {open&&<div className="stack"><p className="small">New messages and files are encrypted. Compare these fingerprints outside SEND before trusting a first contact. Older history is labelled separately.</p>{error&&<p className="error">{error} Open Privacy &amp; safety to restore your key.</p>}{rows.map(r=><label className="field" key={r.user_id}><span className="field-l">{r.user_id===me?.id?"You":useStore.getState().users[r.user_id]?.username??r.user_id}</span><code className="key-fingerprint">{r.fp??"Waiting for this person to open the updated app"}</code></label>)}</div>}
  </aside>;
}
