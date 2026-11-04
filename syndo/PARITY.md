# SEND ↔ Discord interaction parity

The target is functional and interaction parity with Discord on desktop and web, with SEND's own
visual identity. This file tracks **interaction behaviour**: mouse, keyboard, dismissal, menus and
messaging formats. Backend feature coverage (accounts, servers, permissions, moderation, privacy)
lives in [FEATURE_MATRIX.md](FEATURE_MATRIX.md), whose IDs are referenced here.

**Status key**
- ✅ **Verified**: works end to end and is exercised by an automated browser or server test (evidence column).
- 🟡 **Partial**: works, but part of Discord's behaviour is missing or untested.
- ❌ **Missing**: not built.
- 🔒 **Blocked**: needs credentials, a licence or a platform capability SEND doesn't have.

**About the references.** Discord's help centre blocks automated fetches (HTTP 403). Only **Ctrl/⌘+/**
(the shortcut list) is confirmed from Discord's own support pages. The other default bindings below
come from [Hongkiat's 2024 list](https://www.hongkiat.com/blog/keyboard-shortcuts-discord) and agree
with other third-party lists. They should be re-checked against Discord's in-app Ctrl+/ overlay.
Behaviours marked *(unverified)* are my best understanding of current Discord and weren't checked
against the live client.

Last updated: 2026-11-04 (batches 1–2: interaction system, shortcuts and Keybinds).

## 1. Dismissal and overlays

| Surface | Discord behaviour (reference) | SEND | Evidence / notes |
|---|---|---|---|
| Image viewer | Opens on click; backdrop or Esc closes; media and controls don't | ✅ | e2e/interactions: open, ←/→, image click keeps open, backdrop closes, Esc closes |
| Viewer: focus/scroll/draft restore | Returns to the conversation unchanged | ✅ | e2e/interactions: focus back on the opener, scrollTop unchanged, draft kept |
| Viewer gallery | Pages through a message's media *(unverified: Discord may page a wider set)* | 🟡 | Pages within one message; across-channel paging not built |
| Viewer zoom / pan | Click-to-zoom on newer clients *(unverified)* | 🟡 | Double-click toggles 1:1 with scroll-pan; no pinch zoom |
| Profile popout | Outside press and Esc close; clicking the same name toggles | ✅ | e2e/interactions (4 checks incl. focus restore) |
| Emoji picker (reactions) | Toggle button closes it; outside press closes | ✅ | e2e/interactions |
| Emoji picker in the composer | Ctrl/⌘+E toggles | ✅ | Composer emoji button + Ctrl/⌘+E (e2e/keyboard) |
| GIF / sticker pickers | Tabs in the expression picker | ❌ | No GIF provider or stickers yet; GIF search needs a provider key (🔒 Tenor/Giphy API) |
| Context menus | Right-click; inside viewport; nested submenus; keyboard | ✅ | e2e/interactions: clamp, submenu hover grace, Esc closes submenu then menu, outside press |
| Context menu: keyboard open | Shift+F10 / Menu key on focused item | 🟡 | Works on any focused element with a menu (browser `contextmenu`); message focus traversal not built |
| Server header menu | Toggle; outside press closes | ✅ | e2e/interactions |
| Status menu (user panel) | Toggle; outside press closes | 🟡 | Same Popover component as the server menu; no dedicated test |
| Select dropdowns | Esc closes the list only, not the dialog | ✅ | e2e/interactions: Esc closes the list, next Esc closes settings |
| Tooltips | Themed, hide on exit, scroll and press | ✅ | e2e/interactions (rail tooltip beside icon; hides on exit) |
| Pins | Popout; outside press closes | 🟡 | Docked panel that closes on outside press or Esc; Discord renders it as a floating popout |
| Search results | Stay until cleared or closed | 🟡 | Esc and ✕ close; no outside dismissal (as Discord) *(unverified)* |
| Inbox / mentions popover | Ctrl/⌘+I opens Mentions inbox | ❌ | No inbox surface yet |
| Settings dialogs | Full-screen; Esc closes; unsaved-changes bar blocks leaving | 🟡 | Esc closes (layer). No unsaved-changes guard in user/server settings; Studio asks before discarding |
| Destructive confirmations | Themed dialog; Shift+click skips for message delete | ✅ | e2e/interactions: themed dialog, Esc cancels, Shift+click deletes and syncs to the other client |
| Native OS dialogs | Never used | ✅ | All 25 `confirm`/`prompt` sites replaced; tests fail on any native dialog |
| Masked-link warning | "Leaving Discord" dialog | ✅ (themed) | `askConfirm` before opening |
| Closing a viewer vs minimising the window | Dismissal only | ✅ | Viewer is an in-page layer; the desktop shell's window controls aren't involved |

## 2. Mouse actions

| Action | Discord | SEND | Notes |
|---|---|---|---|
| Hover message → action bar | Quick reactions, reply, edit, more | ✅ | Existing toolbar; Shift-hover "expanded" variant missing |
| Shift+click Delete | Deletes without confirmation | ✅ | e2e/interactions |
| Alt+click message | Mark unread from here | 🟡 | Implemented; no automated test yet |
| Right-click message/user/channel/server/DM | Context menus | ✅ / 🟡 | Message menu verified; user/channel/server/DM menus built, not yet browser-tested |
| Click server/channel | Navigate | ✅ | Existing e2e |
| Drag servers to reorder | Yes, plus folders | 🟡 | Reorder only; folders missing (SERVER-05) |
| Drag channels to reorder | Yes (with permission) | ❌ | |
| Drag files onto chat | Upload | 🟡 | Exists; no progress/cancel e2e test |
| Middle-click / back-forward mouse buttons | Navigate history *(desktop)* | ❌ | Batch 2 (keybinds supports mouse buttons) |

## 3. Keyboard shortcuts

Central registry: `web/src/shortcuts.ts`, defaults in `web/src/shortcutActions.ts`. Bindings are
customisable in **Settings → Keybinds** and synced to the account.

**Rules**
- `Mod` = Ctrl on Windows/Linux and ⌘ on macOS.
- Nothing fires during IME composition.
- Plain keys never fire inside text fields; modified combos do.
- While a dialog, menu or picker is open, only mute/deafen and answer-call work.
- Key-repeat is ignored except for navigation.

Evidence: `e2e/keyboard.cjs` (34/34, stable over 3 runs).

| Action | Default (Win/Linux) | Status | Evidence / notes |
|---|---|---|---|
| Show shortcuts | Ctrl+/ (**confirmed by Discord support**) | ✅ | e2e: opens, Esc closes |
| Quick switcher | Ctrl+K | ✅ | e2e |
| Previous/next server | Ctrl+Alt+↑/↓ | ✅ | e2e (Home ↔ server) |
| Previous/next channel or DM | Alt+↑/↓ | ✅ | e2e; voice channels are skipped (entering one joins it) |
| Previous/next unread channel | Alt+Shift+↑/↓ | ✅ | e2e skips read channels |
| Previous/next channel with mentions | Ctrl+Alt+Shift+↑/↓ | 🟡 | Built (rail order then DMs); not e2e-tested |
| Mark channel read / server read | Esc / Shift+Esc | ✅ | e2e (server read). Esc is first used by an open layer, a reply, an edit or a ringing call |
| Back to previous text channel | Alt+← and Ctrl+B | ✅ | e2e (Alt+←); Ctrl+B doesn't fire in text fields |
| Forward | Alt+→ | 🟡 | Browser history forward |
| Go to connected voice channel | Ctrl+Alt+A | 🟡 | Built; untested (needs a live call) |
| Toggle pins / member list | Ctrl+P / Ctrl+U | ✅ | e2e |
| Mentions inbox | Ctrl+I | ❌ | No inbox surface yet |
| Search | Ctrl+F | 🟡 | Opens search and focuses it; untested |
| Emoji picker in the composer | Ctrl+E | ✅ | e2e: opens and inserts at the cursor |
| Jump to oldest unread | Shift+PgUp | 🟡 | Scrolls to the "New" divider when loaded; untested |
| Upload a file | Ctrl+Shift+U | 🟡 | Opens the file picker; untested (file dialogs can't be driven headless) |
| Create server / group DM | Ctrl+Shift+N / Ctrl+Shift+T | 🔒 web / 🟡 desktop | Browsers reserve these; the Keybinds page says so. Untested in the desktop shell |
| Start call in DM | Ctrl+[ | 🟡 | Built; needs a live call to verify |
| Answer / decline incoming call | Ctrl+Enter / Esc | 🟡 | Situational (only while ringing); needs a live call to verify |
| Toggle mute / deafen | Ctrl+Shift+M / Ctrl+Shift+D | ✅ | e2e (mute); also works over dialogs |
| Help centre | Ctrl+Shift+H | ❌ | SEND has no help centre; not bound |
| Focus the message box | Tab (Discord) | 🟡 deliberate | Unbound by default: Tab stays keyboard navigation (skip link). Typing any character focuses the box (e2e) |
| Edit last own message | ↑ in an empty box | ✅ | e2e (also checks it doesn't trigger with text) |
| Cancel edit / reply | Esc | ✅ | e2e: edit cancels and focus returns to the box |
| Mention autocomplete | ↑/↓, Tab/Enter, Esc | ✅ | Existing |
| Media viewer | ←/→, Home/End, Esc | ✅ | e2e/interactions |
| Push to talk (in app / global desktop) | User key (default V) | ✅ / 🟡 | In-app existing. Global via desktop uiohook (untested here). Releases on blur (web), leaving the call, rebinding or leaving PTT mode |
| Keybinds page | Record, add, remove, disable, reset, restore defaults, conflicts, mouse buttons, global vs in-app labels | ✅ | e2e: record, conflict explanation, move on save, Esc captured while recording, persists across reload, syncs to a second device, restore defaults |
| Mouse buttons as bindings | Middle / Back / Forward (+ modifiers) | 🟡 | Recorder supports them; plain Back/Forward keep native history unless bound; untested |
| Server reorder from the keyboard | (SEND extra) | ✅ | Moved to Ctrl/⌘+Shift+↑/↓ so Alt+↑/↓ stays channel navigation |

## 4. Messaging formats and behaviour

| Feature | SEND | Notes |
|---|---|---|
| DMs, group DMs, server text channels | ✅ | MSG-* in FEATURE_MATRIX; DMs end-to-end encrypted (unaudited beta, see PRIVACY.md) |
| Replies + reply preview, jump to original | ✅ | Existing e2e |
| Edit (inline, Esc cancels, Enter saves), delete | ✅ | Existing e2e (edit sync) + interactions (delete) |
| Reactions, reaction list ("who reacted") | 🟡 | Toggle verified; "who reacted" list missing |
| Mentions, role mentions, autocomplete | ✅ | Server tests + UI autocomplete |
| Unread markers / "New" divider / mention badges | ✅ | Existing |
| Jump to present / unread banner | ❌ | |
| Typing indicators | ✅ | Existing |
| Pins, saved messages | ✅ | |
| Message links + jump/highlight | ✅ | |
| Search with filters | 🟡 | Server channels; encrypted DMs aren't searchable server-side (by design: no plaintext) |
| Uploads: picker, drag-drop, paste, progress, cancel | 🟡 | Built; needs e2e |
| Image/video/audio playback, voice messages | ✅ / 🟡 | Images verified in the viewer; video/audio inline untested |
| Multi-image galleries (grid layout in chat) | ❌ | Images stack vertically; the viewer pages them |
| Spoilers (text) | ✅ | Markdown `||spoiler||` |
| Spoiler attachments | ❌ | |
| Link previews / embeds | ❌ | Needs a server-side unfurler with SSRF protection; never for encrypted DMs (would leak the URL) |
| Grouping, timestamps, date separators | ✅ | |
| Markdown: bold/italic/underline/strike, code, code blocks, quotes, lists, headings, masked links | 🟡 | Most supported; verify lists/headings/subtext against Discord's current markdown |
| Unicode emoji | ✅ | |
| Custom server emoji, stickers | ❌ | Needs upload/storage + permissions (batch 3) |
| Draft persistence per conversation | 🟡 | Stored per channel in sessionStorage (this tab only). Discord syncs drafts per device |
| Failed send → retry/discard | ✅ | Context menu offers both |
| Per-conversation/server notification settings | 🟡 | Mute channel/conversation/server; no "only @mentions" level |

## 5. Calls and media

| Feature | SEND | Notes |
|---|---|---|
| DM/group ringing, accept, decline | 🟡 | Banner + sounds; answer/decline shortcuts missing |
| Voice channels join/leave, participant list | ✅ (signalling) | Media path can't be verified from the build sandbox (no UDP); see the TURN note |
| Mute/deafen, speaking indicators | 🟡 | Speaking rings from real audio levels on Cloudflare calls (new); not tested in a real call |
| Camera, screen share, system audio | 🟡 | Built; local capture stops immediately on request (`stopKind` stops the track before the network call) |
| Per-user and per-stream volume | ✅ (UI) | Popover now uses the layer manager |
| Input gain, device selection, NS/EC/AGC | ✅ (UI) | Output-only changes don't reacquire the mic (`applySettings` checks capture keys) |
| Krisp | 🔒 | Embedded SDK needs a licence. Krisp's virtual microphone is supported as an input device. The standard noise-suppression switch is not Krisp |
| TURN relay (strict networks) | 🔒 | Code ready; needs a TURN key created in the Cloudflare dashboard (the API connector hides the token) |
| Grid/focus, fullscreen, PiP | 🟡 | Exists; untested |
| Media-frame E2EE | ❌ | Calls use WebRTC transport encryption only; not claimed as E2EE |

## 6. Server, account, desktop

See FEATURE_MATRIX.md for servers, roles, moderation, privacy, sessions and friends (most ✅ with
server tests). Interaction gaps:

| Item | SEND | Notes |
|---|---|---|
| Channel/category context actions (rename, delete, invite, mute, mark read) | 🟡 | New menus; rename uses a themed text dialog; untested in a browser |
| Kick/ban from member context menu | 🟡 | Permission-gated items; the server enforces hierarchy |
| Developer mode (copy IDs) | ✅ | Settings → Advanced; e2e/keyboard checks "Copy message ID" appears |
| Desktop tray, startup, hardware acceleration toggle | 🟡 | See DESKTOP.md; HW-acceleration restart flow unverified |
| Integrated title bar & window controls | ✅ | Unchanged |

## 7. Profile media

| Item | SEND | Notes |
|---|---|---|
| Crop-to-size editor (avatar square/circle preview, banner ratio) | ❌ | Batch 4 |
| Animated GIF crop preserving animation | ❌ | Needs frame-by-frame re-encode. If unavailable, the editor must say so and never silently flatten |
| Bundle catalogue framing review | ❌ | Batch 4: per-asset focal points for avatar vs banner |
| Server rail pill vs icon | ✅ | Fixed; e2e geometry check |

## Order of remaining work

1. ~~Batch 2~~ done (see §3).
2. **Batch 3**: messaging gaps (jump to present, reaction lists, gallery grid, spoiler attachments,
   custom emoji/stickers, upload progress tests, "only mentions" notifications).
3. **Batch 4**: crop editor and catalogue framing.
4. **Batch 5**: call shortcuts, settings unsaved-changes guard, channel drag-reorder, server folders.
