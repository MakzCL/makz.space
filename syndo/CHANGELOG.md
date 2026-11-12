# SEND changelog

## 2026-11-12 — Rearrange call tiles, pop-out calls, mute by click, ringing stops

- **Drag call tiles to rearrange them**, like apps on a phone's home screen: pick one up and the others slide
  out of the way (FLIP animation) as the order changes live; let go and it settles into the gap. Saved per call on
  this device. Mouse/pen; touch keeps scrolling.
- **Pop out a call** into its own window (header button): tiles, screen shares, mic/deafen/camera/share, leave and
  "bring back". The main window shows that the call is popped out. Desktop 0.7.0 allows this window (it used to
  send every new window to the browser).
- **Click the speaker on a tile to mute/unmute** that person or stream for you (your volume comes back); hover or
  right-click it for the slider.
- **Ringing stops:** at most 30 s per call, the caller's tone stops as soon as someone joins, and a call that rang
  out doesn't start ringing again on later updates (group calls rang until everyone answered).

## 2026-11-12 — Discord-feel sounds, no sharing banner

- **Sounds reworked** in the spirit of Discord's: short tuned "mallet"/bell notes with soft overtones (no more
  sliding tones), little melodies up for join/unmute and down for leave/mute, a gentle compressor, and 100% now
  sits at about Discord's level. New default: 100%. All synthesised; the melodies are SEND's own.
- **Removed the red "You are sharing your screen" bar** above the call (the green share button and LIVE badge
  already show it).

## 2026-11-12 — Desktop 0.7.0: SEND's own screen sharing

- **The desktop app shares screens without the system picker.** The Go Live dialog lists your windows and screens
  with live thumbnails (refreshed every 3 s); Go Live streams the one you pick. Video: GDI capture (`BitBlt` for
  screens, `PrintWindow` with full-content rendering for windows, mouse pointer drawn in), scaled and JPEG-encoded
  in Rust, sent over a Tauri channel and turned into a video track with WebCodecs + `MediaStreamTrackGenerator`.
  At most two frames wait for the page, so a slow page drops frames instead of lagging.
- **Sound like Discord:** sharing a window sends only that app's sound; sharing a screen sends everything except
  SEND's own (Windows per-process loopback capture, Windows 10 2004+), so the call never echoes.
- The browser version is unchanged (system picker). Desktop 0.6.x keeps working with the old picker.
- Known limits: games in exclusive full-screen and some protected windows may capture black (window capture uses
  `PrintWindow`); minimised windows aren't listed.

## 2026-11-12 — Voice channel sidebar like Discord

- People in a voice channel use Discord's sizing: 24px avatars, 32px rows, indented under the channel.
- **Invite to Voice** row under the people in the channel you're in (opens the invite dialog for that channel).
- **Call timer** on the voice channel row, counting from the earliest person still in the call (voice states now
  carry `joined_at`).

## 2026-11-12 — Statuses under names

- **Custom statuses show under people's names in the member list**, small, like a voice channel's status (a
  server-profile status wins over the global one). They arrive with presence (READY `custom_statuses`, and
  `custom_status` on PRESENCE_UPDATE) and update live; offline people show none.

## 2026-11-12 — Emotes in the message box, jump to present

- **Emotes show as pictures while you type** (custom emoji and 7TV/BTTV): the box holds `:name:` with the picture
  drawn over it, Backspace removes a whole emote, and the codes are restored on send and in saved drafts.
- **"Jump to present" goes away near the newest message.** It no longer sticks when the channel's last message was
  deleted, and after jumping to an old message, scrolling down loads the newer ones.

## 2026-11-12 — Go Live dialog

- **Screen share dialog** like Discord's: tabs **Applications** (window, or a browser tab in the browser),
  **Entire Screen** and **Devices**, plus resolution, frame rate, "optimise for" and share-audio controls, then
  **Go Live**. Applications/Entire Screen open the system picker on that tab (`displaySurface` hint); a web page
  and WebView2 can't list windows or show their thumbnails themselves, so the system picker still does that.
