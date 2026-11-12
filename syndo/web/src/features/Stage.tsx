import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Hand, Mic, MicOff, PhoneOff, Radio, Rss, UserMinus, UserPlus } from "lucide-react";
import { ChannelType, P, has, type Channel, type Guild } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { can, displayName, guildPerms, toast, useStore } from "../store.ts";
import { leaveVoice, setMuted, useVoice } from "../voice/session.ts";
import { Avatar, Field, Modal } from "../components/ui.tsx";
import { Popover } from "../components/overlay.tsx";
import { openModal } from "./modals.tsx";

const MOD = P.MANAGE_CHANNELS | P.MUTE_MEMBERS | P.MOVE_MEMBERS;
export const isStageMod = (c: Channel) => can(c, MOD);

/* ------------------------------------------------------------------------------ stage -- */
export function StageView({ channel, guild }: { channel: Channel; guild: Guild | null }) {
  const me = useStore((s) => s.me!);
  const users = useStore((s) => s.users);
  const stage = useStore((s) => s.stages[channel.id]);
  const states = useStore(useShallow((s) => Object.values(s.voice).filter((x) => x.channel_id === channel.id)));
  const v = useVoice();
  const mine = states.find((s) => s.user_id === me.id);
  const mod = isStageMod(channel);
  const speakers = states.filter((s) => s.suppress === false);
  const audience = states.filter((s) => s.suppress !== false);
  const hands = audience.filter((s) => s.request_to_speak_at).sort((a, b) => (a.request_to_speak_at ?? "").localeCompare(b.request_to_speak_at ?? ""));
  const speaking = (id: string) => (id === me.id ? v.localSpeaking : !!v.peers[id]?.speaking);
  const suppressed = mine?.suppress !== false;
  // In the audience you're always muted.
  useEffect(() => { if (suppressed && !v.muted) setMuted(true); }, [suppressed]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchMe = (b: Record<string, unknown>) => api.patch(`/api/channels/${channel.id}/voice-states/@me`, b).catch((e) => toast(errMsg(e), "error"));
  const setSpeaker = (uid: string, on: boolean) => api.patch(`/api/channels/${channel.id}/voice-states/${uid}`, { suppress: !on }).catch((e) => toast(errMsg(e), "error"));
  return (
    <div className="stage-live">
      <div className="stage-top">
        <Radio size={18} className={stage ? "live-ico" : "muted"} />
        <div className="grow"><h2>{stage?.topic ?? channel.name}</h2><span className="muted small">{stage ? "Live now" : "This stage isn't live"} · {states.length} {states.length === 1 ? "person" : "people"}</span></div>
        {mod && !stage && <button className="btn primary sm" onClick={() => openModal((c) => <StartStage channel={channel} onClose={c} />)}>Start stage</button>}
        {mod && stage && <button className="btn sm" onClick={async () => { const { askText } = await import("../components/overlay.tsx"); const t = await askText({ title: "Stage topic", label: "Topic", initial: stage.topic }); if (t) api.patch(`/api/stage-instances/${channel.id}`, { topic: t }).catch((e) => toast(errMsg(e), "error")); }}>Edit topic</button>}
        {mod && stage && <button className="btn danger sm" onClick={() => api.del(`/api/stage-instances/${channel.id}`).catch((e) => toast(errMsg(e), "error"))}>End stage</button>}
      </div>
      <section aria-label="Speakers"><h3 className="side-sec">Speakers: {speakers.length}</h3>
        <div className="stage-speakers">{speakers.map((s) => (
          <div key={s.user_id} className={`stage-person ${speaking(s.user_id) ? "speaking" : ""}`}>
            <Avatar user={users[s.user_id] ?? (s.user_id === me.id ? me : null)} size={72} />
            <span className="ellipsis">{displayName(users[s.user_id] ?? (s.user_id === me.id ? me : null))}</span>
            {(s.self_mute || s.server_mute) && <MicOff size={14} aria-label="muted" />}
            {mod && s.user_id !== me.id && <button className="icon-btn sm" title="Move to audience" aria-label="Move to audience" onClick={() => setSpeaker(s.user_id, false)}><UserMinus size={14} /></button>}
          </div>))}
          {!speakers.length && <p className="muted">No one is speaking yet.</p>}
        </div>
      </section>
      {mod && hands.length > 0 && <section aria-label="Requests to speak"><h3 className="side-sec"><Hand size={14} /> Raised hands: {hands.length}</h3>
        {hands.map((s) => <div key={s.user_id} className="stage-req"><Avatar user={users[s.user_id]} size={28} /><span className="ellipsis grow">{displayName(users[s.user_id])}</span>
          <button className="btn primary sm" onClick={() => setSpeaker(s.user_id, true)}><UserPlus size={14} /> Invite to speak</button>
          <button className="btn sm" onClick={() => setSpeaker(s.user_id, false)}>Dismiss</button></div>)}
      </section>}
      <section aria-label="Audience"><h3 className="side-sec">In the audience: {audience.length}</h3>
        <div className="stage-audience">{audience.map((s) => <div key={s.user_id} className="stage-person sm" title={displayName(users[s.user_id])}><Avatar user={users[s.user_id] ?? (s.user_id === me.id ? me : null)} size={40} />{s.request_to_speak_at && <Hand size={14} className="hand" aria-label="hand raised" />}</div>)}</div>
      </section>
      <div className="call-controls stage-controls" role="toolbar" aria-label="Stage controls">
        {suppressed ? (
          mod ? <button className="btn primary" onClick={() => patchMe({ suppress: false })}><Mic size={16} /> Become a speaker</button>
            : <button className={`btn ${mine?.request_to_speak_at ? "active" : "primary"}`} onClick={() => patchMe({ request_to_speak: !mine?.request_to_speak_at })}><Hand size={16} /> {mine?.request_to_speak_at ? "Lower hand" : "Request to speak"}</button>
        ) : <>
          <button className={`ctl ${v.muted ? "off" : ""}`} onClick={() => setMuted(!v.muted)} aria-label={v.muted ? "Unmute" : "Mute"}>{v.muted ? <MicOff /> : <Mic />}</button>
          <button className="btn sm" onClick={() => patchMe({ suppress: true })}>Move to audience</button>
        </>}
        <button className="ctl leave" onClick={() => leaveVoice()} aria-label="Leave quietly"><PhoneOff /></button>
      </div>
      {guild && void guildPerms}
    </div>
  );
}

function StartStage({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const [topic, setTopic] = useState("");
  const [notify, setNotify] = useState(false);
  const start = async () => {
    try { await api.post("/api/stage-instances", { channel_id: channel.id, topic: topic.trim(), notify }); onClose(); }
    catch (e) { toast(errMsg(e), "error"); }
  };
  return <Modal title="Start a stage" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!topic.trim()} onClick={start}>Start stage</button></>}>
    <Field label="Topic" hint="What's it about? Shown to everyone in the server."><input autoFocus maxLength={120} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Weekly Q&A" /></Field>
    <label className="row"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify everyone in the server</label>
  </Modal>;
}

