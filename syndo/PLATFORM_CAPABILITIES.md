# Syndo — Platform capability matrix

What each client platform can actually do. These come from browser/OS capture APIs, not from Syndo choices. Rows marked **(untested)** are based on documented browser behaviour and Syndo's implementation, but have **not** been measured on that platform yet — see TEST_RESULTS.md. The in-app Settings → Voice & video shows a live version of this table for the current browser.

## Web clients

| Capability | Chrome / Edge (Windows) | Chrome / Edge (macOS) | Chrome / Chromium (Linux) | Firefox (desktop) | Safari (macOS) | Mobile browsers (iOS/Android) |
|---|---|---|---|---|---|---|
| Text, DMs, servers, settings | Yes (E2E-tested in headless Chromium/Linux) | Yes (untested) | Yes (tested) | Yes (untested) | Yes (untested) | Yes, responsive layout (390 px tested) |
| Voice (Opus 48 kHz) | Yes (untested) | Yes (untested) | Yes (untested) | Yes (untested) | Yes (untested) | Yes, foreground only (untested) |
| Stereo send | Yes, with AEC off (untested) | Yes (untested) | Yes (untested) | Yes (untested) | Partial — verify | Device-dependent |
| Opus bitrate up to 510 kbps | Encoder accepts; measure | Same | Same | Same | Same | Same |
| Choose speaker (`setSinkId`) | Yes | Yes | Yes | Yes (recent versions) | Recent versions only | No |
| Camera | Yes | Yes | Yes | Yes | Yes | Yes |
| Screen: entire display | Yes | Yes (needs OS screen-recording permission) | Yes (X11/PipeWire) | Yes | Yes | **No** |
| Screen: single window | Yes | Yes | Yes | Yes | Yes | No |
| Screen: browser tab | Yes | Yes | Yes | No | No | No |
| Tab audio | Yes | Yes | Yes | No | No | No |
| Whole-system audio | Yes | **No** (macOS doesn't expose it to browsers) | Depends on PipeWire/browser version | No | No | No |
| Single-app window audio | No (needs desktop app) | No | No | No | No | No |
| AV1 encode | Recent versions (often software) | Recent versions | Recent versions | Decode mainly | Recent hardware | Varies |
| VP9 / H.264 | Yes / Yes | Yes / Yes | Yes / Yes | Yes / Yes | Yes / Yes | Varies |
| 1080p60 screen share | Hardware-dependent | Hardware-dependent | Hardware-dependent | Hardware-dependent | Hardware-dependent | n/a |
| 1440p / 2160p screen share | Possible on strong CPU/GPU + uplink | Same | Same | Same | Same | n/a |
| "Source" native size | Yes (no resize constraint) | Yes | Yes | Yes | Yes | n/a |
| Push-to-talk | While window focused | While focused | While focused | While focused | While focused | No |
| Global push-to-talk | Needs desktop app | Needs desktop app | Needs desktop app | — | — | — |
| Desktop notifications | Yes | Yes | Yes | Yes | Yes | iOS: installed PWA only |
| Picture-in-picture | Yes | Yes | Yes | Partial | Yes | Varies |
| Background calls | Tab must stay open | Same | Same | Same | Same | Suspended in background |

## Quality honesty rules (enforced in the UI)

- Resolution/frame-rate/bitrate controls are **targets**. The browser may capture smaller, the encoder may drop resolution or frames (`qualityLimitationReason`), congestion control lowers bitrate, and viewers may receive a lower simulcast layer. Diagnostics show requested vs. captured vs. sent vs. received.
- **Source** means "don't resize the capture", not lossless. Very large sources (e.g. 5120×1440) are limited by the encoder, uplink and viewers' decoders.
- Opus is variable-rate: a 320 kbps target with speech or silence can measure far lower. DTX makes silence nearly free. Stereo only survives end to end if capture is stereo, echo cancellation is off, the SDP negotiates `stereo=1`, and the listener's output is stereo.
- Unsupported capture-audio modes are labelled "not supported in this browser" in the share menu and settings, and a share that comes back without audio produces an explanatory notice.

## Syndo desktop app (Windows)

| Capability | Status |
|---|---|
| Everything in the web app | Yes — the window loads the hosted web app |
| Global push-to-talk (keys, mouse 4/5) | Implemented (uiohook); not yet tested on Windows hardware |
| Screen share with whole-system audio | Implemented (WASAPI loopback via Electron); not yet tested on Windows hardware |
| Single-application audio | No |
| Window transparency to the desktop | Windows 11 22H2+ only (Mica/Acrylic); in-app panel transparency works everywhere |
| Tray, close-to-tray, native notifications, taskbar flash, `syndo://` links | Implemented |
| Auto-update | electron-updater from a Cloudflare R2 feed |

## Native clients (not built)

| Platform | Status | Why it matters |
|---|---|---|
| iOS app | Missing — CLIENT-09 | Push notifications (APNs), CallKit, background audio, screen broadcast via ReplayKit extension |
| Android app | Missing — CLIENT-09 | FCM push, ConnectionService, foreground service for calls, MediaProjection screen share |

A responsive website is not native mobile parity; these are tracked deliverables.
