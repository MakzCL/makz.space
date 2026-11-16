import { useState } from "react";
import { Pencil } from "lucide-react";
import { ChannelType, P, type Channel } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { can, toast } from "../store.ts";
import { useVoice } from "../voice/session.ts";

/** The short status line of a voice channel ("Ranked games", "Movie night"), set by people in it. */
export function VoiceStatusEditor({ channel }: { channel: Channel }) {
  const here = useVoice((v) => v.channelId === channel.id);
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(channel.voice_status ?? "");
  if (channel.type !== ChannelType.VOICE) return null;
  const allowed = here || can(channel, P.MANAGE_CHANNELS);
  const save = async (v: string | null) => {
    try { await api.put(`/api/channels/${channel.id}/voice-status`, { status: v }); setEdit(false); } catch (e) { toast(errMsg(e), "error"); }
  };
  if (edit) return <form className="voice-status-edit" onSubmit={(e) => { e.preventDefault(); save(text.trim() || null); }}>
    <input autoFocus maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="What's going on? (shown under the channel)" aria-label="Voice channel status" onKeyDown={(e) => { if (e.key === "Escape") setEdit(false); }} />
    <button className="btn primary sm">Save</button>{channel.voice_status && <button type="button" className="btn sm" onClick={() => save(null)}>Clear</button>}
  </form>;
  return <button className="voice-status-btn ellipsis" disabled={!allowed} onClick={() => { setText(channel.voice_status ?? ""); setEdit(true); }} title={allowed ? "Set a channel status" : undefined}>
    {channel.voice_status || (allowed ? <span className="muted"><Pencil size={12} /> Set a channel status</span> : null)}
  </button>;
}
