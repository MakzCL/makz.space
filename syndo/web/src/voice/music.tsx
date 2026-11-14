import { useEffect } from "react";
import { api } from "../api.ts";
import { useStore, type MusicState } from "../store.ts";
import { useVoice } from "./session.ts";

/**
 * SEND Music listener. The server runs the player for each voice room (queue, clock, timers); every client in the
 * room plays the same stream at the server's position. Deafening silences it, the voice output device is used,
 * and the volume is remembered per device.
 */
let el: HTMLAudioElement | null = null;
let loaded: string | null = null;
const VOL_KEY = "send.music.volume";
export const musicVolume = () => { try { const v = Number(localStorage.getItem(VOL_KEY)); return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.6; } catch { return 0.6; } };
export function setMusicVolume(v: number) { try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* */ } if (el) el.volume = v; }

const expected = (s: MusicState) => (s.position_ms + (s.paused ? 0 : Date.now() - s.received_at)) / 1000;

function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "auto";
  el.volume = musicVolume();
  (window as any).__sendMusic = el;
  el.addEventListener("loadedmetadata", () => {
    const s = current(); const t = s?.playing;
    if (s && t && t.id === loaded && t.duration == null && Number.isFinite(el!.duration) && el!.duration > 0)
      api.post(`/api/music/${s.channel_id}/duration`, { track_id: t.id, duration: el!.duration }).catch(() => {});
  });
  el.addEventListener("error", () => {
    const s = current(); const t = s?.playing;
    if (s && t && t.id === loaded) api.post(`/api/music/${s.channel_id}/error`, { track_id: t.id }).catch(() => {});
  });
  return el;
}

function current(): MusicState | null {
  const ch = useVoice.getState().channelId;
  return ch ? useStore.getState().music[ch] ?? null : null;
}

function sync() {
  const s = current();
  const v = useVoice.getState();
  if (!s?.playing) { if (el) { el.pause(); el.removeAttribute("src"); el.load(); } loaded = null; return; }
  const a = audio();
  const out = v.settings.outputDeviceId;
  if (typeof (a as any).setSinkId === "function") (a as any).setSinkId(out && out !== "default" ? out : "").catch(() => {});
  a.muted = !!v.deafened;
  if (loaded !== s.playing.id) {
    loaded = s.playing.id;
    a.src = s.playing.stream_url;
    const seek = () => { a.currentTime = Math.max(0, expected(current() ?? s)); };
    a.addEventListener("loadedmetadata", seek, { once: true });
  } else if (Math.abs(a.currentTime - expected(s)) > 1.5 && a.readyState >= 1) a.currentTime = Math.max(0, expected(s));
  if (s.paused) a.pause();
  else if (a.paused) a.play().catch(() => { /* blocked until the next click: retried on the next sync */ });
}

/** Mounted once at the app root. */
export function MusicListener() {
  const channelId = useVoice((v) => v.channelId);
  const state = useStore((s) => (channelId ? s.music[channelId] : undefined));
  const deafened = useVoice((v) => v.deafened);
  const output = useVoice((v) => v.settings.outputDeviceId);
  useEffect(() => {
    if (!channelId) return;
    // Joining a room: fetch what's playing there (later changes arrive as MUSIC_STATE).
    api.get<MusicState>(`/api/music/${channelId}`).then((d) => useStore.setState((st) => ({ music: { ...st.music, [channelId]: { ...d, received_at: Date.now() } } }))).catch(() => {});
  }, [channelId]);
  useEffect(() => { sync(); }, [channelId, state, deafened, output]);
  useEffect(() => {
    const t = setInterval(sync, 5000);
    const resume = () => { if (el?.paused && current()?.playing && !current()?.paused) sync(); };
    window.addEventListener("pointerdown", resume);
    return () => { clearInterval(t); window.removeEventListener("pointerdown", resume); if (el) el.pause(); };
  }, []);
  return null;
}
