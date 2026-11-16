import type { CloudflareCall } from "./cloudflare.ts";
import { currentCloudflare, currentRoom, livekit, useVoice } from "./session.ts";

/**
 * Measured media statistics from WebRTC getStats(). Reported next to the
 * requested settings so users (and operators) can see what is actually
 * happening: negotiated codec and channels, transport bitrate, loss, jitter,
 * round-trip time, and for video the real resolution, frame rate and drops.
 */
export interface AudioDiag { codec: string; clockRate: number | null; channels: number | null; fmtp: string; requestedKbps: number; sendKbps: number | null; packetLossPct: number | null; jitterMs: number | null; rttMs: number | null }
export interface VideoLayerDiag { rid: string; width: number | null; height: number | null; fps: number | null; kbps: number | null; limitation: string | null; active: boolean }
export interface InboundDiag { identity: string; kind: string; source: string; codec: string; width: number | null; height: number | null; fps: number | null; kbps: number | null; lossPct: number | null; jitterMs: number | null; dropped: number | null; channels: number | null }
export interface Diagnostics { at: number; audio: AudioDiag | null; screen: { capture: { width: number; height: number; fps: number } | null; codec: string; layers: VideoLayerDiag[] } | null; camera: { codec: string; layers: VideoLayerDiag[] } | null; inbound: InboundDiag[]; candidate: string | null }

const prevBytes = new Map<string, { bytes: number; at: number }>();
function kbps(key: string, bytes: number | undefined, at: number) {
  if (bytes === undefined) return null;
  const p = prevBytes.get(key);
  prevBytes.set(key, { bytes, at });
  if (!p || at <= p.at) return null;
  return Math.round(((bytes - p.bytes) * 8) / (at - p.at)); // bytes per ms*8 = kbit/s
}

function codecOf(report: RTCStatsReport, codecId: string | undefined) {
  const c = codecId ? (report.get(codecId) as any) : null;
  return { codec: c?.mimeType?.split("/")[1] ?? "?", clockRate: c?.clockRate ?? null, channels: c?.channels ?? null, fmtp: c?.sdpFmtpLine ?? "" };
}

export async function collect(): Promise<Diagnostics | null> {
  const any = currentCloudflare();
  const call = any && "producer" in any ? (any as CloudflareCall) : null; // direct (mesh) calls have no SFU stats
  if (call) return collectCloudflare(call);
  const room = currentRoom();
  if (!room) return null;
  const { Track } = livekit();
  const now = performance.now();
  const out: Diagnostics = { at: Date.now(), audio: null, screen: null, camera: null, inbound: [], candidate: null };
  const s = useVoice.getState();
  for (const pub of room.localParticipant.trackPublications.values()) {
    const t = pub.track as any;
    const sender: RTCRtpSender | undefined = t?.sender;
    if (!sender) continue;
    const report = await sender.getStats();
    const outbound = [...report.values()].filter((r: any) => r.type === "outbound-rtp");
    const remoteIn = [...report.values()].filter((r: any) => r.type === "remote-inbound-rtp") as any[];
    for (const r of report.values() as any) if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && !out.candidate) {
      const local = report.get(r.localCandidateId) as any;
      out.candidate = local ? `${local.candidateType}${local.relayProtocol ? ` via TURN/${local.relayProtocol}` : ""} (${local.protocol})` : null;
    }
    if (pub.source === Track.Source.Microphone) {
      const o = outbound[0] as any;
      const ri = remoteIn[0];
      const c = codecOf(report, o?.codecId);
      out.audio = {
        ...c, requestedKbps: Math.round(s.settings.bitrate / 1000),
        sendKbps: kbps(`a:${o?.id}`, o?.bytesSent, now),
        packetLossPct: ri?.fractionLost != null ? Math.round(ri.fractionLost * 1000) / 10 : null,
        jitterMs: ri?.jitter != null ? Math.round(ri.jitter * 1000) : null,
        rttMs: ri?.roundTripTime != null ? Math.round(ri.roundTripTime * 1000) : null,
      };
    }
    if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.Camera) {
      const layers: VideoLayerDiag[] = outbound.map((o: any) => ({
        rid: o.rid ?? "single", width: o.frameWidth ?? null, height: o.frameHeight ?? null, fps: o.framesPerSecond ?? null,
        kbps: kbps(`v:${o.id}`, o.bytesSent, now), limitation: o.qualityLimitationReason ?? null, active: o.active !== false,
      }));
      const c = codecOf(report, (outbound[0] as any)?.codecId);
      if (pub.source === Track.Source.ScreenShare) {
        const st = t.mediaStreamTrack?.getSettings?.() ?? {};
        out.screen = { capture: st.width ? { width: st.width, height: st.height, fps: Math.round(st.frameRate ?? 0) } : null, codec: c.codec, layers };
      } else out.camera = { codec: c.codec, layers };
    }
  }
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      const t = pub.track as any;
      const receiver: RTCRtpReceiver | undefined = t?.receiver;
      if (!receiver) continue;
      const report = await receiver.getStats();
      const i = [...report.values()].find((r: any) => r.type === "inbound-rtp") as any;
      if (!i) continue;
      const c = codecOf(report, i.codecId);
      const total = (i.packetsReceived ?? 0) + (i.packetsLost ?? 0);
      out.inbound.push({
        identity: p.name || p.identity, kind: i.kind, source: pub.source, codec: c.codec, channels: c.channels,
        width: i.frameWidth ?? null, height: i.frameHeight ?? null, fps: i.framesPerSecond ?? null,
        kbps: kbps(`in:${p.identity}:${pub.trackSid}`, i.bytesReceived, now),
        lossPct: total ? Math.round((i.packetsLost / total) * 1000) / 10 : null,
        jitterMs: i.jitter != null ? Math.round(i.jitter * 1000) : null, dropped: i.framesDropped ?? null,
      });
    }
  }
  return out;
}

