// Voice calls between phones of the same farm.
// Audio goes directly phone-to-phone (WebRTC). Ringing and connection details
// travel on the farm's live channel. Every phone where the person is (or last
// was) logged in rings; the first to answer takes the call.
// Works while the app is open on both phones. Behind some mobile networks a
// direct connection is not possible without a relay (TURN) server; then the
// call fails to connect and the app offers the phone number instead.
import { html, toast } from './ui.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { currentUser, users } from './auth.js';
import * as sync from './sync.js';
import * as db from './db.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const RING_MS = 35000;

let call = null; // { id, peer: {id,name,phone}, role: 'caller'|'callee', pc, stream, state, started, timer, pending: [] }
const deviceId = () => sync.config()?.deviceId || 'web';
/** The person this phone belongs to: whoever is logged in, else whoever was last. */
function phoneUserId() {
  if (currentUser()) return currentUser().id;
  try { return localStorage.getItem('dairy-last-user'); } catch { return null; }
}
const meName = () => currentUser()?.name || users().find((u) => u.id === phoneUserId())?.name || '';

export const canCall = () => sync.isConnected() && typeof RTCPeerConnection !== 'undefined';
export const inCall = () => !!call;

// ---------- ringtone ----------
let ringCtx = null; let ringTimer = 0;
function ring(on, outgoing = false) {
  clearInterval(ringTimer);
  if (navigator.vibrate) navigator.vibrate(0);
  if (!on) { try { ringCtx?.close(); } catch { /* ignore */ } ringCtx = null; return; }
  try {
    ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      if (!ringCtx) return;
      const o = ringCtx.createOscillator(); const g = ringCtx.createGain();
      o.frequency.value = outgoing ? 425 : 660; o.connect(g); g.connect(ringCtx.destination);
      const now = ringCtx.currentTime;
      g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(outgoing ? 0.05 : 0.18, now + 0.03);
      g.gain.setValueAtTime(outgoing ? 0.05 : 0.18, now + (outgoing ? 1 : 0.4)); g.gain.exponentialRampToValueAtTime(0.0001, now + (outgoing ? 1.05 : 0.45));
      o.start(now); o.stop(now + 1.1);
      if (!outgoing) navigator.vibrate?.([400, 200, 400]);
    };
    beep();
    ringTimer = setInterval(beep, outgoing ? 4000 : 1500);
  } catch { /* no audio */ }
}

// ---------- screen ----------
function screen() {
  let el = document.getElementById('call');
  if (!call) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'call'; el.className = 'call'; el.setAttribute('role', 'dialog'); document.body.append(el); }
  const c = call;
  const mins = c.started ? Math.floor((Date.now() - c.started) / 1000) : 0;
  const clock = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const status = {
    calling: t('Calling…'), ringing: t('Incoming call'), connecting: t('Connecting…'), live: clock,
    ended: c.endText || t('Call ended'),
  }[c.state];
  el.setAttribute('aria-label', `${status} ${c.peer.name}`);
  el.innerHTML = String(html`<div class="call-inner">
    <div class="call-avatar">${(c.peer.name || '?').slice(0, 1).toUpperCase()}</div>
    <p class="call-name">${c.peer.name}</p><p class="call-status" data-testid="call-status">${status}</p>
    ${c.state === 'ended' && c.peer.phone ? html`<a class="btn big call-phone" href="tel:${c.peer.phone}">${icon('phone')}${t('Call {n}’s phone', { n: c.peer.name })}</a>` : ''}
    <div class="call-actions">
      ${c.state === 'ringing' ? html`<button type="button" class="call-btn decline" data-call="decline" aria-label="${t('Decline')}">${icon('x', { size: 30 })}</button>
        <button type="button" class="call-btn accept" data-call="accept" data-testid="call-accept" aria-label="${t('Answer')}">${icon('phone', { size: 30 })}</button>`
      : c.state === 'ended' ? html`<button type="button" class="btn big" data-call="close">${t('Close')}</button>`
      : html`<button type="button" class="call-btn ${c.muted ? 'on' : ''}" data-call="mute" aria-pressed="${!!c.muted}" aria-label="${t('Mute')}">${icon(c.muted ? 'ban' : 'pulse', { size: 26 })}</button>
        <button type="button" class="call-btn decline" data-call="hangup" data-testid="call-hangup" aria-label="${t('Hang up')}">${icon('x', { size: 30 })}</button>`}
    </div></div><audio data-remote autoplay playsinline></audio>`);
  const audio = el.querySelector('[data-remote]');
  if (c.remote) audio.srcObject = c.remote;
  for (const b of el.querySelectorAll('[data-call]')) b.onclick = () => ({ accept, decline: () => end('decline'), hangup: () => end('end'), close: cleanup, mute: toggleMute })[b.dataset.call]();
}

function setState(s, extra = {}) {
  if (!call) return;
  Object.assign(call, { state: s }, extra);
  screen();
}

// ---------- WebRTC ----------
function newPeer() {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  pc.onicecandidate = (e) => { if (e.candidate && call) send({ t: 'ice', candidate: e.candidate.toJSON() }); };
  pc.ontrack = (e) => { if (call) { call.remote = e.streams[0]; screen(); } };
  pc.onconnectionstatechange = () => {
    if (!call) return;
    if (pc.connectionState === 'connected' && call.state !== 'live') {
      ring(false);
      setState('live', { started: Date.now() });
      call.tick = setInterval(screen, 1000);
    }
    if (pc.connectionState === 'failed') end('end', t('Could not connect the call'));
  };
  return pc;
}

