import {test,afterEach} from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://send.test",pretendToBeVisual:true});
for(const key of ["window","document","navigator","localStorage","location","HTMLElement","Event","CustomEvent"]as const)Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
dom.window.matchMedia=(()=>({matches:false,addEventListener(){},removeEventListener(){}}))as any;
let captures=0;const rawTracks:FakeTrack[]=[];
class FakeTrack{kind="audio";enabled=true;stopped=false;stop(){this.stopped=true;}getSettings(){return{};}}
class FakeStream{constructor(public tracks:FakeTrack[]){}getAudioTracks(){return this.tracks;}getTracks(){return this.tracks;}}
class FakeAudio{state="running";closed=false;resume(){return Promise.resolve();}close(){this.closed=true;return Promise.resolve();}createMediaStreamSource(){return{connect:(n:any)=>n,disconnect(){}};}createGain(){return{gain:{value:1},connect:(n:any)=>n,disconnect(){}};}createMediaStreamDestination(){return{channelCount:1,stream:new FakeStream([new FakeTrack()])};}}
class FakePC{iceGatheringState="complete";localDescription:any;trans:any[]=[];addTransceiver(track:any){const sender={track,replaceTrack:async(t:any)=>{sender.track=t;},getParameters:()=>({encodings:[{}]}),setParameters:async()=>{}};const trans={mid:String(this.trans.length),sender,stop(){}};this.trans.push(trans);return trans;}getTransceivers(){return this.trans;}createOffer(){return Promise.resolve({type:"offer",sdp:"test-offer"});}setLocalDescription(d:any){this.localDescription=d;return Promise.resolve();}setRemoteDescription(){return Promise.resolve();}close(){}addEventListener(){}removeEventListener(){}}
Object.assign(globalThis,{AudioContext:FakeAudio,MediaStream:FakeStream,RTCPeerConnection:FakePC});
Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>{captures++;const track=new FakeTrack();rawTracks.push(track);return new FakeStream([track]);}}});
const {CloudflareCall}=await import("../src/voice/cloudflare.ts");const{useVoice}=await import("../src/voice/session.ts");const{DEFAULT_VOICE}=await import("../src/voice/settings.ts");
afterEach(()=>{useVoice.setState({grants:null,settings:{...DEFAULT_VOICE}});captures=0;rawTracks.length=0;});
function call(){useVoice.setState({grants:{speak:true,video:true,vad:true},settings:{...DEFAULT_VOICE}});const c=new CloudflareCall("test");c.request=async()=>({sessionDescription:{type:"answer",sdp:"test-answer"}});return c;}
test("speaker and gain changes preserve the microphone capture; processing changes replace and stop the old device",async()=>{
 const c=call();await c.microphone();assert.equal(captures,1);const initial={...DEFAULT_VOICE},volume={...initial,userVolumes:{other:1.5}};await c.applySettings(initial,volume);assert.equal(captures,1);const gain={...volume,inputGain:1.8};await c.applySettings(volume,gain);assert.equal(c.micGain!.gain.value,1.8);assert.equal(captures,1);
 const next={...gain,noiseSuppression:!gain.noiseSuppression};useVoice.setState({settings:next});await c.applySettings(gain,next);assert.equal(captures,2);assert.equal(rawTracks[0]!.stopped,true);c.close();assert.equal(rawTracks[1]!.stopped,true);assert.equal((c.context as unknown as FakeAudio).closed,true);
});
test("camera capture stops immediately while remote cleanup is pending",async()=>{
 const c=call(),camera=new FakeTrack();c.tracks.set("camera",camera as unknown as MediaStreamTrack);let done!:()=>void;c.request=()=>new Promise(resolve=>{done=()=>resolve({ok:true});});const closing=c.stopKind("camera");assert.equal(camera.stopped,true);assert.equal(useVoice.getState().camera,false);await Promise.resolve();done();await closing;c.request=async()=>({ok:true});c.close();
});

test("stopping a share stops both screen and system audio before the network responds",async()=>{
 const c=call(),screen=new FakeTrack(),audio=new FakeTrack();c.tracks.set("screen",screen as unknown as MediaStreamTrack);c.tracks.set("screen-audio",audio as unknown as MediaStreamTrack);c.request=async()=>({ok:true});const stop=c.stopScreen();assert.equal(screen.stopped,true);assert.equal(audio.stopped,true);await stop;c.close();
});