- **Devices** lists cameras and capture cards with live previews and streams the chosen one as the screen share
  (mesh, Cloudflare and LiveKit paths), with the card's own audio input when it has one in the same device group.
- "Switch shared window" reopens the same kind of source.

## 2026-11-12 — Motion, voice messages, centred +

- **Voice message recording:** the message box becomes a recording bar — bin (cancel, also Esc), pulsing dot and
  timer, live waveform scaled to your voice, and a send button that sends straight away (no confirm dialog).
- **Sent voice messages** always use the SEND player in an accent-tinted pill with a waveform. Voice notes the
  server had stored as `video/webm` (WebM sniffs as video) are shown as voice notes too; the server now keeps
  them as audio (live since backend deploy `84d905e8`).
- **Motion** (all off with reduced motion): icons lift on hover and squish on press, message-box icons have their
  own wiggle/hop, the server rail morphs with a spring, menus/pickers/popovers/dialogs fade and scale in, badges and
  call tiles pop in, people joining a voice channel slide in, reactions lift.
- **The (+) in the message box** is centred in its circle (its 22px icon overflowed a 20px box).
- Fixed a reduced-motion rule that used the wrong value and never applied.

## 2026-11-11 — Desktop 0.6.4

- **Updates install again:** in 0.6.2 and 0.6.3 the green update button froze on the "Updating SEND" window.
  The update and change-server commands now run off the main thread. People on 0.6.2/0.6.3 are sent to the
  installer from the website instead (it updates SEND in place); from 0.6.4 on, updates install from the app.

## 2026-11-11 — Calls fit the window, update prompt, instant messages, desktop 0.6.3

- **Call grid:** picks the number of columns that gives the largest 16:9 tiles for the space — stacked in a
  tall window, side by side in a wide one — with a short last row centred.
- **Focused tile:** takes the video's own shape (no black bars around screen shares); the members strip and
  its toggle sit directly under it as one centred group.
- **No "Sending…":** your message shows at full strength the moment you send it; only a failure is marked.
- **Every web deploy is an update:** builds carry an id (meta tag + `/version.json`). The app checks every 5
  minutes and when you return to it; a new build shows the green update button in the desktop title bar, or
  an "Update" bar in the browser and Android app. Clicking reloads. A removed old file reloads by itself.
- **SEND stays out of your screen share:** desktop 0.6.3 (Windows) excludes its own window from screen
  capture while you share. Browsers no longer offer the SEND tab itself in the share picker.

## 2026-11-11 — GIF search through GIPHY

- **GIPHY** is a supported GIF provider (`SEND_GIF_PROVIDER=giphy`). Results are cached and shared by
  everyone (trending 30 min, searches 6 h) with an hourly cap of 90 upstream calls, so a 100-calls-an-hour
  beta key holds up; near the cap, cached results or a "try again in a few minutes" note are shown.
- The picker credits "Powered by GIPHY" and waits a little longer while you type before searching.

## 2026-11-11 — Discord-style call tiles

- **Click to focus:** clicking a tile makes it the big one; clicking the big one returns to the grid.
  Enter or Space does the same from the keyboard.
- **Watch Stream:** someone else's screen share starts as a blurred preview with a LIVE badge and a
  "Watch Stream" button. Its sound stays off until you watch. Watching focuses it; "Stop watching"
  (tile button or right-click) returns it to a preview. A stream that ends has to be watched again.
- **Members strip:** under a big tile, a small toggle hides or shows everyone else.
- **Names** appear on hover over video; mute icons and LIVE badges stay visible.

## 2026-11-11 — Camera and screen together, no call echo in screen shares

- **Camera + screen at once** in direct (peer-to-peer) calls: each connection now has a separate video
  slot for the screen, so turning on one no longer replaces the other. People on an older cached version
  still get the old layout (the screen while sharing, else the camera) until they reload.
- **Screen shares leave SEND's own sound out** (`restrictOwnAudio`), so people watching don't hear the
  call echoed back through your shared screen or window. Works in Chrome, Edge and the desktop app on
  Windows and macOS; where the browser can't do it, SEND says so and suggests sharing a tab instead.

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
