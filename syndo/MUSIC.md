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

## On-screen controls

The call screen has a music button next to the chat button (on phones, in the call's top bar). It opens a box for a song
name or link, which starts the bot. While the bot is in the room, a now-playing card sits above the call tiles on every
listener's screen: title, artist, who asked for it, a progress bar, pause or resume, skip, the queue, "add a song",
stop, and a music volume slider that only changes your own volume. The sidebar voice panel shows the current song
with pause and skip.

The buttons call `POST /api/music/<voice room>/control` with `{ action: "play" | "pause" | "resume" | "skip" | "stop", query? }`.
That runs exactly the same command as typing it in chat: same permissions, the same DJ rules, and the bot posts what
happened in the room's music chat (or in the voice room's own chat when nothing has played yet). Only people in that
voice room can use it.

The music state carries `controls: true` from backends that have this endpoint. The web app shows the buttons only then,
so a web release that goes live before the backend shows the read-only card instead of buttons that fail.

Tested by `e2e/music-ui.cjs` (22 checks, two desktop listeners and a phone) and `e2e/music-links.cjs` (19 checks: YouTube video and playlist really playing in sync, hiding the player, Spotify song and playlist, Deezer album).

## Supported sources

| Source | How | Notes |
| --- | --- | --- |
| YouTube | Video, Shorts, YouTube Music and playlist links | Plays in YouTube's own embedded player (IFrame API) on each listener's screen, kept on the server's clock. Nothing is downloaded. YouTube asks for its player to stay visible (at least 200 x 200), so it's a small dock; hiding it stops YouTube songs for that person only. Playlists: the first 15 videos from YouTube's public feed, or up to 100 with `YOUTUBE_API_KEY`. Videos whose owner blocks other players are replaced by another version of the same song when one is found, otherwise skipped with the reason |
| Spotify | Song, album and playlist links (also spotify.link) | Spotify never gives out audio. The bot reads titles and artists from Spotify's public link-preview tags (playlists: the first 30 songs, albums: all) and finds a playable version of each song when its turn comes |
| Deezer | Song, album and playlist links | Read through Deezer's open public API, then matched like Spotify |
| Apple Music, SoundCloud, Tidal, Bandcamp | Single song links | The page title is read, then matched |
| Audius | `!play <song name>`, track and playlist links | Open catalogue that allows third-party apps to stream through its API. No key needed |
| Direct audio links | `!play https://…/song.mp3` | Public https only, checked to be audio |
| Jamendo (optional) | Song-name search falls back to Jamendo | Only with `MUSIC_JAMENDO_CLIENT_ID` |
| Built-in test tracks | `!play test`, `!play test 2` | Two short synthesized tones bundled with the server |

**Matching.** A song from Spotify and friends is matched when it comes up, not when it's queued, so a 30-song
playlist costs nothing until it's played. It's searched on YouTube (only with `YOUTUBE_API_KEY`), then Audius. A result
only counts if most of the song title's words are in it and it isn't a cover, remix or sped-up edit, unless that's what
was asked for: a skip is better than the wrong song. Without a YouTube key most mainstream songs have no proper version
on Audius and are skipped (listed in one message). With a key, song-name searches use YouTube first too.

**YouTube key.** Free from Google Cloud: create a project, enable "YouTube Data API v3", create an API key, restrict it to
that API, and save it as the Worker secret `YOUTUBE_API_KEY`. The default quota is 10,000 units a day: a search costs 100,
so about 100 matched songs or song-name searches a day; playlists and lengths cost 1 each.

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
YOUTUBE_API_KEY=…                   # YouTube search, Spotify matching, full YouTube playlists (Worker secret)
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
- Max 100 tracks per room queue. Spotify playlists give their first 30 songs, YouTube playlists their first 15 without a key.
- YouTube mixes (list=RD…) are personal and can't be read, so only the video in the link plays.
