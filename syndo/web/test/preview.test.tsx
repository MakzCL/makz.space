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
// JSDOM omits CSS.escape; the Studio's preset identifiers need CSS selectors.
Object.assign(globalThis, { CSS: { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`) } });
Object.assign(globalThis, { ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
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
  await user.click(screen.getByRole("button", { name: /^SEND Preview/ }));
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

test("Studio keeps its SEND identity, toggles its preview and cancels without a network call", async () => {
  const { Studio } = await import("../src/appearance/Studio.tsx");
  const { within } = await import("@testing-library/react");
  const { useAppearance } = await import("../src/appearance/store.ts");
  let closed = 0;
  const view = render(<Studio onClose={() => { closed++; }} />);
  try {
    const dialog = within(screen.getByRole("dialog", { name: "SEND Studio" }));
    assert.ok(dialog.getByRole("heading", { name: "SEND Studio" }));
    assert.ok(dialog.getByRole("img", { name: "SEND", exact: true }));
    assert.equal(dialog.queryByRole("complementary", { name: "Live preview" }), null);
    const user = userEvent.setup();
    await user.click(dialog.getByRole("button", { name: "Preview", exact: true }));
    assert.ok(dialog.getByRole("complementary", { name: "Live preview" }));
    await user.click(dialog.getByRole("button", { name: "Cancel", exact: true }));
    assert.equal(closed, 1);
    assert.equal(useAppearance.getState().draft, null);
    assert.equal(networkCalls, 0);
  } finally { view.unmount(); }
});

test("profile collections preview independently, filter, save and retain validated artwork", async () => {
  dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as any;
  const { EffectsGallery } = await import("../src/appearance/EffectsGallery.tsx");
  const { validateProfileTheme } = await import("@syndo/shared");
  const user = userEvent.setup(); const view = render(<EffectsGallery />);
  try {
    const before = useStore.getState().me!.profile_theme;
    await user.click(screen.getByRole("button", { name: "Preview Rose Court" }));
    assert.equal(useStore.getState().me!.profile_theme, before, "preview does not change the public profile");
    await user.click(screen.getByRole("combobox", { name: "Collection category" }));
    await user.click(screen.getByRole("option", { name: "Botanical", exact: true }));
    assert.equal(screen.queryByRole("button", { name: "Preview Lunar Eclipse" }), null);
    assert.ok(screen.getByRole("button", { name: "Preview Wisteria Night" }));
    await user.click(screen.getByRole("button", { name: "Save effects", exact: true }));
    assert.equal(useStore.getState().me!.profile_theme?.collection, "rosecourt");
    const profile = await api.get<any>("/api/users/@me");
    assert.equal(validateProfileTheme(profile.profile_theme).value?.collection, "rosecourt");
    assert.ok(validateProfileTheme({ collection: "untrusted-art" }).issues.length);
    assert.equal(networkCalls, 0);
  } finally { view.unmount(); }
});
