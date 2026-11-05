import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { useRef, useState } from "react";
import { P, type Channel, type Message } from "@syndo/shared";

// Render real React controls without needing media devices or a browser installation.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/channels/@me/saved", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "HTMLElement", "CustomEvent", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key] });
}
Object.assign(globalThis, { requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(Date.now()), 0), cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
Object.assign(globalThis, { matchMedia: dom.window.matchMedia });

const { render, screen, cleanup, waitFor, act, fireEvent } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { useStore, dispatch } = await import("../src/store.ts");
const { useMentionAutocomplete } = await import("../src/components/MentionAutocomplete.tsx");
const { SavedMessages } = await import("../src/components/SavedMessages.tsx");
const { ChannelView } = await import("../src/components/ChannelView.tsx");

const alice = { id: "100", username: "alice", display_name: "Alice", avatar: null, banner: null, profile_theme: null };
const bob = { ...alice, id: "101", username: "bob", display_name: "Bobby" };
const channel = { id: "200", guild_id: "300", name: "general", type: 0, rate_limit_per_user: 0, my_permissions: String(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY), permission_overwrites: [] } as unknown as Channel;
const dm = { ...channel, id: "201", guild_id: null, type: 1, recipients: [bob] } as Channel;
const members = { "101": { user: bob, nick: "Bobby", roles: [] } };
const originalFetch = globalThis.fetch;
let saved: Message[];
let requests: { url: string; init?: RequestInit }[];
let saveError = false;

function seed() {
  requests = []; saveError = false;
  useStore.setState({ conn: "ready", me: { ...alice, settings: {}, status: "online" } as any,
    guilds: { "300": { id: "300", name: "Syndo friends", owner_id: "100", channels: [channel], me: { user: alice, roles: [] }, roles: [
      { id: "300", name: "@everyone" }, { id: "400", name: "Team", mentionable: true }, { id: "401", name: "Secret", mentionable: false },
    ] } as any }, members: { "300": members as any }, dms: { "201": dm }, messages: { "200": { list: [], loaded: true, loading: false, hasMore: false } }, notice: [], calls: {}, readStates: {}, typing: {} });
  saved = [{ id: "500", channel_id: channel.id, guild_id: channel.guild_id, author: bob, content: "Remember **Friday**", created_at: new Date().toISOString(), attachments: [], mentions: [], mention_roles: [], reactions: [] } as unknown as Message];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push({ url, init });
    if (url === "/api/users/@me/saved") return Response.json(saved);
    if (url.startsWith("/api/users/@me/saved/") && init?.method === "DELETE") { saved = saved.filter((m) => m.id !== url.split("/").pop()); return Response.json({ ok: true }); }
    if (url.includes("/members?")) return Response.json([{ user: bob, nick: "Bobby", roles: [] }]);
    if (url === "/api/users/@me/settings") {
      if (saveError) return Response.json({ message: "Could not save settings" }, { status: 503 });
      const settings = { ...useStore.getState().me!.settings, ...JSON.parse(String(init?.body)) };
      return Response.json(settings);
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
}
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

function ComposerHarness({ ch = channel }: { ch?: Channel }) {
  const [text, setText] = useState(""); const [sends, setSends] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mention = useMentionAutocomplete(ch, text, setText, textarea);
  return <><textarea ref={textarea} aria-label="Composer" value={text} {...mention.inputProps} onSelect={mention.onSelect} onBlur={mention.onBlur}
    onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (mention.onKeyDown(e)) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setSends((n) => n + 1); } }} />{mention.popup}<output aria-label="Sent count">{sends}</output></>;
}

test("member completion inserts a real mention; Enter selects before sending, Tab also selects", async () => {
  seed(); const user = userEvent.setup(); render(<ComposerHarness />);
  const input = screen.getByRole("textbox", { name: "Composer" });
  await user.type(input, "Hi @bo");
  await screen.findByRole("option", { name: /Bobby/ });
  await user.keyboard("{Enter}");
  assert.equal((input as HTMLTextAreaElement).value, "Hi <@101> ");
  assert.equal(screen.getByLabelText("Sent count").textContent, "0");
  await user.keyboard("{Enter}");
  assert.equal(screen.getByLabelText("Sent count").textContent, "1");
  await user.clear(input); await user.type(input, "@bo"); await user.keyboard("{Tab}");
  assert.equal((input as HTMLTextAreaElement).value, "<@101> ");
});

