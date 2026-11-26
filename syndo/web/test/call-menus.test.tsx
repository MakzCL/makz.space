import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "HTMLElement", "Element", "HTMLVideoElement", "CustomEvent", "Event", "MutationObserver", "getComputedStyle"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key] });
dom.window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
Object.assign(globalThis, { matchMedia: dom.window.matchMedia, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout });
const { render, screen, cleanup, fireEvent, act } = await import("@testing-library/react");
const { tileMenuItems, audioMenuItems, contextMenuKey } = await import("../src/components/callMenus.tsx");
const { userMenuItems } = await import("../src/components/menus.tsx");
const { ContextMenuHost, openContextMenu, closeContextMenu } = await import("../src/components/overlay.tsx");
const { VideoTile } = await import("../src/components/VoiceStage.tsx");
const { useVoice } = await import("../src/voice/session.ts");
const { useStore } = await import("../src/store.ts");
const alice = { id: "100", username: "alice", display_name: "Alice", avatar: null, banner: null, profile_theme: null };
const bob = { ...alice, id: "101", username: "bob", display_name: "Bob" };
function seed() {
  useStore.setState({ me: { ...alice, settings: {} } as any, users: { "101": bob as any }, guilds: {}, relationships: {}, voice: { "101": { user_id: "101", channel_id: "200" } as any } });
  useVoice.setState({ channelId: "200", peers: {}, grants: { speak: true, video: true, vad: true }, muted: false, deafened: false, camera: false, settings: { ...useVoice.getState().settings, userVolumes: { "101": 1.45, "101:stream": 0.6 } } });
}
afterEach(() => { act(closeContextMenu); cleanup(); });
const labels = (items: any[]) => items.filter(i => i.label).map(i => i.label);
test("stream, camera and own stream expose different actions", () => {
  seed(); let focused = 0;
  const opts = { uid: "101", screen: true, local: false, focused: false, hasVideo: true, onFocus: () => focused++, onFullscreen: () => {}, onPip: () => {}, onProfile: () => {}, participantItems: userMenuItems(bob as any) };
  const remote = tileMenuItems(opts);
  assert.deepEqual(labels(remote), ["Focus stream", "Fullscreen", "Picture in picture", "Mute stream audio", "Streamer profile"]);
  (remote[0] as any).onSelect(); assert.equal(focused, 1);
  assert.ok(labels(tileMenuItems({ ...opts, local: true })).includes("Stop sharing"));
  assert.ok(!labels(tileMenuItems({ ...opts, local: true })).includes("Mute stream audio"));
  const camera = labels(tileMenuItems({ ...opts, screen: false, hasVideo: false, focused: true }));
  assert.ok(camera.includes("Message") && camera.includes("Mute locally"));
  assert.ok(!camera.includes("Fullscreen") && !camera.includes("Picture in picture") && !camera.includes("Stop sharing"));
});
test("participant voice controls require the same call; own actions use grants", () => {
  seed(); assert.ok(labels(userMenuItems(bob as any)).includes("Mute locally"));
  useVoice.setState({ channelId: "other" }); assert.ok(!labels(userMenuItems(bob as any)).includes("Mute locally"));
  useVoice.setState({ channelId: null }); assert.ok(!labels(userMenuItems(alice as any)).includes("Disconnect"));
  useVoice.setState({ channelId: "200", grants: { speak: false, video: false, vad: false } });
  const own = userMenuItems(alice as any) as any[];
  assert.equal(own.find(i => i.label === "Mute microphone").disabled, true);
  assert.equal(own.find(i => i.label === "Turn camera on").disabled, true);
  assert.ok(!labels(own).includes("Message"));
});
test("stream volume stays independent, updates live, and unmute restores the previous level", () => {
  seed(); render(<ContextMenuHost />);
  act(() => openContextMenu({ clientX: 20, clientY: 20 }, audioMenuItems("101", true)));
  fireEvent.change(screen.getByRole("slider", { name: "Stream volume" }), { target: { value: "1.25" } });
  assert.equal(useVoice.getState().settings.userVolumes["101:stream"], 1.25);
  assert.equal(useVoice.getState().settings.userVolumes["101"], 1.45);
  assert.ok(screen.getByText("125%"));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute stream audio" }));
  assert.equal(useVoice.getState().settings.userVolumes["101:stream"], 0);
  act(() => openContextMenu({}, audioMenuItems("101", true)));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute stream audio" }));
  assert.equal(useVoice.getState().settings.userVolumes["101:stream"], 1.25);
});
test("keyboard opens the camera menu, reaches volume, and Escape restores focus", async () => {
  seed(); render(<><VideoTile t={{ key: "101:camera", uid: "101", name: "Bob", track: null, kind: "camera", speaking: false, muted: false, local: false }} guildId={null} onFocus={() => {}} /><ContextMenuHost /></>);
  const tile = screen.getByRole("figure", { name: "Bob" }); tile.focus();
  fireEvent.keyDown(tile, { key: "F10", shiftKey: true });
  assert.ok(screen.getByRole("menuitem", { name: "Message" }));
  assert.equal(screen.queryByRole("menuitem", { name: "Fullscreen" }), null);
  const mute = screen.getByRole("menuitemcheckbox", { name: "Mute locally" }); mute.focus();
  fireEvent.keyDown(mute, { key: "ArrowDown" });
  assert.equal(document.activeElement, screen.getByRole("slider", { name: "User volume" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await act(async () => { await Promise.resolve(); });
  assert.equal(screen.queryByRole("menu"), null); assert.equal(document.activeElement, tile);
  fireEvent.contextMenu(tile, { clientX: 40, clientY: 40 });
  fireEvent.pointerDown(document.body); assert.equal(screen.queryByRole("menu"), null);
});
test("ContextMenu key opens without intercepting ordinary keys", () => {
  let count = 0; const event = (key: string, shiftKey = false) => ({ key, shiftKey, preventDefault() {}, stopPropagation() {} } as any);
  contextMenuKey(event("Enter"), () => count++); contextMenuKey(event("F10"), () => count++); assert.equal(count, 0);
  contextMenuKey(event("ContextMenu"), () => count++); contextMenuKey(event("F10", true), () => count++); assert.equal(count, 2);
});
test("right-clicking a stream tile opens media actions rather than participant moderation", () => {
  seed(); let focused = false;
  render(<><VideoTile t={{ key: "101:screen", uid: "101", name: "Bob's screen", track: null, kind: "screen", speaking: false, muted: false, local: false }} guildId={null} onFocus={() => { focused = true; }} /><ContextMenuHost /></>);
  const tile = screen.getByRole("figure", { name: "Bob's screen" });
  fireEvent.contextMenu(tile, { clientX: 64, clientY: 80 });
  assert.ok(screen.getByRole("slider", { name: "Stream volume" }));
  assert.equal(screen.queryByRole("menuitem", { name: "Block" }), null);
  assert.equal(screen.queryByRole("menuitem", { name: "Message" }), null);
  fireEvent.click(screen.getByRole("menuitem", { name: "Focus stream" }));
  assert.equal(focused, true); assert.equal(screen.queryByRole("menu"), null);
});
