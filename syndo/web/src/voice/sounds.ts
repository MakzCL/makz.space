import { onEvent,useStore } from "../store.ts";
import { useVoice } from "./session.ts";
type Sound="join"|"leave"|"mute"|"unmute"|"deafen"|"undeafen"|"calling"|"ring"|"ended";
const notes:Record<Sound,number[]>={join:[440,660,880],leave:[660,440],mute:[520,350],unmute:[350,620],deafen:[440,310,220],undeafen:[220,440,660],calling:[430,540],ring:[660,880,660,880],ended:[440,330,220]};
let ctx:AudioContext|null=null;
export function playCallSound(kind:Sound){
 const state=useStore.getState(),v=useVoice.getState();if(v.settings.suppressSoundEffects||(state.me?.settings as any)?.notifications?.sounds===false)return;
 try{ctx??=new AudioContext();ctx.resume().catch(()=>{});const now=ctx.currentTime;notes[kind].forEach((freq,i)=>{const osc=ctx!.createOscillator(),gain=ctx!.createGain(),start=now+i*.085;osc.type="sine";osc.frequency.setValueAtTime(freq,start);gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.055,start+.012);gain.gain.exponentialRampToValueAtTime(.0001,start+.18);osc.connect(gain).connect(ctx!.destination);osc.start(start);osc.stop(start+.2);});}catch{/* Audio is optional; never interfere with a call. */}
}
export function initCallSounds(){let timer:ReturnType<typeof setInterval>|null=null;const stop=()=>{if(timer)clearInterval(timer);timer=null};
 onEvent("CALL_UPDATE",call=>{stop();const me=useStore.getState().me;if(!me||me.status==="dnd")return;const incoming=call.ringing.includes(me.id),outgoing=useVoice.getState().channelId===call.channel_id&&call.ringing.length>0;if(!incoming&&!outgoing)return;const sound=incoming?"ring":"calling";playCallSound(sound);timer=setInterval(()=>playCallSound(sound),3000);});
 onEvent("CALL_DELETE",()=>{stop();playCallSound("ended")});
 useVoice.subscribe((next,prev)=>{if(next.channelId!==prev.channelId&&next.channelId===null)stop();});
}