function send(p) {
  sync.signal({ ...p, callId: call.id, from: phoneUserId(), fromName: meName(), to: call.peer.id, device: deviceId() });
}

async function mic() {
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); } catch {
    throw new Error(t('Allow the microphone to make calls.'));
  }
}

/** Call a person of the farm. */
export async function startCall(person) {
  if (call) return;
  if (!canCall() || !sync.liveReady()) {
    if (person.phone) { location.href = `tel:${person.phone}`; return; }
    toast(t('Calls need an internet connection on both phones.'), { kind: 'err' });
    return;
  }
  call = { id: db.uid(), peer: person, role: 'caller', state: 'calling', pending: [] };
  screen();
  try {
    call.stream = await mic();
    call.pc = newPeer();
    call.stream.getTracks().forEach((tr) => call.pc.addTrack(tr, call.stream));
    const offer = await call.pc.createOffer();
    await call.pc.setLocalDescription(offer);
    send({ t: 'offer', sdp: offer.sdp });
    ring(true, true);
    call.timer = setTimeout(() => { if (call?.state === 'calling') end('cancel', t('No answer')); }, RING_MS);
  } catch (err) {
    end('cancel', err.message);
  }
}

async function accept() {
  if (!call || call.state !== 'ringing') return;
  ring(false);
  setState('connecting');
  try {
    call.stream = await mic();
    call.pc = newPeer();
    call.stream.getTracks().forEach((tr) => call.pc.addTrack(tr, call.stream));
    await call.pc.setRemoteDescription({ type: 'offer', sdp: call.offer });
    for (const c of call.pending.splice(0)) await call.pc.addIceCandidate(c).catch(() => {});
    const answer = await call.pc.createAnswer();
    await call.pc.setLocalDescription(answer);
    send({ t: 'answer', sdp: answer.sdp });
  } catch (err) {
    end('end', err.message);
  }
}

function toggleMute() {
  if (!call?.stream) return;
  call.muted = !call.muted;
  call.stream.getAudioTracks().forEach((tr) => { tr.enabled = !call.muted; });
  screen();
}

function end(kind, text) {
  if (!call) return;
  if (call.state !== 'ended') send({ t: kind === 'decline' ? 'decline' : 'end' });
  stopMedia();
  setState('ended', { endText: text || (kind === 'decline' ? t('Declined') : t('Call ended')) });
  setTimeout(() => { if (call?.state === 'ended' && !call.peer.phone) cleanup(); }, 2500);
}

function stopMedia() {
  ring(false);
  clearTimeout(call?.timer);
  clearInterval(call?.tick);
  try { call?.stream?.getTracks().forEach((tr) => tr.stop()); } catch { /* ignore */ }
  try { call?.pc?.close(); } catch { /* ignore */ }
}

function cleanup() {
  stopMedia();
  call = null;
  screen();
}

// ---------- incoming signals ----------
async function onSignal(s) {
  const me = phoneUserId();
  if (!me || s.from === me && s.device === deviceId()) return;
  if (s.t === 'offer' && s.to === me) {
    if (call) { sync.signal({ t: 'busy', callId: s.callId, from: me, to: s.from, device: deviceId() }); return; }
    const peer = users().find((u) => u.id === s.from) || { id: s.from, name: s.fromName || '?' };
    call = { id: s.callId, peer, role: 'callee', state: 'ringing', offer: s.sdp, pending: [] };
    ring(true);
    screen();
    call.timer = setTimeout(() => { if (call?.state === 'ringing') { ring(false); cleanup(); } }, RING_MS + 5000);
    return;
  }
  if (!call || s.callId !== call.id) return;
  switch (s.t) {
    case 'answer':
      if (call.role !== 'caller' || call.state !== 'calling') return;
      ring(false);
      clearTimeout(call.timer);
      setState('connecting');
      await call.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
      for (const c of call.pending.splice(0)) await call.pc.addIceCandidate(c).catch(() => {});
      call.answeredBy = s.device;
      send({ t: 'taken', by: s.device });
      break;
    case 'taken': // another of my phones answered
      if (call.role === 'callee' && s.by !== deviceId()) cleanup();
      break;
    case 'ice':
      if (call.role === 'caller' && call.answeredBy && s.device !== call.answeredBy) return;
      if (call.pc?.remoteDescription) await call.pc.addIceCandidate(s.candidate).catch(() => {});
      else call.pending.push(s.candidate);
      break;
    case 'busy':
      if (call.role === 'caller' && call.state === 'calling') { stopMedia(); setState('ended', { endText: t('{n} is on another call', { n: call.peer.name }) }); }
      break;
    case 'decline':
      if (call.role === 'caller' && call.state === 'calling') { stopMedia(); setState('ended', { endText: t('Declined') }); }
      break;
    case 'end':
      stopMedia();
      if (call.state === 'ringing') cleanup(); else setState('ended', { endText: t('Call ended') });
      break;
    default:
  }
}

export function startCalls() {
  sync.onSignal((s) => { onSignal(s).catch(() => {}); });
}
