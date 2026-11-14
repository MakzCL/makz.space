/** Phone voice screens, like Discord mobile: the join sheet for a quiet channel and the in-call top bar. */
import { ChevronDown, ChevronRight, Headphones, HeadphoneOff, MessageCircle, Mic, MicOff, UserPlus } from "lucide-react";
import { ChannelType, P, type Channel, type Guild } from "@send/shared";
import { can, displayName, useStore } from "../store.ts";
import { joinVoice, setDeafened, setMuted, useVoice } from "../voice/session.ts";
import { Avatar } from "../components/ui.tsx";
import { ChannelGlyph } from "../components/ChannelGlyph.tsx";
import { openDialog } from "../components/Shell.tsx";
import { useShallow } from "zustand/react/shallow";

const openNav = () => window.dispatchEvent(new CustomEvent("send:nav", { detail: { open: true } }));
const invite = (channel: Channel, guild: Guild | null) => (guild ? openDialog({ kind: "invite", guildId: guild.id, channelId: channel.id }) : openDialog({ kind: "groupDm" }));
const canInvite = (channel: Channel, guild: Guild | null) => (guild ? can(channel, P.CREATE_INVITE) : channel.type === ChannelType.GROUP_DM);

/** Before joining: who's here (or "No one's here yet!"), then mic, a big green Join Voice and chat. */
export function MobileVoiceIdle({ channel, guild, onChat }: { channel: Channel; guild: Guild | null; onChat?: () => void }) {
  const v = useVoice();
  const users = useStore((s) => s.users);
  const states = useStore(useShallow((s) => Object.values(s.voice).filter((x) => x.channel_id === channel.id)));
  return (
    <div className="m-voice-idle m-only-flex">
      <header className="m-call-top">
        <button className="m-round dark" aria-label="Back to channels" onClick={openNav}><ChevronDown size={22} /></button>
        <button className="m-call-name" onClick={openNav}><ChannelGlyph c={channel} size={20} /><span className="ellipsis">{channel.name}</span><ChevronRight size={18} /></button>
        <span className="grow" />
        {canInvite(channel, guild) && <button className="m-round dark" aria-label="Invite to Voice" onClick={() => invite(channel, guild)}><UserPlus size={20} /></button>}
      </header>
      <div className="m-voice-idle-body">
        {states.length ? <>
          <div className="m-voice-faces">{states.slice(0, 6).map((s) => <span key={s.user_id} className="m-voice-face"><Avatar user={users[s.user_id] ?? s.user ?? null} size={72} status="" /><small className="ellipsis">{displayName(users[s.user_id] ?? s.user ?? undefined)}</small></span>)}</div>
          <p>{states.length} {states.length === 1 ? "person is" : "people are"} hanging out.</p>
        </> : <p className="m-voice-quiet"><b>No one's here yet!</b><br />When you are ready to talk, just hop in.</p>}
        {channel.voice_status && <p className="voice-status-line">{channel.voice_status}</p>}
      </div>
      <div className="m-voice-dock">
        <span className="m-dock-handle" aria-hidden />
        <div className="m-voice-dock-row">
          <button className={`m-round ${v.muted ? "off" : ""}`} aria-pressed={v.muted} aria-label={v.muted ? "Join unmuted" : "Join muted"} onClick={() => setMuted(!v.muted)}>{v.muted ? <MicOff size={24} /> : <Mic size={24} />}</button>
          <button className="m-join" onClick={() => joinVoice(channel.id)}>{channel.type === ChannelType.STAGE ? "Join Stage" : "Join Voice"}</button>
          {onChat ? <button className="m-round" aria-label="Open chat" onClick={onChat}><MessageCircle size={24} /></button> : <span className="m-round-spacer" />}
        </div>
      </div>
    </div>
  );
}

/** In a call: back, the channel name, the speaker (deafen), invite and chat. */
export function MobileCallTop({ channel, guild, onChat }: { channel: Channel; guild: Guild | null; onChat?: () => void }) {
  const v = useVoice();
  return (
    <header className="m-call-top in-call m-only-flex">
      <button className="m-round dark" aria-label="Back to channels" onClick={openNav}><ChevronDown size={22} /></button>
      <button className="m-call-name" onClick={openNav}><ChannelGlyph c={channel} size={20} /><span className="ellipsis">{channel.name || "Call"}</span><ChevronRight size={18} /></button>
      <span className="grow" />
      <button className={`m-round ${v.deafened ? "dark" : "light"}`} aria-pressed={v.deafened} aria-label={v.deafened ? "Undeafen" : "Deafen"} onClick={() => setDeafened(!v.deafened)}>{v.deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}</button>
      {canInvite(channel, guild) && <button className="m-round dark" aria-label="Invite to Voice" onClick={() => invite(channel, guild)}><UserPlus size={20} /></button>}
      {onChat && <button className="m-round dark" aria-label="Open chat" onClick={onChat}><MessageCircle size={20} /></button>}
    </header>
  );
}

/** Alone in a call: a nudge to bring people in. */
export function MobileAddPeople({ channel, guild }: { channel: Channel; guild: Guild | null }) {
  if (!canInvite(channel, guild)) return null;
  return (
    <button className="m-addpeople m-only-flex" onClick={() => invite(channel, guild)}>
      <UserPlus size={28} />
      <span><b>Add people to Voice Chat</b><small>Let the group know you are here!</small></span>
      <ChevronRight size={22} />
    </button>
  );
}
