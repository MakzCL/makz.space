// Screen sharing never streams SEND's own sound back to the call.
import { test } from "node:test";
import assert from "node:assert/strict";
const { dropEchoingAudio, shareMayEcho } = await import("../src/voice/settings.ts");

const track = (settings: Record<string, unknown>) => ({ kind: "audio", stopped: false, getSettings: () => settings, stop() { this.stopped = true; } });
const stream = (...audio: ReturnType<typeof track>[]) => {
  const list = [...audio];
  return { list, getAudioTracks: () => [...list], removeTrack: (t: any) => { list.splice(list.indexOf(t), 1); } } as any;
};

test("whole screen sound that may carry SEND's audio is removed, and reported once", () => {
  const t = track({ displaySurface: "monitor" });
  const s = stream(t);
  dropEchoingAudio(s);
  assert.equal(s.list.length, 0);
  assert.equal(t.stopped, true);
  assert.equal(shareMayEcho({ kind: "monitor" }, null), true);
  assert.equal(shareMayEcho({ kind: "monitor" }, null), false);
});

test("window sound without restrictOwnAudio is removed", () => {
  const s = stream(track({ displaySurface: "window" }));
  dropEchoingAudio(s);
  assert.equal(s.list.length, 0);
  shareMayEcho(undefined, null);
});

test("sound is kept when the browser leaves SEND's own audio out", () => {
  const t = track({ displaySurface: "monitor", restrictOwnAudio: true });
  const s = stream(t);
  dropEchoingAudio(s);
  assert.equal(s.list.length, 1);
  assert.equal(t.stopped, false);
  assert.equal(shareMayEcho({ kind: "monitor" }, t as any), false);
});

test("a shared tab keeps its sound (it only carries that tab's audio)", () => {
  const s = stream(track({ displaySurface: "browser" }));
  dropEchoingAudio(s);
  assert.equal(s.list.length, 1);
  assert.equal(shareMayEcho({ kind: "browser" }, null), false);
});
