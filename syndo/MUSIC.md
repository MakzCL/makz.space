# SEND Music

A music bot for voice rooms. Join a voice room, type `!play <song name or link>` in any text chat of that server,
and everyone in the room hears it. The next request goes into the room's queue.

## Commands

| Command | Short | What it does |
| --- | --- | --- |
| `!play <name or link>` | `!p` | Plays straight away if nothing is playing, otherwise adds it to the queue and says its position |
| `!queue` | `!q` | The current track and what's next, with who asked for each |
| `!nowplaying` | `!np` | Title, artist, requester and a progress bar |
| `!pause` / `!resume` | | Pause and carry on, for everyone in the room |
| `!skip` | `!s` | Next track. Skipping someone else's track needs DJ rights when others are listening |
| `!stop` | `!leave` | Clears the queue and disconnects the bot. Needs DJ rights when others are listening |
| `!help` | | Commands and sources |

You must be in a voice room of the same server to use music commands. Each voice room has its own queue, and commands
always act on the room you're in.

**DJ rights** use SEND's existing roles: a role named `DJ`, or the Move Members or Manage Channels permission in that voice room.

## Supported sources

| Source | How | Notes |
| --- | --- | --- |
| Audius | `!play <song name>` or an `audius.co` track link | Open music catalogue that allows third-party apps to stream through its API. No key needed. Tracks marked not streamable or gated are skipped |
| Direct audio links | `!play https://…/song.mp3` | Public https only. The server checks the address isn't private, follows redirects safely and only accepts an audio content type (mp3, ogg, opus, m4a, wav, flac) |
| Jamendo (optional) | Song-name search falls back to Jamendo | Only when `MUSIC_JAMENDO_CLIENT_ID` is set on the server (free key from developer.jamendo.com). Not tested yet: no key was available |
| Built-in test tracks | `!play test`, `!play test 2` | Two short synthesized tones bundled with the server (`server/assets/music`), free of any licence |
| YouTube, Spotify, Apple Music, SoundCloud, Deezer, Tidal, Bandcamp | Not playable | These links only give a title and artwork. The bot says so, shows the title and suggests `!play <title>` to search Audius |

## How it works

SEND voice is peer-to-peer by default, so the server can't be a WebRTC participant. Instead the server runs the player
for each room (queue, clock, timers) in `server/src/music.ts`, and every client in the room plays the same stream at
the server's position (`web/src/voice/music.tsx`):

- Audio reaches listeners through `/api/music/stream/<token>`. The token is random and only lives while the track is queued
  or playing. Provider URLs and keys never reach clients.
- Clients correct drift over 1.5 s and follow pause, resume and skip as they happen. Deafening silences the music; it plays
  on the voice output device; volume is remembered per device.
- Listeners hear the music locally, so it is never picked up again by anyone's microphone or screen share.
- All changes to a room run one at a time, so simultaneous requests can't lose tracks or start two players.
- Before a track starts, the server checks it really serves audio. A broken track is skipped with a message naming the track
  and the reason. If a listener's player fails mid-track, the server re-checks and skips it only if it's really broken.
- Tracks advance when they end. For a direct link without a known length, the first listener's player reports it.
- The bot leaves after `MUSIC_IDLE_SECONDS` (default 120) with nobody in the room.
- The bot is the `sendmusic` account (display name "SEND Music"), created on first use. It shows in the room's member list
  with a BOT tag and the current track.

## Launch

Nothing to configure for Audius, links and test tracks. Optional server environment variables:

```
MUSIC_IDLE_SECONDS=120              # leave after this long with nobody in the room
MUSIC_JAMENDO_CLIENT_ID=…           # enable Jamendo search (keep it on the server only)
MUSIC_AUDIUS_HOST=https://discoveryprovider.audius.co
```

Local run:

```
pg_ctlcluster 16 main start
npm run build
DATABASE_URL=postgres://… PORT=3900 node --import tsx server/src/index.ts
```

Live end-to-end test (two browsers in one room, real audio measured from each client's output):

```
MUSIC_IDLE_SECONDS=10 (start the server with this)
NODE_PATH=$(npm root -g) node e2e/music.cjs http://localhost:3900 /tmp/out
```

## Limits

- The queue lives in the server's memory, like voice state: restarting the backend clears queues.
- Slash commands: SEND's slash commands go to external apps over HTTP, so music uses `!` commands. Registering them as
  slash commands would need a built-in app entry; not done yet.
- Max 100 tracks per room queue. Audius playlists and profiles aren't accepted yet, only track links.