test("mention completion preserves trailing text and supports pointer selection", async () => {
  seed(); const user = userEvent.setup(); render(<ComposerHarness />);
  const input = screen.getByRole("textbox", { name: "Composer" }) as HTMLTextAreaElement;
  await user.type(input, "Hello @bo later");
  await act(async () => { input.setSelectionRange(9, 9); fireEvent.select(input); });
  await user.click(await screen.findByRole("option", { name: /Bobby/ }));
  assert.equal(input.value, "Hello <@101>  later");
  assert.equal(document.activeElement, input);
});

test("role suggestions obey mention permissions; Escape dismisses; DMs only suggest recipients", async () => {
  seed(); const user = userEvent.setup(); render(<ComposerHarness />);
  const input = screen.getByRole("textbox", { name: "Composer" });
  await user.type(input, "@team");
  await screen.findByRole("option", { name: /Team/ });
  await user.keyboard("{Enter}"); assert.equal((input as HTMLTextAreaElement).value, "<@&400> ");
  await user.clear(input); await user.type(input, "@secret");
  assert.equal(screen.queryByRole("option", { name: /Secret/ }), null);
  await user.clear(input); await user.type(input, "@everyone");
  assert.equal(screen.queryByRole("option", { name: /Notify everyone/ }), null);
  await user.clear(input); await user.type(input, "@bo"); await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("listbox"), null);
  cleanup(); render(<ComposerHarness ch={dm} />);
  await user.type(screen.getByRole("textbox", { name: "Composer" }), "@");
  assert.ok(screen.getByRole("option", { name: /Bobby/ }));
  assert.equal(screen.queryByRole("option", { name: /Team/ }), null);
});

test("debounced member search completes people beyond the loaded page; arrows navigate options", async () => {
  seed(); const user = userEvent.setup();
  const charlie = { ...bob, id: "102", username: "charlie", display_name: "Charlie" };
  globalThis.fetch = (async () => Response.json([{ user: charlie, nick: null, roles: [] }])) as typeof fetch;
  render(<ComposerHarness />);
  const input = screen.getByRole("textbox", { name: "Composer" });
  await user.type(input, "@charlie");
  await screen.findByRole("option", { name: /Charlie/ });
  await user.keyboard("{Enter}");
  assert.equal((input as HTMLTextAreaElement).value, "<@102> ");
  assert.equal(useStore.getState().users["102"].username, "charlie");
  await user.clear(input); await user.type(input, "@");
  const options = screen.getAllByRole("option");
  await user.keyboard("{ArrowDown}");
  assert.equal(options[1].getAttribute("aria-selected"), "true");
  await user.keyboard("{ArrowUp}{ArrowUp}");
  assert.equal(options.at(-1)!.getAttribute("aria-selected"), "true");
});

test("saved inbox searches, renders markdown, jumps and removes through the API", async () => {
  seed(); const user = userEvent.setup(); render(<SavedMessages />);
  await screen.findByRole("article", { name: /Bobby/ });
  assert.equal(screen.getByText("Friday").tagName, "STRONG");
  await user.type(screen.getByRole("searchbox"), "not here");
  assert.ok(screen.getByText("No saved messages match your search."));
  await user.clear(screen.getByRole("searchbox"));
  await user.click(screen.getByRole("button", { name: "Jump to message" }));
  assert.equal(location.pathname, "/channels/300/200/500");
  await user.click(screen.getByRole("button", { name: /Remove saved message/ }));
  await screen.findByText("Keep something for later");
  assert.ok(requests.some((r) => r.init?.method === "DELETE" && r.url.endsWith("/500")));
});

test("saved inbox refreshes other-device edits and hides entries after access loss", async () => {
  seed(); render(<SavedMessages />); await screen.findByText("Friday");
  saved = [{ ...saved[0], content: "Changed on another device" }];
  await act(async () => dispatch("MESSAGE_UPDATE", saved[0]));
  await screen.findByText("Changed on another device");
  saved = [];
  await act(async () => dispatch("GUILD_SYNC", useStore.getState().guilds["300"]));
  await screen.findByText("Keep something for later");
  assert.equal(screen.queryByText("Changed on another device"), null);
});

