import { useState } from "react";
import { EmojiPicker } from "../components/ChannelView.tsx";
import { api, errMsg } from "../api.ts";
import { gwSend } from "../gateway.ts";
import { onEvent, toast, useStore } from "../store.ts";
import { Field, Modal } from "../components/ui.tsx";
import { openModal } from "./modals.tsx";
import { navigate } from "../router.ts";

/** App-wide listeners for the major update: event starts, auto-idle, app replies. */
let started = false;
export function initLive() {
  if (started) return; started = true;
  onEvent("GUILD_EVENT_START", (d) => toast(`📅 ${d.name} is starting now.`, "info"));
  onEvent("INTERACTION_SUCCESS", () => {});
  // Automatic idle after 10 minutes without input (only when my status is "online").
  let last = Date.now(), afk = false;
  const active = () => { last = Date.now(); if (afk) { afk = false; gwSend("afk", { afk: false }); } };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, active, { passive: true });
  setInterval(() => {
    const me = useStore.getState().me;
    if (!afk && me?.status === "online" && Date.now() - last > 10 * 60_000) { afk = true; gwSend("afk", { afk: true }); }
  }, 30_000);
  // Event links (?event=id) open the events list.
  const ev = new URLSearchParams(location.search).get("event");
  if (ev) { const gid = location.pathname.split("/")[2]; const g = gid ? useStore.getState().guilds[gid] : null; if (g) import("./Events.tsx").then((m) => m.openEvents(g)); }
  void navigate;
}

const CLEAR: { label: string; minutes: number | null }[] = [
  { label: "Don't clear", minutes: null }, { label: "30 minutes", minutes: 30 }, { label: "1 hour", minutes: 60 }, { label: "4 hours", minutes: 240 }, { label: "Today", minutes: -1 }, { label: "This week", minutes: 7 * 1440 },
];
export function openCustomStatus() { openModal((close) => <CustomStatus onClose={close} />); }
function CustomStatus({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me!);
  const [text, setText] = useState(me.custom_status?.text ?? "");
  const [emoji, setEmoji] = useState<string | null>(me.custom_status?.emoji ?? null);
  const [clear, setClear] = useState<number | null>(240);
  const [pick, setPick] = useState<HTMLElement | null>(null);
  const save = async (empty = false) => {
    let expires: string | null = null;
    if (clear === -1) { const d = new Date(); d.setHours(23, 59, 59, 0); expires = d.toISOString(); }
    else if (clear) expires = new Date(Date.now() + clear * 60_000).toISOString();
    try { await api.patch("/api/users/@me", { custom_status: empty || (!text.trim() && !emoji) ? null : { text: text.trim(), emoji, expires_at: expires } }); onClose(); }
    catch (e) { toast(errMsg(e), "error"); }
  };
  return <Modal title="Set a custom status" onClose={onClose} footer={<><button className="btn" onClick={() => save(true)}>Clear status</button><button className="btn primary" onClick={() => save()}>Save</button></>}>
    <div className="row"><button className="btn" aria-label="Pick an emoji" onClick={(e) => { const el = e.currentTarget; setPick((p) => (p ? null : el)); }}>{emoji ?? "🙂"}</button>
      <input autoFocus className="grow" maxLength={128} value={text} onChange={(e) => setText(e.target.value)} placeholder="What's happening?" onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></div>
    {pick && <EmojiPicker anchor={pick} onPick={(x) => { setEmoji(x); setPick(null); }} onClose={() => setPick(null)} onClear={emoji ? () => { setEmoji(null); setPick(null); } : undefined} />}
    <Field label="Clear after"><select value={clear ?? ""} onChange={(e) => setClear(e.target.value === "" ? null : Number(e.target.value))}>{CLEAR.map((c) => <option key={c.label} value={c.minutes ?? ""}>{c.label}</option>)}</select></Field>
  </Modal>;
}
