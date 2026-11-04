import type { KeyboardEvent } from "react";
import { errMsg } from "../api.ts";
import { toast } from "../store.ts";
import { leaveVoice, setDeafened, setMuted, setUserVolume, stopScreenShare, switchScreenSource, toggleCamera, useVoice } from "../voice/session.ts";
import { Range } from "./Range.tsx";
import { openContextMenu, type MenuItem } from "./overlay.tsx";

/** Keyboard equivalent of right-click, including browsers that don't emit contextmenu for Shift+F10. */
export function contextMenuKey(e: KeyboardEvent<HTMLElement>, open: () => void) {
  if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
  e.preventDefault(); e.stopPropagation(); open();
}

// Remember the previous audible level when locally muting, independently for mic and stream audio.
const audible = new Map<string, number>();
export function toggleLocalAudio(key: string) {
  const level = useVoice.getState().settings.userVolumes[key] ?? 1;
  if (level > 0) audible.set(key, level);
  setUserVolume(key, level > 0 ? 0 : audible.get(key) ?? 1);
}
function VolumeRow({ uid, stream }: { uid: string; stream: boolean }) {
  const key = stream ? `${uid}:stream` : uid;
  const volume = useVoice(s => s.settings.userVolumes[key] ?? 1);
  const label = stream ? "Stream volume" : "User volume";
  return <label className="call-menu-volume"><span>{label}<output>{Math.round(volume * 100)}%</output></span><Range aria-label={label} min={0} max={2} step={0.05} value={volume} onChange={e => setUserVolume(key, +e.target.value)} /></label>;
}
export function audioMenuItems(uid: string, stream = false): MenuItem[] {
  const key = stream ? `${uid}:stream` : uid;
  return [
    { label: stream ? "Mute stream audio" : "Mute locally", checked: (useVoice.getState().settings.userVolumes[key] ?? 1) === 0, onSelect: () => toggleLocalAudio(key) },
    { kind: "custom", render: () => <VolumeRow uid={uid} stream={stream} /> },
  ];
}
const safe = (run: () => unknown) => () => { Promise.resolve().then(run).catch(e => toast(errMsg(e), "error")); };
export function selfCallMenuItems(): MenuItem[] {
  const v = useVoice.getState();
  return [
    { label: "Mute microphone", checked: v.muted, disabled: !v.grants?.speak, onSelect: safe(() => setMuted(!useVoice.getState().muted)) },
    { label: "Deafen", checked: v.deafened, onSelect: () => setDeafened(!useVoice.getState().deafened) },
    { label: v.camera ? "Turn camera off" : "Turn camera on", disabled: !v.grants?.video, onSelect: safe(toggleCamera) },
    { label: "Disconnect", danger: true, onSelect: safe(leaveVoice) },
  ];
}

export interface TileMenuOptions {
  uid: string; screen: boolean; local: boolean; focused: boolean; hasVideo: boolean;
  onFocus: () => void; onFullscreen: () => unknown; onPip?: () => unknown;
  onProfile?: () => void; participantItems: MenuItem[];
}
/** Screen shares are media surfaces, not moderation targets. Cameras keep the participant's actions. */
export function tileMenuItems(o: TileMenuOptions): MenuItem[] {
  const items: MenuItem[] = [
    { label: o.focused ? "Unfocus" : o.screen ? "Focus stream" : "Focus participant", onSelect: o.onFocus },
    ...(o.hasVideo ? [{ label: "Fullscreen", onSelect: safe(o.onFullscreen) } as MenuItem,
      ...(o.onPip ? [{ label: "Picture in picture", onSelect: safe(o.onPip) } as MenuItem] : [])] : []),
    { kind: "separator" },
  ];
  if (!o.screen) return [...items, ...o.participantItems];
  if (o.local) items.push(
    { label: "Change shared window", onSelect: safe(switchScreenSource) },
    { label: "Stop sharing", danger: true, onSelect: safe(stopScreenShare) },
  );
  else items.push(...audioMenuItems(o.uid, true));
  if (o.onProfile) items.push({ kind: "separator" }, { label: o.local ? "Your profile" : "Streamer profile", onSelect: o.onProfile });
  return items;
}
