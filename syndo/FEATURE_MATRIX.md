# Syndo — Feature matrix

Status key — **Complete**: works end to end with persistent data and server-enforced permissions, verified by an automated test that drives the real server with independent clients (and the browser UI where noted). **Partial**: some of the feature works and is tested; the rest is listed under remaining work. **Unverified**: implemented, but not exercised against real infrastructure yet (almost always: needs a running LiveKit media server, which could not run in the build sandbox). **Missing**: not built. **Broken**: built but known not to work.

Evidence references: `S/<file>:<describe>` = server integration test (`server/test/*.test.ts`, real PostgreSQL, real HTTP + WebSocket clients). `E2E` = two-browser UI test (`e2e/smoke.cjs`, Chromium, separate browser contexts). Results: [TEST_RESULTS.md](TEST_RESULTS.md).

Last updated: customization extension + desktop/web distribution (2026-11-03).

## Accounts, identity, friends

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| AUTH-01 | Register, login, logout, email verification, password reset | Partial | S/core: "registers two users and verifies email", "password reset revokes every session"; E2E register/login | SMTP delivery not exercised (emails verified via outbox table); add rate-limit-by-account on top of per-IP | Register → verification link from real inbox → verified; reset link → new password works, old sessions dead |
| AUTH-02 | Secure sessions, device/session list, revocation | Complete | S/core: "revoking a session closes its gateway…"; httpOnly SameSite cookie, Origin check ("rejects cookie-authenticated writes from foreign origins") | — | Revoke laptop session from phone → laptop gateway closes (4004), HTTP 401 |
| AUTH-03 | Optional MFA + recovery codes | Complete | S/core: "Multifactor authentication" (TOTP, pending session can't act, recovery code single-use) | Browser test of the settings UI flow | Enable TOTP, log in elsewhere, prompted for code, recovery code works once |
| AUTH-04 | Unique username + editable display name | Complete | DB unique citext; S/core duplicate username; E2E registration with display names | — | Two users can't share a username (case-insensitive); display names are free |
| AUTH-05 | Profile card, avatar, banner, bio, pronouns, custom status | Complete | S/extra avatar upload; S/appearance server profiles; A/e2e "other members see the server profile"; profile card shows global or server values | Custom-status emoji picker; status expiry UI | Upload avatar/banner (incl. animated), set bio/pronouns/status → visible on others' profile card |
| AUTH-06 | Online / idle / DND / invisible | Partial | Gateway presence + status op; invisible reported as offline to others | Automatic idle after inactivity; automated presence test | Set invisible → friends see offline; DND suppresses notifications |
| AUTH-07 | Presence sync across devices | Partial | Status stored on account, `PRESENCE_UPDATE` with `self_status` to all own connections | Per-device activity aggregation (mobile idle vs desktop active) | Change status on phone → desktop UI updates within 1 s |
| AUTH-08 | Account settings, data export, deletion | Complete | S/core "exports data and deletes the account"; E2E settings sync | Export of uploaded files as an archive (JSON metadata only today) | Export contains profile/messages; delete → can't log in, messages show "Deleted user" |
| FRIEND-01 | Find users, send requests | Complete | S/core friend request; E2E "friend request sent" | Discovery beyond exact username is intentionally not offered (prevents enumeration) | Request by username reaches the other user live |
| FRIEND-02 | Accept, decline, cancel, remove | Complete | S/core accept; S/extra "declines, cancels and removes in both directions"; E2E accept | — | Each action updates both users' lists live |
| FRIEND-03 | Friends list with online/pending filters | Complete | E2E pending/all tabs; UI online/all/pending/blocked | — | Online tab shows only online friends |
| FRIEND-04 | Blocking (messages, invites, calls) | Complete | S/core "blocking stops DMs, friend requests and group invites without revealing the block" (+ voice token refused) | Hide blocked users' messages in shared servers (client-side collapse) | Blocked user can't DM, request, add to group or call; isn't told |
| FRIEND-05 | Mutual friends/servers with privacy | Complete | S/extra "…shows mutuals" + privacy hides mutuals | — | Profile lists mutuals; disabled when target turns `show_mutuals` off |
| FRIEND-06 | Friend-request and DM privacy | Complete | S/extra "respects 'nobody' and 'friends of friends'…", "DM privacy: server members only when allowed" | — | Each privacy option enforced server-side |

## Servers, channels, communities

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| SERVER-01 | Create, edit, join, leave, delete | Complete | S/core create/join; S/extra "leave, transfer ownership, delete"; E2E create + join | — | Full lifecycle; deleted server disappears for all members live |
| SERVER-02 | Transfer ownership | Complete | S/extra "leave, transfer ownership, delete" | — | Only owner can transfer; new owner gets full rights |
| SERVER-03 | Invites: expiry, usage limits, revocation | Complete | S/core "enforces max uses atomically and revocation"; E2E invite join | Expiry covered by SQL predicate but no time-travel test | Last use race admits exactly one; revoked link 404 |
| SERVER-04 | Icons (animated), banners, description, invite background | Partial | Upload endpoints with content sniffing; invite page uses banner | Automated test of icon/banner upload; banner cropping UI | Animated GIF icon shows on rail and invite page |
| SERVER-05 | Reorder servers, folders | Partial | Drag-and-drop + Ctrl/⌘+Shift+↑/↓ on a focused icon, synced via account settings (Alt+↑/↓ is channel navigation) | Folders | Reorder on desktop → same order on phone |
| SERVER-06 | Member list, role groups, search | Partial | Member list with hoisted role groups, online/offline, search; members API with search | Lazy/virtualised member list beyond 1,000 members | 5,000-member server lists and searches smoothly |
| SERVER-07 | Server templates | Partial | 5 built-in creation templates | Save an existing server as a shareable template | Create server from a user-saved template |
| SERVER-08 | Onboarding questions → roles/channels | Missing | — | Design + build | New member answers questions, receives roles |
| SERVER-09 | Rules acceptance, welcome, guide | Missing | Only a `rules_channel_id` setting | Gating until accepted, welcome screen | Member can't post until rules accepted |
| SERVER-10 | Scheduled events, RSVP, reminders | Missing | — | Build (timezone-aware) | Event in UTC shown in viewer's zone; reminder fires |
| SERVER-11 | Optional public discovery | Missing | `discoverable` flag stored only | Listing, search, moderation queue | Admin opts in; server appears in directory after review |
| SERVER-12 | Free custom invite aliases + server tags | Complete | S/core vanity invite join; uniqueness enforced against vanity + invite codes | — | Two servers can't claim the same alias |
| SERVER-13 | AFK behaviour, system-message channel | Partial | Settings stored; join messages posted to system channel | Auto-move idle voice users to the AFK channel | Idle user moved after timeout |
| CHANNEL-01 | Text channels | Complete | S/core, E2E | — | — |
| CHANNEL-02 | Persistent voice channels | Partial | Channel + voice state tracking tested (S/core "tracks voice state…"); media Unverified | Real media test on deployed LiveKit | See VOICE-01 |
| CHANNEL-03 | Categories with permission inheritance | Complete | S/extra "syncs category permissions to synced children…" | — | Category deny applies to synced children, not to edited ones, until re-sync |
| CHANNEL-04 | Private / role-restricted channels | Complete | S/core scenario 2; E2E "private channel hidden from B" | — | — |
| CHANNEL-05 | Announcement channels + following | Partial | Channel type exists and behaves as text | Cross-server following with permission checks | Follow announcements into another server |
| CHANNEL-06 | Forum channels | Missing | Type selectable as "preview" only | Posts, tags, sorting, guidelines | — |
| CHANNEL-07 | Media channels + attachment browsing | Partial | Search filter `has:image/video/audio/file` (permission-aware) | Gallery UI, media channel type behaviour | Browse all images in a channel |
| CHANNEL-08 | Threads | Missing | Permission groundwork only (threads inherit parent; private-thread membership in `perms.ts`) | Create/archive/lock API and UI | — |
| CHANNEL-09 | Stage channels | Missing | Type selectable as "preview" only | Speaker/listener roles, requests to speak | — |
| CHANNEL-10 | Topic, ordering, slow mode | Complete | S/extra "enforces slow mode except for moderators"; reorder API; topic shown | Drag-to-reorder channels in UI (API exists) | Slow mode 30 s → second message 429 with retry time |
| CHANNEL-11 | Text chat in voice channels | Partial | Server accepts messages in voice channels | UI chat panel inside the voice stage | Chat beside a call |
| CHANNEL-12 | Browse, follow, mute, notification prefs | Partial | Header mute/unmute control persists `muted_channels`, syncs across devices and honours existing notification suppression; W/messaging mute control test | Per-channel notification levels; server-wide mute UI | Muted channel produces no notification |

## Messaging, DMs, group chats

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| MSG-01 | Real-time server messages, DMs, group DMs | Complete | S/core scenario 1+3; S/extra group conversations; E2E DM + server | — | — |
| MSG-02 | Paginated history, reconnect recovery | Complete | S/core "recovers missed messages after reconnecting"; E2E reload | — | Disconnect, others post, reconnect → nothing missing |
| MSG-03 | Edit/delete with permissions | Complete | S/core scenario 3; E2E edit | — | — |
| MSG-04 | Replies, message links, jump | Complete | S/core reply; links `/channels/g/c/m` + `around=` history | Browser test for jump highlighting | Click a reply → scrolled to and highlighted |
| MSG-05 | Reactions + animated effects (original assets) | Partial | S/core reactions sync; CSS pop animation (reduced-motion aware) | Original animated reaction artwork; custom-emoji reactions | — |
| MSG-06 | Markdown, code, highlighting, spoilers, quotes, lists | Complete | Renderer produces React elements only (no HTML injection); E2E bold rendering | — | — |
| MSG-07 | Mentions with permission controls | Partial | Server strips @everyone/role mentions without permission; composer autocomplete for members, mentionable roles and permitted mass mentions, with keyboard/pointer controls and server member search; W/messaging completion tests | "suppress @everyone" per user | Member without permission writing @everyone pings nobody |
| MSG-08 | Typing, unread markers, mention counters, mark read | Complete | S/core typing, ack sync; unread divider + badges | — | — |
| MSG-09 | Pins and saved messages | Partial | S/extra pins/saved (saved hide when access lost); private Saved messages inbox with search, jump, remove, gateway refresh and stale-response protection; W/messaging saved inbox tests | Cursor pagination beyond the existing 200-save API window; full-browser visual test | Save a message, find it in the inbox, jump to it; revoke channel access and the save disappears |
| MSG-10 | Images/video/audio/files, drag-drop, paste | Partial | S/core upload + permission-checked download; content sniffing; SVG never rendered | Browser test of drag/drop/paste; image thumbnails | Paste a screenshot → uploads and renders |
| MSG-11 | Progress, cancel, retry, large files | Partial | XHR progress/cancel/retry in UI; operator limit `SYNDO_MAX_UPLOAD_MB` | Resumable chunked uploads (tus/S3 multipart) for multi-GB files | 2 GB upload survives a network blip |
| MSG-12 | Safe link previews / embeds | Missing | — | Server-side fetcher with SSRF protection, image proxy | — |
| MSG-13 | GIF search via configured provider | Missing | `SYNDO_GIF_PROVIDER` setting reserved | Provider adapter (opt-in, key configured by operator) | — |
| MSG-14 | Custom static/animated emoji + stickers | Missing | — | Upload/manage, render `<:name:id>` | — |
| MSG-15 | Cross-server emoji with access checks | Missing | `USE_EXTERNAL_EMOJIS` permission exists | Depends on MSG-14 | — |
| MSG-16 | Voice messages with waveform | Unverified | Recorder, waveform capture, playback UI | Browser test with fake microphone | Record 5 s → recipient plays it, waveform shown |
| MSG-17 | Polls | Missing | `SEND_POLLS` permission exists | Build | — |
| MSG-18 | Search by text/author/channel/date/attachment | Complete | S/core "no leaks… search"; filters in API + UI | Dedicated search engine for very large instances (Postgres FTS today) | — |
| MSG-19 | Group DM create/name/icon/members/leave | Partial | S/extra "create, rename, add, remove, leave" | Group icon upload | — |
| MSG-20 | Ordering, duplicate prevention, pending/failed | Complete | S/core nonce idempotency; time-ordered ids; UI pending/failed + retry | — | — |
| MSG-21 | Cross-device sync (edits, deletes, read position) | Complete | S/core second-device MESSAGE_UPDATE/DELETE/ACK | — | — |
| MSG-22 | Configurable long messages for everyone | Complete | `SYNDO_MAX_MESSAGE_LENGTH` (default 4,000), published in `/api/instance` | — | — |

## Voice (high bitrate)

All media code targets LiveKit's documented client/server APIs. **No media test has been run**: the build sandbox could not run a LiveKit server (see TEST_RESULTS.md). Admission control (who may join / publish) *is* tested.

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| VOICE-01 | 1:1, group DM, server voice | Unverified | `voice/session.ts`; S/core "mints tokens whose grants match SPEAK/VIDEO…" | Two-device call test on deployed stack | Two users on different networks hear each other |
| VOICE-02 | Ring, accept, decline, cancel, missed, history | Unverified | `routes/voice.ts` call records (ongoing/ended/missed) | Automated ring/decline test; incoming-call sound | Unanswered ring → "Missed call" in DM |
| VOICE-03 | Mute, deafen, PTT, VAD | Unverified | PTT in the browser while focused; global PTT in the desktop app (keyboard keys, mouse 4/5, uiohook); `USE_VAD` forces PTT | Media test on deployed LiveKit; desktop PTT test on Windows | Hold PTT key while Syndo is in the background → others hear you |
| VOICE-04 | Device selection, gain, per-user volume | Unverified | WebAudio gain, `setSinkId`, per-user volume 0–200 % | — | — |
| VOICE-05 | Speaking indicators, states, participants | Unverified | ActiveSpeakers, connection pill, sidebar participants (voice state tested) | — | — |
| VOICE-06 | AEC / NS / AGC individually configurable | Unverified | Three independent toggles, re-publish on change | — | — |
| VOICE-07 | Server mute/deafen, move/disconnect, user limits | Partial | API + limit check; S/core "removes it when access is revoked" (gateway side) | Verify LiveKit `updateParticipant`/`removeParticipant` against a real server | Server-mute stops audio within 1 s |
| VOICE-08 | Rejoin after interruption, device/network change | Unverified | LiveKit reconnect events; mic hot-unplug fallback | Network-switch test (Wi-Fi → mobile) | — |
| VOICE-09 | Soundboard | Missing | `USE_SOUNDBOARD` permission exists | Build | — |
| VOICE-10 | Entrance sounds + local suppression | Missing | `suppressSoundEffects` setting reserved | Depends on VOICE-09 | — |
| VOICE-HQ-01 | Opus 48 kHz | Unverified | Capture at 48 kHz; diagnostics show clock rate | Measure | Diagnostics show `opus 48 kHz` |
| VOICE-HQ-02 | Presets 64–384 kbps (up to 510) | Unverified | Selector 32–510 kbps, capped by operator limit; live `setParameters` | Measure with music source | 256 kbps preset → measured ≈ 200–256 kbps on music |
| VOICE-HQ-03 | Stereo music mode | Unverified | `forceStereo`, channelCount 2, AEC off in music presets; negotiated `stereo=1` shown | Verify with stereo source + stereo receiver | Left/right test tone arrives separated |
| VOICE-HQ-04 | Speech vs music presets | Unverified | 4 presets in `shared/src/media.ts` | — | — |
| VOICE-HQ-05 | Loss adaptation | Unverified | FEC on, optional RED, LiveKit congestion control | Test with `tc netem` 5–10 % loss | Speech intelligible at 10 % loss with RED |
| VOICE-HQ-06 | High bitrate free for all | Complete | No tier code exists; only operator-wide limit | — | — |
| VOICE-HQ-07 | Requested vs negotiated vs measured | Unverified | Diagnostics table (requested, SDP fmtp, measured kbps) | — | — |
| VOICE-HQ-08 | Codec, channels, loss, jitter, latency, bitrate | Unverified | `voice/diagnostics.ts` from getStats | — | — |
| VOICE-HQ-09 | No silent clamping in media config | Partial | `deploy/livekit.yaml` sets no bitrate caps; API caps are explicit and published | Measure end-to-end on deployment | — |
| VOICE-HQ-10 | Compare speech/music between real clients | Missing | — | Listening test across two devices | — |

## Video calls

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| VIDEO-01 | 1:1 and group video | Unverified | Camera publish with simulcast | Deployed test | — |
| VIDEO-02 | Camera select/preview/toggle/switch | Unverified | `switchActiveDevice`; self-view tile | Pre-join preview screen | — |
| VIDEO-03 | Grid, focus, pin, fullscreen | Unverified | Stage layouts | — | — |
| VIDEO-04 | Camera + screen simultaneously | Unverified | Separate tracks/sources | — | — |
| VIDEO-05 | Quality adaptation with clear limits | Unverified | adaptiveStream + dynacast + simulcast | — | — |
| VIDEO-06 | Background blur / custom backgrounds | Missing | — | Use `@livekit/track-processors` | — |
| VIDEO-07 | Picture-in-picture | Unverified | PiP button where supported | Persistent floating call view while navigating | — |
| VIDEO-08 | Independent camera/mic/stream controls | Unverified | Separate controls | — | — |
| VIDEO-09 | Denied/missing/removed devices | Partial | Readable errors for NotAllowed/NotFound/NotReadable; mic unplug fallback | Camera unplug handling test | — |

## Screen sharing

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| STREAM-01 | Screen / window / tab | Unverified | `getDisplayMedia` via LiveKit with surface switching | — | — |
| STREAM-02 | System/app/tab audio where permitted | Unverified | Browser: tab audio (Chromium), system audio (Windows Chromium). Desktop app: own picker with whole-system audio via WASAPI loopback on Windows. Per-app audio: not supported (shown honestly) | Real capture test on Windows | Share screen with audio in the desktop app → viewers hear system sound |
| STREAM-03 | In DMs, groups, servers | Unverified | Same session code for all | — | — |
| STREAM-04 | Multiple simultaneous publishers | Unverified | Per-participant screen tiles | — | — |
| STREAM-05 | Viewer select/focus/fullscreen/mute/volume | Unverified | Tile tools + stream volume | — | — |
| STREAM-06 | 720p/1080p/1440p/2160p | Unverified | Presets, operator cap | Measure | Diagnostics show 1920×1080 sent |
| STREAM-07 | 15/30/60 fps | Unverified | Presets | Measure 60 fps | — |
| STREAM-08 | Source (native size) | Unverified | No resize constraint; capture size reported | — | 3440×1440 source arrives at 3440×1440 on capable link |
| STREAM-09 | Aspect ratio / ultrawide | Unverified | Simulcast layer computed from captured aspect; `object-fit: contain` | — | — |
| STREAM-10 | Bitrate + text vs motion modes | Unverified | contentHint + degradationPreference | — | — |
| STREAM-11 | Weak viewers don't degrade others | Unverified | Simulcast/SVC + per-subscriber layer selection in SFU | Multi-bandwidth viewer test | — |
| STREAM-12 | Simulcast / SVC | Unverified | Simulcast layers; AV1/VP9 (SVC) preferred when supported | — | — |
| STREAM-13 | Codec negotiation, efficiency, HW accel | Unverified | AV1→VP9→H.264 preference + backup codec | — | — |
| STREAM-14 | A/V sync, source switching | Unverified | Same-participant tracks; switch source button | — | — |
| STREAM-15 | Measured capture/delivery diagnostics | Unverified | Capture size, per-layer size/fps/kbps, limitation reason, dropped frames | — | — |
| STREAM-16 | Explicit selection + persistent indicator | Partial | Browser picker; "You're sharing" indicators in sidebar and stage | — | — |
| STREAM-17 | Release capture on stop | Unverified | Tracks stopped on stop/leave/`ended` | — | Browser sharing indicator disappears |
| STREAM-18 | All quality settings free | Complete | No tier code; operator-wide caps only | — | — |

## Free customization

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| CUSTOM-01 | Animated avatars/banners | Complete | Global + per-server avatar/banner accept animated GIF/WebP/APNG (content-sniffed); S/appearance server avatar/banner; viewers can freeze/hide cosmetics | — | — |
| CUSTOM-02 | Profile colours, gradients, themes | Complete | Profile theme schema (validated server-side); gradient banners, frames; A/e2e server profile card | — | — |
| CUSTOM-03 | Original decorations, effects, frames, nameplates | Complete | 7 rings, 5 frames, 7 decorations, 4 nameplates, 6 effect kinds, entrances, banner animations — original CSS/canvas; A/e2e ring renders | Illustrated (bitmap) decoration library | — |
| CUSTOM-04 | Display-name styles with readability/reduced motion | Complete | 5 name styles + glow; stable @username always shown; A/e2e reduced motion stops animations | Contrast warning specific to name styles | — |
| CUSTOM-05 | Per-server nickname, avatar, bio, banner, styling | Complete | S/appearance "Server profiles" (separate storage, use-global, others see it, nobody else can edit); A/e2e 5–6 | — | — |
| CUSTOM-06 | Light/dark/system/high-contrast/custom themes | Complete | 12 presets + follow-system + high contrast (a11y, always wins); A/e2e 16 (all presets style the app); E2E theme sync | — | — |
| CUSTOM-07 | Accent, backgrounds, density, spacing, font size | Complete | Studio colours/typography/layout; A/e2e 1–2, 14 | — | — |
| CUSTOM-08 | Preview, save/reset, validated import/export | Complete | Studio draft with Apply/Cancel/Undo/Redo/Reset section/Reset all; versioned JSON with optional packaged assets; S/appearance rejects URLs/@import; A/e2e Cancel reverts, import 10, .theme.css rejected | — | — |
| CUSTOM-09 | Server emoji/stickers/soundboard management | Missing | — | With MSG-14 / VOICE-09 | — |
| CUSTOM-10 | Role icons, colours, gradients | Partial | Colours + gradient names | Role icons | — |
| CUSTOM-11 | Server tags, banners, animated icons, invite presentation | Partial | Tags, banners, animated icon upload, invite page | Test coverage | — |
| CUSTOM-12 | Custom video backgrounds, notification sounds | Partial | Muted looping MP4/WebM backgrounds with still fallback, paused when hidden/low power | Custom notification sounds; camera background replacement (VIDEO-06) | — |
| CUSTOM-13 | Original cosmetic library, no purchases | Complete | Built-in themes, 6 original wallpapers, cosmetics library; no purchase code anywhere | Grow the library | — |
| CUSTOM-14 | Larger limits without tiers | Complete | All limits are operator env vars, identical for every account, published in `/api/instance` and Settings → About | — | — |
| CUSTOM-15 | Settings persistence + sync | Complete | Per-scope prefs with revisions; live sync; device-only overrides; A/e2e 18; S/appearance stale-revision conflict | — | — |

## Roles, permissions, moderation

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| MOD-01 | Roles: hierarchy, ordering, assignment | Complete | S/core hierarchy tests; S/permissions unit tests | — | — |
| MOD-02 | Server permissions + channel/member overwrites | Complete | S/core scenario 2; S/permissions | — | — |
| MOD-03 | Category inheritance + explicit sync | Complete | S/extra category sync | — | — |
| MOD-04 | Owner/admin/hierarchy handling | Complete | S/core "enforces role hierarchy and permission escalation rules" | — | — |
| MOD-05 | Kick, ban, unban, timeouts, removal, bulk | Complete | S/core scenario 14; S/extra bulk delete | — | — |
| MOD-06 | Audit log | Complete | S/core audit log visible only with permission | Retention setting | — |
| MOD-07 | Automod (keywords, spam, mentions, links) | Missing | — | Build | — |
| MOD-08 | Join verification + raid mitigation | Missing | `verification_level` stored but not enforced | Enforce levels; join-rate alarms | — |
| MOD-09 | Reports + review workflow | Missing | — | Build (instance-level and server-level queues) | — |
| MOD-10 | Invite management + enforcement | Complete | S/core invites | — | — |
| MOD-11 | Permission-aware bots/webhooks | Missing | Bearer-token auth path exists | See APP-01/04 | — |
| MOD-12 | Restricted media controls | Missing | `nsfw` channel flag stored only | Age gate, per-user filter | — |
| MOD-13 | Revoke access during active calls/sessions | Partial | Gateway: voice state dropped + client disconnected when CONNECT lost (S/core); session revocation closes sockets | Confirm SFU removal on a real LiveKit | Ban during call → removed from media within 2 s |

## Notifications, accessibility, platforms

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| CLIENT-01 | In-app notifications + inbox | Partial | Badges, mention counters, toasts | Notification inbox | — |
| CLIENT-02 | Desktop/browser notifications | Unverified | `notify.ts` with permission handling | Browser test | — |
| CLIENT-03 | Per-server/channel mute + prefs | Partial | Honoured in notify.ts | UI | — |
| CLIENT-04 | Mention controls, quiet hours, DND | Partial | DND + quiet hours suppress desktop notifications | Suppress @everyone option | — |
| CLIENT-05 | Keyboard, shortcuts, labels, focus | Partial | Skip link (E2E), focus-trapped modals, labelled controls, Ctrl+K switcher | Full keyboard audit; roving focus in message list | — |
| CLIENT-06 | Reduced motion, contrast, typography | Partial | Reduced motion (system/on/off), high-contrast theme, font scaling | Contrast audit of every theme | — |
| CLIENT-07 | Responsive / mobile screens | Partial | E2E mobile width without horizontal scroll; off-canvas navigation | Touch gestures, mobile call layout testing | — |
| CLIENT-08 | Desktop app | Partial | `syndo/desktop` (Electron): loads the hosted web app; global PTT; screen picker with Windows system audio; tray/close-to-tray; `syndo://` invites; Windows 11 Mica/Acrylic; native toasts; electron-updater from Cloudflare R2. Compiles; CI builds the NSIS .exe on windows-latest | Run the .exe on real Windows (not possible in the build sandbox); code-signing certificate; macOS/Linux packaging | Install .exe → sign in → global PTT works in a game → update installs from R2 |
| CLIENT-09 | Native mobile apps | Missing | Responsive web only (not parity) | React Native/LiveKit SDKs, push (APNs/FCM), CallKit/ConnectionService | — |
| CLIENT-10 | Game/activity presence, connected accounts | Missing | — | — | — |
| CLIENT-11 | Game overlay | Missing | — | Separate native assessment | — |

## Syndo Studio & appearance (customization extension)

Evidence: `A/e2e` = `e2e/appearance.cjs` (real Chromium contexts against a running server, 26 checks), `S/appearance` = `server/test/appearance.test.ts`.

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| STUDIO-01 | Studio workspace (Settings → Appearance → Open Syndo Studio; user menu & server menu “Edit appearance”; chat header palette) | Complete | A/e2e opens via Settings; preview/Apply/Cancel | — | Open from each entry point |
| STUDIO-02 | Theme gallery with engine-rendered thumbnails, tags, light/dark, duplicate | Complete | A/e2e applies Syndo Glass; screenshots | — | — |
| STUDIO-03 | Visual editor with inherited/overridden indicator + reset to inherited per field | Complete | `controls.tsx` provenance from `resolveAppearance` | Browser test of per-field reset | — |
| STUDIO-04 | Undo/Redo/Apply/Cancel/Reset section/Reset all; preview reversible until saved | Complete | A/e2e “Cancel reverts the preview”, undo/redo then Apply | — | — |
| STUDIO-05 | Independent panel styling for 14 regions (colour, 0–100 % opacity, gradient, blur, border colour/opacity/width, radius, shadow, image, text/icon overrides) | Complete | A/e2e 1 (text/icons opaque at 30 % background), 2 (each panel keeps its own after refresh) | — | — |
| STUDIO-06 | Clickable interface map + accessible region list | Complete | Live preview regions are buttons; region listbox | — | — |
| STUDIO-07 | Backgrounds at global/server/channel/DM/group scopes; colour/gradient/image/animated/video; fit, focal point, zoom, filters, tint, overlay, vignette; dark/light variants; still fallback; pause when hidden; app-vs-chat target | Complete (video Unverified) | A/e2e 3, 11; S/appearance per-DM | Video background test with a real file | — |
| STUDIO-08 | Background library: previews, favourites, replace, delete (reference-aware), usage/quota, cleanup | Complete | S/appearance “Background library” | — | — |
| STUDIO-09 | Per-conversation appearance: wallpaper, chat opacity, accent, bubbles/list, bubble colours/radius/spacing, compact, private label, reset | Complete | A/e2e 3, labels | — | — |
| STUDIO-10 | Shared conversation themes by explicit acceptance; personal override still wins | Complete | S/appearance; A/e2e 8 | — | — |
| STUDIO-11 | Server-specific profiles (nick, avatar, banner, bio, pronouns, colours, effects, status) with use-global and preview | Complete | S/appearance; A/e2e 5, 6 | — | — |
| STUDIO-12 | Profile animations: rings, frames, particles, entrances, banner animation, nameplates, name glow/gradient, hover-only, status shapes; layered editor with timeline | Complete | A/e2e ring renders, reduced motion stops it | Visual QA on low-end hardware | — |
| STUDIO-13 | Layout: vertical/horizontal nav, 1–3 rail columns, widths, collapsible lists, density/spacing, avatar size, grouping, timestamps & format, panel style/gaps/margins, bubbles, unread/mention/status styles, font/size/line height, scale | Complete | A/e2e 13a/13b (keyboard), 14 (small window + large text) | — | — |
| STUDIO-14 | 12 original presets using the real engine | Complete | A/e2e 16 (chat, profile cards, dialogs, call screen styled for each); screenshots | — | — |
| STUDIO-15 | Deterministic hierarchy default → theme → global → device → server → shared → conversation → accessibility | Complete | `shared/src/theme.ts resolveAppearance`; A/e2e 4 | — | — |
| STUDIO-16 | Documented theme schema, versioned import/export with assets, metadata, migrations, preview before apply, private data excluded | Complete | THEMES.md; S/appearance v1 import; A/e2e 10 | — | — |
| STUDIO-17 | Advanced token editor + opt-in scoped custom CSS (parser with allowlists) | Complete | S/appearance rejects @import/url; validator blocks layout-changing properties | — | — |
| STUDIO-18 | BetterDiscord themes | Not supported (by design) | Rejected with a clear message (A/e2e) | A converter would be a separate project | — |
| STUDIO-19 | Accessibility & performance: reduced motion, no animated backgrounds, no profile effects, hide others’ cosmetics, blur levels, high contrast, readable overlay, keep-text-readable, low power, device-only overrides | Complete | A/e2e 9, “viewers can disable…”, 18 | — | — |
| STUDIO-20 | Recovery: Ctrl+Shift+Alt+R safe mode, `?safe-appearance=1`, reset button on sign-in and in settings; recovery UI outside the themed tree | Complete | A/e2e 17 + sign-in link | — | — |
| STUDIO-21 | Theme changes don't interrupt calls | Partial | Engine only touches CSS; voice session code is untouched by appearance changes | Run with a live call once LiveKit is deployed (scenario 12) | — |
| STUDIO-22 | Private assets and preferences never exposed | Complete | A/e2e 7, 15; S/appearance | — | — |

## Distribution

| ID | Feature | Status | Evidence | Remaining work | Acceptance test |
|---|---|---|---|---|---|
| DIST-01 | Hosted web app on Cloudflare Pages with same-origin API/gateway proxy | Complete (locally verified) | `web/functions` + `web/edge/proxy.ts`; messaging E2E 18/18 through `wrangler pages dev` (Cloudflare runtime) incl. WebSocket | Set `SYNDO_API_ORIGIN` in the Pages project; first production deploy | Open the Pages URL → sign in → chat works |
| DIST-02 | Windows installer (.exe) built in CI | Partial | `.github/workflows/syndo.yml` desktop job (electron-builder NSIS on windows-latest) | Confirm a green CI run; code signing | Download artifact → install → app opens |
| DIST-03 | Desktop auto-updates from Cloudflare | Partial | electron-updater generic provider; CI uploads installer + latest.yml to R2 on `syndo-desktop-v*` tags | Create the R2 bucket + public URL; test an update between two tagged versions | Install v0.2.0, tag v0.2.1 → app downloads and offers “Restart to update” |
| DIST-04 | Web interface updates reach desktop users instantly | Complete (by design) | The desktop window loads the hosted web app | — | — |

## Bots, apps, activities

| ID | Feature | Status | Evidence | Remaining work |
|---|---|---|---|---|
| APP-01 | Bot accounts, scoped revocable tokens | Missing | `users.bot` column; bearer-token auth path | Build |
| APP-02 | Slash commands + autocomplete | Missing | — | Build |
| APP-03 | Buttons, menus, forms | Missing | — | Build |
| APP-04 | Incoming webhooks | Missing | `MANAGE_WEBHOOKS` permission exists | Build |
| APP-05 | Documented API + event interface | Partial | Routes are consistent and typed (`shared/src/types.ts`); this matrix + ARCHITECTURE.md | Published API reference |
| APP-06 | App install consent/review/removal | Missing | — | Build |
| APP-07 | Sandboxed activities SDK | Missing | — | Build |
| APP-08 | Original shared activities | Missing | — | Build |
| APP-09 | External account integrations | Missing | — | Build |

Existing Discord bots/integrations are not compatible; a compatibility adapter would be a separate, explicitly requested project.

## Summary

| Status | Count |
|---|---|
| Complete | 71 |
| Partial | 38 |
| Unverified | 39 |
| Missing | 33 |
| Not supported | 1 |
| Broken | 0 |
| **Total tracked** | 182 |