test("a stale saved response cannot restore messages after a permission refresh", async () => {
  seed(); let resolveFirst!: (value: Response) => void;
  const stale = [...saved];
  globalThis.fetch = (() => new Promise<Response>((resolve) => { resolveFirst = resolve; })) as typeof fetch;
  render(<SavedMessages />);
  globalThis.fetch = (async () => Response.json([])) as typeof fetch;
  await act(async () => dispatch("GUILD_SYNC", useStore.getState().guilds["300"]));
  await screen.findByText("Keep something for later");
  await act(async () => resolveFirst(Response.json(stale)));
  assert.equal(screen.queryByText("Friday"), null);
});

test("saved inbox reports fetch failures and supports retry", async () => {
  seed(); const user = userEvent.setup(); const goodFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  render(<SavedMessages />); await screen.findByRole("alert");
  globalThis.fetch = goodFetch;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Friday");
});

test("mute control persists, follows settings updates, and never confirms a failed write", async () => {
  seed(); const user = userEvent.setup(); render(<ChannelView channelId="200" guildId="300" highlight={null} />);
  await user.click(screen.getByRole("button", { name: "Mute conversation" }));
  await screen.findByRole("button", { name: "Unmute conversation" });
  assert.deepEqual(useStore.getState().me!.settings.muted_channels, ["200"]);
  assert.ok(requests.some((r) => r.url.endsWith("/settings") && JSON.parse(String(r.init?.body)).muted_channels.includes("200")));
  await act(async () => dispatch("USER_SETTINGS_UPDATE", { muted_channels: [] }));
  await screen.findByRole("button", { name: "Mute conversation" });
  saveError = true;
  await user.click(screen.getByRole("button", { name: "Mute conversation" }));
  await waitFor(() => assert.ok(useStore.getState().notice.some((n) => n.text === "Could not save settings")));
  assert.ok(screen.getByRole("button", { name: "Mute conversation" }));
  assert.deepEqual(useStore.getState().me!.settings.muted_channels, []);
});

test("message notifications respect the synced conversation mute preference", async () => {
  seed(); const notices: string[] = [];
  const { initNotifications } = await import("../src/notify.ts");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: class {
    static permission = "granted";
    constructor(title: string) { notices.push(title); }
  } });
  useStore.setState((s) => ({ me: { ...s.me!, settings: { muted_channels: ["200"], notifications: { desktop: true, sounds: false } } } }));
  initNotifications();
  dispatch("MESSAGE_CREATE", { ...saved[0], mentions: ["100"], mention_roles: [] });
  assert.equal(notices.length, 0);
  dispatch("USER_SETTINGS_UPDATE", { muted_channels: [], notifications: { desktop: true, sounds: false } });
  dispatch("MESSAGE_CREATE", { ...saved[0], id: "501", mentions: ["100"], mention_roles: [] });
  assert.equal(notices.length, 1);
});


test("private messages have no encryption badges or key prompts", async () => {
 seed(); const message = { id: "800", channel_id: "201", guild_id: null, author: bob, content: "Private audit message", type: 0, created_at: new Date().toISOString(), edited_at: null, attachments: [], mentions: [], mention_roles: [], reactions: [], _encrypted: true } as any;
 useStore.setState({ messages: { "201": { list: [message], loaded: true, loading: false, hasMore: false } } });
 const rendered = render(<ChannelView channelId="201" guildId={null} highlight={null} />);
 assert.equal(rendered.container.querySelectorAll("article .encryption-mark").length, 0);
 assert.equal(screen.queryByText("End-to-end encrypted messages"), null);
 act(() => useStore.setState({ messages: { "201": { list: [{ ...message, _encrypted: false }], loaded: true, loading: false, hasMore: false } } }));
 assert.equal(rendered.container.querySelectorAll("article .encryption-mark").length, 0, "plain DMs are not labelled");
 assert.equal(screen.queryByText(/recovery key/i), null, "never asks for a recovery key");
});