/* ----------------------------------------------------------------------- announcements -- */
export function FollowButton({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const guilds = useStore((s) => s.guilds);
  const [target, setTarget] = useState("");
  const options = Object.values(guilds).flatMap((g) => g.channels.filter((c) => (c.type === ChannelType.TEXT || c.type === ChannelType.ANNOUNCEMENT) && c.id !== channel.id && has(BigInt(c.my_permissions ?? "0"), P.MANAGE_WEBHOOKS)).map((c) => ({ id: c.id, label: `${g.name} · #${c.name}` })));
  const follow = async () => {
    try { await api.post(`/api/channels/${channel.id}/followers`, { webhook_channel_id: target }); toast("Following. New announcements will show up there.", "success"); setOpen(false); }
    catch (e) { toast(errMsg(e), "error"); }
  };
  return <>
    <button ref={btn} className="btn sm follow-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}><Rss size={14} /> Follow</button>
    {open && <Popover className="menu follow-pop" role="dialog" label="Follow this channel" anchor={() => btn.current} onClose={() => setOpen(false)}>
      <div className="pad">
        <strong>Follow #{channel.name}</strong>
        <p className="muted small">Its published messages will be posted in a channel of your choice. You need Manage Webhooks there.</p>
        {options.length ? <>
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Post into"><option value="">Pick a channel…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          <button className="btn primary sm" disabled={!target} onClick={follow}>Follow</button>
        </> : <p className="muted small">You don't manage webhooks in any channel.</p>}
      </div>
    </Popover>}
  </>;
}
