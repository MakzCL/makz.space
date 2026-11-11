# SEND changelog

## 2026-11-11 — Syndo → SEND in the code, voice status, GIF and payment setup

- **Voice channel status** now sits inside the channel's own row, under the name, in smaller text.
- **Renamed** every remaining "Syndo" in the code, text, packages (`@send/*`), events, storage keys and
  settings (`SEND_*`). Old names are still accepted (cookie, header, settings, saved themes, browser
  settings, desktop 0.6.x, `syndo://` links); see "Names from before the rename" in DEPLOYMENT.md.
- **GIFs** use Klipy by default (Tenor's API shut down on 30 June 2026). Turning on GIFs and paid boosts
  only needs keys: SETUP-GIFS-AND-PAYMENTS.md.
- **Tests:** new checks for the old names (server 80/80, web 32/32); the smoke test follows channel names
  kept as typed and the passkey button (18/18).

## 2026-11-11 — Message polish

- **Replies** show the author's small avatar and a connector line; the name no longer wraps onto two lines.
- **Hover toolbar** trimmed to quick reactions, reply, forward, thread, More (opens the full menu), edit and delete.
- **Bold** renders at a visibly heavier weight.
- **Quick switcher** (Ctrl+K) has no title bar, only the search box.
- **Profile card** dates read like "Nov 10, 2026".
- **Friends** empty states are centred.
- **Voice messages and audio files** have their own player instead of the browser's grey one: round play/pause button, a waveform that fills as it plays and can be dragged to seek, time, 1x/1.5x/2x speed, and a download button on audio files. Starting one clip pauses any other.
- **Tests:** browser suites skip the What's new and install prompts and follow the new phone header; interactions 41/41, keyboard 34/34, mobile 52/52.

## 2026-11-04 — Phone layout and Android app 0.3.0

### Changed (phones, ≤760px; also used by the Android app)
- **Two-screen navigation like Discord mobile.** The app opens on the channel list. Picking a channel opens the conversation with a peek of the list. ☰ or a swipe right returns to the list, and switching server keeps the list open.
- **Headers carry their own ☰ button**, replacing the floating "#" button that overlapped titles on every screen. Chat headers keep members and search; pins, mute and appearance moved into a ⋮ menu.
- **Long-press opens the same menus as right-click**, as bottom sheets with 48px rows. Emoji-only menus show as a big grid, and the desktop hover toolbar no longer appears over messages on touch.
- **Members, pins, search and conversation appearance open as full-screen pages** with close buttons. The member list no longer opens by default on phones (it used to cover the chat).
- **Settings:** a section list first, then each section full screen with "‹ All settings". Nothing runs off the edge, and the Keybinds section is hidden on touch-only devices.
- **Sheets:** the emoji picker, profile cards, dialogs and menus are solid bottom sheets with safe-area padding. 16px inputs stop focus zoom.
- **Voice channel:** the screen has a header and navigation before you join.
- The emoji picker renders at the document root, so a blurred parent can't offset it. While a message's reaction picker is open, that message's desktop toolbar stays visible.

### Android app 0.3.0
- **Full screen:** the native toolbar is gone and the app runs edge to edge with system-bar, cutout and keyboard insets.
- **Back button:** closes the topmost layer first, then returns to the channel list, then backgrounds the app.
- **Settings → About:** now has "Reload latest version", "Open in browser" and "Offline preview".
- **Other changes:** pickers filter by type; long-press vibrates briefly; the app is named "SEND"; the colours match SEND Glass.

### Verified
- New `e2e/mobile.cjs`: 52/52 (Pixel 7 and iPhone SE).
- interactions 41/41, keyboard 34/34, crop 16/16, smoke 18/18, appearance 26/26, web unit tests 21/21, server tests 49/49.
- The APK itself is built by the `SEND Android beta` GitHub workflow. This environment has no Android SDK, so the Java shell wasn't compiled locally.

## 2026-11-04 — Avatar/banner crop editor and bundle framing (batch 3)

### Added
- **Crop-to-size editor** for global and server profiles. It opens after choosing or dropping an image:
  - Avatars are square with a circular preview; banners use the profile card's 16:5 ratio.
  - Drag, scroll-wheel, pinch, keyboard (arrows / Shift / + − / 0), slider and reset.
  - Live previews at real display sizes.
  - Output is cropped and resized but never upscaled past the selected area.
  - The old image stays until "Apply" uploads successfully.
- **Animated GIFs stay animated.** Frames are decoded, cropped and re-encoded (new dependencies `gifuct-js`
  and `gifenc`), with automatic downsizing to stay under 10 MB. Animated WebP is converted the same way
  where WebCodecs is available. Otherwise the editor explains the limitation and offers to keep the
  animation uncropped or save a still; it never flattens silently.

### Changed
- `Modal` renders into `<body>`. Dialogs opened from inside other dialogs (like the crop editor in
  Settings) were being clipped and offset by their parent's backdrop blur. Stacked dialogs get a darker
  scrim.
- **Bundle catalogue framing.** All 174 cover artworks record their aspect ratio. After a visual review, 33
  portrait posters have a focal point so faces stay inside the profile-frame band. Avatar decorations
  place the artwork in a round badge on the decoration ring, so it no longer covers the person's face.

### Verified
- `e2e/crop.cjs`: 16/16 (twice). Everything else unchanged: interactions 41/41, keyboard 34/34,
  smoke 18/18, appearance 26/26, web unit tests 21/21, server tests 49/49.

## 2026-11-04 — Keyboard shortcuts and Keybinds (batch 2)

### Added
- **Central shortcut registry** (`web/src/shortcuts.ts`) with action IDs, scope rules (never inside
  text fields for plain keys, never during IME composition, paused while dialogs and menus are open
  except call controls) and per-account synced overrides (`settings.keybinds`).
- **Discord-style defaults**:
  - Ctrl/⌘+/ shows all shortcuts; Ctrl/⌘+K opens the quick switcher.
  - Ctrl+Alt+↑/↓ switches servers; Alt+↑/↓ switches channels; Alt+Shift+↑/↓ jumps between unread
    channels; Ctrl+Alt+Shift+↑/↓ jumps between channels with mentions.
  - Esc and Shift+Esc mark the channel and the server read; Alt+← and Ctrl+B return to the previous
    text channel.
  - Ctrl+P, Ctrl+U, Ctrl+F and Ctrl+E toggle pins, the member list, search and the emoji picker;
    Ctrl+Shift+U uploads a file.
  - Ctrl+Shift+M and Ctrl+Shift+D toggle mute and deafen; Ctrl+[ starts a call; Ctrl+Enter and Esc
    answer and decline a ringing call.
  - ↑ in an empty message box edits your last message, and typing anywhere starts a message.
- **Settings → Keybinds**:
  - Record shortcuts by pressing them, including Middle, Back and Forward mouse buttons with
    modifiers. Add, remove, disable, reset one, or restore all defaults.
  - Conflicts are explained, and saving moves the binding.
  - Warnings for browser-reserved and plain-key bindings.
  - Push-to-talk key and release delay, with a clear Global vs In-SEND label.
- **Settings → Advanced → Developer mode** adds Copy ID to context menus.
- **Composer emoji button.**

### Changed
- Server-icon keyboard reorder moved from Alt+↑/↓ to Ctrl/⌘+Shift+↑/↓. Clicking an icon leaves focus
  on it, and Alt+↑/↓ would otherwise reorder servers instead of switching channels.
- Push to talk is released when you leave the call, rebind the key while holding it, or switch out of
  PTT mode, as well as on window blur.
- Private Studio assets are served with `no-cache` and an ETag, so revalidation stays a cheap 304. A
  deleted or no-longer-shared wallpaper stops showing immediately instead of lingering in the browser
  cache for a day. This also fixes the intermittent "deleted wallpaper falls back" e2e failure.

### Verified
- `e2e/keyboard.cjs`: 34/34, three consecutive runs.
- `e2e/interactions.cjs`: 41/41. `e2e/smoke.cjs`: 18/18. `e2e/appearance.cjs`: 26/26 (twice).
- Web unit tests: 21/21. Server tests: 49/49, now with a revalidation and deletion test.

## 2026-11-04 — Interaction system (batch 1 of the Discord-parity work)

Restore point taken first: see [RESTORE.md](RESTORE.md).

### Added
- **Shared layer manager** (`web/src/layers.ts`). One stack for every dismissible surface:
  - Escape closes only the topmost layer, so a dropdown's Escape no longer also closes its dialog
    (previously SEND Studio's window-level Escape handler closed Studio first).
  - A press outside dismisses only the transient layers above where it landed, so portalled child
    menus keep their parent open. Pressing a popover's own toggle closes it instead of reopening it.
  - Focus returns to the opener without scrolling the chat.
- **Media viewer**. Clicking an image opens a full-screen viewer with gallery navigation across a
  message's images and videos (←/→, Home/End, thumbnail strip), download, open in browser and
  double-click zoom. Clicking the backdrop or pressing Escape closes it. Clicking the image or its
  controls doesn't. Chat scroll, draft and focus are restored. Encrypted DM attachments use the
  locally decrypted copy, and "Open in browser" is hidden for them.
- **Context menus** for messages, authors, members, servers, channels, categories and DMs:
  - Viewport clamping, submenus with a hover grace period, and keyboard navigation (arrows,
    Home/End, →/← into and out of submenus, typeahead, Escape).
  - Items follow the user's permissions; the server still authorises every action.
  - Copy-ID items appear only with `settings.developer_mode` (toggle coming with the Keybinds and
    Advanced settings batch).
- **Themed confirmations**. All `window.confirm`/`prompt` calls were replaced by themed dialogs
  (`askConfirm`, `askText`), which cover 25 call sites (deletes, kicks, bans, leaving, account
  deletion with a password field, masked-link warnings). Shift+click on Delete skips the
  confirmation, and Alt+click on a message marks it unread.
- **Themed tooltips**. They replace native `title` tooltips app-wide. They appear on hover or
  keyboard focus, and hide on pointer exit, press, scroll, Escape or window blur. Server-rail
  tooltips appear beside the icon.

### Changed
- `Modal`, the profile popout, the server menu, the status menu, the emoji picker, `Select`
  dropdowns, SEND Studio, the Studio asset picker, the pins popout, the search panel and per-user
  volume popovers all use the layer manager. Backdrop closes now require the press *and* release on
  the backdrop, so dragging a text selection out of a field doesn't close a dialog.
- The emoji picker positions itself next to the button that opened it, and stays inside the
  viewport.

### Fixed
- The server-rail hover/selected pill overlapped server icons. Each icon's draggable wrapper shrank
  to the icon's width, so the pill's `left: 0` landed on the icon.
- Test drift from the SEND rebrand: the e2e suites now dismiss the desktop-download prompt, drive the
  custom dropdown and use SEND names. They also account for Glass being the default theme and wait
  for the wallpaper fallback instead of a fixed delay.

### Verified
- `e2e/interactions.cjs`: 41/41 on two independent browser sessions.
- `e2e/smoke.cjs`: 18/18. `e2e/appearance.cjs`: 26/26.
- Web unit tests: 21/21. Server tests: 49/49 (unchanged in this batch).
