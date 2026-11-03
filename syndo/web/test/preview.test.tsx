import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://appassets.androidplatform.net/index.html?preview=1", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "HTMLElement", "CustomEvent", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key] });
}
Object.assign(globalThis, { requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(Date.now()), 0), cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
Object.assign(globalThis, { matchMedia: dom.window.matchMedia });
let networkCalls = 0;
globalThis.fetch = (async () => { networkCalls++; throw new Error("Preview must stay offline"); }) as typeof fetch;
Object.defineProperty(globalThis, "WebSocket", { value: class { constructor() { networkCalls++; throw new Error("Preview must not open a gateway"); } } });
const { api, upload } = await import("../src/api.ts");
const { boot, sendMessage, setConversationMuted } = await import("../src/actions.ts");
const { connectGateway } = await import("../src/gateway.ts");
const { useStore } = await import("../src/store.ts");
const { render, screen, cleanup, act } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { Shell } = await import("../src/components/Shell.tsx");
after(cleanup);

test("APK preview boots offline, renders the real shell and supports local messages, saves, mutes and Studio", async () => {
  await boot(); connectGateway(); window.dispatchEvent(new Event("online"));
  assert.equal(useStore.getState().conn, "ready");
  const user = userEvent.setup(); render(<Shell />);
  await screen.findByRole("heading", { name: "Friends" });
  await user.click(screen.getByRole("button", { name: /^Syndo Preview/ }));
  await screen.findByRole("heading", { name: "general", exact: true });
  assert.equal(new URLSearchParams(location.search).get("preview"), "1", "preview links remain shareable after navigation");
  await screen.findByText(/Welcome to the/);
  await act(async () => sendMessage("3001", "Hello from the APK preview", {}));
  await screen.findByText("Hello from the APK preview");
  const sent = useStore.getState().messages["3001"].list.find((m) => m.content === "Hello from the APK preview")!;
  assert.equal(sent._state, undefined);
  await act(async () => api.put(`/api/users/@me/saved/${sent.id}`));
  assert.ok((await api.get<any[]>("/api/users/@me/saved")).some((m) => m.id === sent.id));
  await act(async () => setConversationMuted("3001", true));
  assert.deepEqual(useStore.getState().me!.settings.muted_channels, ["3001"]);
  const theme = { theme: { preset: "default" } };
  const applied = await api.put<any>("/api/appearance/global", { data: theme });
  assert.equal(applied.rev, 1);
  assert.deepEqual((await api.get<any>("/api/appearance")).prefs[0].data, theme);
  assert.ok(localStorage.getItem("syndo.preview.data.v1")?.includes("Hello from the APK preview"));
  assert.equal(networkCalls, 0);
});

test("preview rejects live-only actions and uploads without contacting the server", async () => {
  await assert.rejects(api.post("/api/voice/token", { channel_id: "3001" }), /needs the live server/);
  await assert.rejects(upload("/api/channels/3001/attachments", new FormData(), () => {}).promise, /Uploads need the live server/);
  assert.equal(networkCalls, 0);
});