/** Parse the negotiated Opus parameters so "stereo requested" vs "stereo negotiated" can be shown honestly. */
export function opusFmtp(fmtp: string) {
  const m = Object.fromEntries(fmtp.split(";").map((kv) => kv.trim().split("=")).filter((x) => x.length === 2));
  return { stereo: m["stereo"] === "1", dtx: m["usedtx"] === "1", fec: m["useinbandfec"] === "1", maxAvgBitrate: m["maxaveragebitrate"] ? Number(m["maxaveragebitrate"]) : null };
}

/** Cloudflare calls expose the same measured stats as the LiveKit transport. */
async function collectCloudflare(call:CloudflareCall):Promise<Diagnostics>{
 const now=performance.now(),settings=useVoice.getState().settings;
 const out:Diagnostics={at:Date.now(),audio:null,screen:null,camera:null,inbound:[],candidate:null};
 for(const [kind,sender]of call.senders){
  const report=await sender.getStats();const rows=[...report.values()]as any[];const outbound=rows.filter(r=>r.type==="outbound-rtp"),remote=rows.find(r=>r.type==="remote-inbound-rtp");
  const c=codecOf(report,outbound[0]?.codecId);
  for(const row of rows)if(row.type==="candidate-pair"&&row.nominated&&row.state==="succeeded"&&!out.candidate){const local=report.get(row.localCandidateId)as any;out.candidate=local?`${local.candidateType}${local.relayProtocol?` via TURN/${local.relayProtocol}`:""} (${local.protocol})`:null;}
  if(kind==="mic"){const row=outbound[0];out.audio={...c,requestedKbps:Math.round(settings.bitrate/1000),sendKbps:kbps(`cf:${call.id}:audio:${row?.id}`,row?.bytesSent,now),packetLossPct:remote?.fractionLost!=null?Math.round(remote.fractionLost*1000)/10:null,jitterMs:remote?.jitter!=null?Math.round(remote.jitter*1000):null,rttMs:remote?.roundTripTime!=null?Math.round(remote.roundTripTime*1000):null};}
  if(kind==="screen"||kind==="camera"){
   const layers:VideoLayerDiag[]=outbound.map(row=>({rid:row.rid??"single",width:row.frameWidth??null,height:row.frameHeight??null,fps:row.framesPerSecond??null,kbps:kbps(`cf:${call.id}:video:${row.id}`,row.bytesSent,now),limitation:row.qualityLimitationReason??null,active:row.active!==false}));
   if(kind==="camera")out.camera={codec:c.codec,layers};else{const capture=call.tracks.get("screen")?.getSettings();out.screen={codec:c.codec,layers,capture:capture?.width?{width:capture.width,height:capture.height??0,fps:Math.round(capture.frameRate??0)}:null};}
  }
 }
 for(const transceiver of call.consumer.getTransceivers()){
  const ref=transceiver.mid?call.refs.get(transceiver.mid):null;if(!ref)continue;const report=await transceiver.receiver.getStats(),row=[...report.values()].find((r:any)=>r.type==="inbound-rtp")as any;if(!row)continue;const c=codecOf(report,row.codecId),total=(row.packetsReceived??0)+(row.packetsLost??0);
  out.inbound.push({identity:ref.user,kind:row.kind,source:ref.kind,codec:c.codec,channels:c.channels,width:row.frameWidth??null,height:row.frameHeight??null,fps:row.framesPerSecond??null,kbps:kbps(`cf:${call.id}:in:${row.id}`,row.bytesReceived,now),lossPct:total?Math.round((row.packetsLost/total)*1000)/10:null,jitterMs:row.jitter!=null?Math.round(row.jitter*1000):null,dropped:row.framesDropped??null});
 }
 return out;
}
