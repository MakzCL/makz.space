# SEND changelog

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
