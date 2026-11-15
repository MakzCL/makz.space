import { useEffect, useState } from "react";
import { Music2, Sparkles } from "lucide-react";
import { Modal } from "../components/ui.tsx";
import { currentLocale } from "./i18n.tsx";

/**
 * "What's new" changelog. It opens once after each update (when the newest entry hasn't been seen on this device),
 * waits until no other dialog is open, and can be reopened from Settings. Both the X and Dismiss close it.
 */
type BannerIcon = "music" | "sparkles";
interface Release {
  id: string; title: string; date: string; intro: string; sections: { title: string; items: string[] }[];
  /** Artwork at the top of the entry: an icon on a two-colour gradient. Entries without one get the accent colours. */
  banner?: { icon: BannerIcon; from: string; to: string; tagline?: string };
}

/** The changelog banner: a gradient card with floating shapes, the icon and the release name. */
function Banner({ r, big }: { r: Release; big: boolean }) {
  const b = r.banner;
  const Icon = b?.icon === "music" ? Music2 : Sparkles;
  const style = { "--wn-from": b?.from ?? "var(--accent)", "--wn-to": b?.to ?? "color-mix(in srgb, var(--accent) 50%, #ff7ad9)" } as React.CSSProperties;
  return <div className={`wn-banner ${big ? "big" : ""}`} style={style} aria-hidden>
    <span className="wn-orb a" /><span className="wn-orb b" />
    {b?.icon === "music" && <><Music2 className="wn-float f1" size={22} /><Music2 className="wn-float f2" size={16} /><Music2 className="wn-float f3" size={28} /></>}
    {b?.icon !== "music" && <><Sparkles className="wn-float f1" size={18} /><Sparkles className="wn-float f2" size={14} /><Sparkles className="wn-float f3" size={22} /></>}
    <span className="wn-badge"><Icon size={big ? 30 : 18} /></span>
    {big && <span className="wn-banner-text"><small>{b?.tagline ?? "Update"}</small><strong>{r.title}</strong></span>}
  </div>;
}

export const CHANGELOG: Release[] = [
  {
    id: "2026-11-lighter-streams",
    title: "Lighter streams, clean stream sound",
    date: "2026-11-15",
    intro: "Streaming and watching take far less from your computer, and nobody hears themselves in your stream any more.",
    banner: { icon: "sparkles", from: "#2F80ED", to: "#3DDC97", tagline: "Update" },
    sections: [
      { title: "Streaming", items: [
        "Your stream is only sent to the people watching it, so friends who haven't pressed Watch Stream cost you nothing.",
        "Calls use your graphics chip for video, which takes much less processor time to send and to watch.",
        "Stream previews no longer play the video in the background until you press Watch Stream.",
      ] },
      { title: "Stream sound (desktop app)", items: [
        "Sharing a screen sends the sound of each program on your PC except SEND, so the call never comes back through your stream.",
        "Audio mixers that play everything again (such as Sonar, Voicemeeter and Wave Link) are left out for the same reason.",
        "The Go Live window shows which programs' sound you are sharing.",
      ] },
    ],
  },
  {
    id: "2026-11-boost-perks",
    title: "Boost perks and a smarter music player",
    date: "2026-11-15",
    intro: "Servers get new things to unlock with boosts, and SEND Music fits right into the / menu.",
    banner: { icon: "sparkles", from: "#B05CFF", to: "#FF8FD1", tagline: "Update" },
    sections: [
      { title: "Server Boost", items: [
        "A new Server Boost page: each level as a card with its perks, plus your available and spent boosts.",
        "The boost bar under the server name is cleaner: level, boost count and markers for levels 1, 2 and 3.",
        "Additional perks you can turn on with enough boosts, whatever the level: a badge next to your server tag, animated gradient role colours and a server colour.",
      ] },
      { title: "SEND Music", items: [
        "Music commands live in the / menu now: /play, /queue, /nowplaying, /pause, /resume, /skip and /stop.",
        "The bot shows in the call, and you can turn its volume down just for you.",
        "The player rearranges itself when the window gets smaller.",
      ] },
      { title: "Also new", items: [
        "Camera, screen share, activities and soundboard buttons in the voice panel.",
        "The soundboard opens as a small panel above its button.",
        "A new Anime Premiere collection in the profile shop.",
        "The SEND app icon now has its own background everywhere, including the taskbar and tray.",
        "The Android app can check for, download and install updates itself.",
      ] },
    ],
  },
  {
    id: "2026-11-music-2",
    title: "SEND Music is here",
    date: "2026-11-14",
    intro: "A music bot for your voice rooms. Listen together, in sync, from YouTube, Spotify and more.",
    banner: { icon: "music", from: "#5865f2", to: "#eb459e", tagline: "New bot" },
    sections: [
      { title: "Play anything", items: [
        "Type !play with a song name or a link in any chat, or press the music button on the call screen.",
        "YouTube videos and playlists play in YouTube's own player, in sync for everyone in the room.",
        "Paste a Spotify or Deezer song, album or playlist and SEND Music looks for a playable version of each song.",
        "Audius tracks and playlists, and direct links to audio files, work too.",
      ] },
      { title: "On the call screen", items: [
        "A now-playing card with progress, pause, skip, the queue and stop.",
        "Add songs from the card without typing a command.",
        "Your own music volume slider, without changing it for anyone else.",
        "The song shows in your voice panel with pause and skip.",
      ] },
      { title: "Commands", items: [
        "Use !queue, !nowplaying, !pause, !resume, !skip and !stop. Type !help for the full list.",
        "Skipping someone else's song or stopping the bot needs a DJ role, or Move Members.",
      ] },
    ],
  },
  {
    id: "2026-11-motion",
    title: "Profiles that come alive",
    date: "2026-11-13",
    intro: "Every profile effect and avatar decoration, rebuilt with real motion. Still free for everyone.",
    sections: [
      { title: "Profile effects", items: [
        "Every collection has its own animated scene: moonlit storms, auroras, fireworks, lava, koi ponds and more.",
        "Animated avatar decorations: flame, ice, gold, neon and floral rings, with things orbiting your avatar.",
        "New: report messages, people and servers from their menus, so the SEND safety team can step in.",
      ] },
      { title: "On your phone", items: [
        "A new phone app layout: Messages home, a channel page with Media, Links and Files, and a You page.",
        "New voice screens with a big Join Voice button and a simpler call dock.",
      ] },
      { title: "Fixes", items: [
        "Open profiles from the member list in group chats, even during a call.",
        "The pop-out call opens as a proper SEND window in the Windows app (update to 0.7.1).",
      ] },
    ],
  },
  {
    id: "2026-11-call-tiles",
    title: "Arrange your call",
    date: "2026-11-12",
    intro: "Calls you can shape the way you like.",
    sections: [
      { title: "Calls", items: [
        "Drag anyone's box to a new spot: the others slide out of the way, like apps on your phone.",
        "Pop the whole call out into its own window with the button at the top.",
        "Click the speaker on someone's box to mute them for you; hover it for the volume.",
        "Group calls stop ringing after 30 seconds.",
        "See ongoing calls in your DMs and group chats, and join with one click.",
      ] },
    ],
  },
  {
    id: "2026-11-desktop-share",
    title: "Screen sharing, built into the app",
    date: "2026-11-12",
    intro: "SEND for Windows 0.7 picks what to share itself: no more system pop-up.",
    sections: [
      { title: "Go Live", items: [
        "See your open windows and screens with live previews, right in SEND.",
        "Share a window and only that app's sound goes with it.",
        "Share a screen and everything is heard except SEND itself, so there's no echo.",
        "New join, mute and message sounds, and no more red sharing bar.",
      ] },
    ],
  },
  {
    id: "2026-11-emotes-box",
    title: "Emotes in the message box",
    date: "2026-11-12",
    intro: "Small things that make chatting nicer.",
    sections: [
      { title: "Messages", items: [
        "Emotes show as pictures while you type, not as codes.",
        "Backspace removes a whole emote at once.",
        "People's statuses show under their names in the member list.",
        "Voice channels show a call timer and an Invite to Voice row, laid out like Discord.",
        "\"Jump to present\" disappears once you're back at the newest messages.",
      ] },
    ],
  },
  {
    id: "2026-11-go-live",
    title: "A proper Go Live screen",
    date: "2026-11-12",
    intro: "Screen sharing starts from a SEND dialog, like you'd expect.",
    sections: [
      { title: "Screen share", items: [
        "Pick Applications, Entire Screen or Devices, then press Go Live.",
        "Devices streams a camera or capture card (consoles, cameras) with a live preview.",
        "Choose resolution, frame rate and sound right in the dialog.",
      ] },
    ],
  },
  {
    id: "2026-11-motion-voice",
    title: "Smoother, with nicer voice messages",
    date: "2026-11-12",
    intro: "Little animations everywhere, and voice messages that look the part.",
    sections: [
      { title: "Voice messages", items: [
        "Recording shows a live waveform, a timer and a pulsing dot: tap send when you're done, or the bin to throw it away.",
        "Sent voice messages play in a SEND player with a waveform, never the plain browser one.",
      ] },
      { title: "Feel", items: [
        "Buttons and icons react when you hover and click them.",
        "Menus, pickers and pop-ups glide in instead of popping.",
        "The + in the message box sits right in the middle of its circle.",
      ] },
    ],
  },
  {
    id: "2026-11-calls-layout",
    title: "Calls fit your window",
    date: "2026-11-11",
    intro: "Video and screen shares now use all the space you give them.",
    sections: [
      { title: "In calls", items: [
        "In a tall window, video tiles stack and fill the space instead of sitting in a row.",
        "A shared screen keeps its own shape, with no black bars around it.",
        "The people under a big tile sit right under it, centred.",
        "In the desktop app, SEND keeps itself out of your screen share.",
      ] },
      { title: "Everywhere", items: [
        "Your messages show up instantly: no more \"Sending…\".",
        "When there's a new version of SEND, you get an update button.",
      ] },
    ],
  },
  {
    id: "2026-11-call-tiles",
    title: "Calls that work like you'd expect",
    date: "2026-11-11",
    intro: "Video and screen share tiles now behave the way you're used to.",
    sections: [
      { title: "In calls", items: [
        "Click anyone's tile to make it big; click it again to go back to the grid.",
        "Someone's screen share shows a Watch Stream button, and you only hear it once you watch.",
        "Stop watching from the tile, and hide or show the people under a big tile.",
        "Names show when you hover over video.",
      ] },
    ],
  },
  {
    id: "2026-11-noise",
    title: "Noise suppression",
    date: "2026-11-11",
    intro: "Background noise stays out of your calls.",
    sections: [
      { title: "Calls", items: [
        "AI noise suppression removes fans, keyboards and traffic from your microphone. It's on by default and runs on your device.",
        "Switch between AI, Standard and None in your voice settings or from the arrow next to your mic.",
        "A quick on/off button sits next to Disconnect while you're in a call.",
      ] },
    ],
  },
  {
    id: "2026-11-calls",
    title: "Camera and screen together",
    date: "2026-11-11",
    intro: "Show your face and your screen at the same time.",
    sections: [
      { title: "Calls", items: [
        "Your camera stays on while you share your screen, and people see both.",
        "Shared screens no longer play the call back to the people watching.",
        "A voice channel's status now sits under its name in the channel list.",
      ] },
    ],
  },
  {
    id: "2026-11-drawer",
    title: "A tidier phone menu",
    date: "2026-11-11",
    intro: "Small fixes to make SEND on your phone feel more like home.",
    sections: [
      { title: "On your phone", items: [
        "A search bar, invite button and events button under the server name.",
        "Rounded server icons and a rounded channel panel.",
        "Slimmer channel rows with a clearer highlight on the one you're in.",
      ] },
      { title: "Messages", items: [
        "Replies to a picture or file now show a hint to open the attachment.",
      ] },
      { title: "Starting up", items: [
        "The start-up screen now matches your theme and wallpaper.",
        "A cleaner logo animation while SEND connects.",
      ] },
    ],
  },
  {
    id: "2026-11-polish",
    title: "Polish and phones",
    date: "2026-11-11",
    intro: "A tidier phone layout, big uploads, 7TV and BTTV emotes and a nicer call screen.",
    sections: [
      { title: "Messages", items: [
        "Replies show the person's picture and a line linking to their message.",
        "The hover bar is shorter: reactions, reply, forward, thread and a More menu.",
        "Voice messages have a new player: a waveform you can drag, and 1x, 1.5x or 2x speed.",
        "Bold text is clearly bold.",
        "The quick switcher is just a search box.",
      ] },
      { title: "On your phone", items: [
        "A back arrow with your waiting mentions, and the online count under the channel name.",
        "Chat fills the whole screen, edge to edge.",
        "The message box is one rounded bar.",
        "A round button jumps back to the newest message.",
        "Threads, members, pins and notification settings moved into the menu.",
      ] },
      { title: "Calls", items: [
        "Arrow menus on the mic and camera buttons to switch devices.",
        "Chat beside the call, with message previews.",
        "Invite people or start an activity when you're alone in a call.",
      ] },
      { title: "Files and emotes", items: [
        "Upload files up to 500 MB in boosted servers.",
        "7TV and BTTV emotes, typed as :name: or picked from the emoji menu.",
      ] },
      { title: "Little things", items: [
        "Headings come in three sizes and numbered lists keep their numbers.",
        "The edited mark sits next to the message.",
        "Date lines are shorter.",
        "Menus open next to their button and stay on screen.",
        "SEND for Windows 0.6.1 fixes the window buttons and push-to-talk.",
      ] },
    ],
  },
  {
    id: "2026-11-major",
    title: "The big update",
    date: "2026-11-10",
    intro: "Our biggest update yet: threads, forums, stages, events, bots, boosts and SEND in 12 languages.",
    sections: [
      { title: "Messages", items: [
        "Link previews for websites and YouTube.",
        "Polls with one or more answers and a time limit.",
        "Forward a message to another channel or DM.",
        "Turn the reply ping on or off with @ ON/OFF.",
        "Timestamps that show in everyone's own time zone.",
        "Several images in one message now show as a grid.",
        "A mentions inbox, opened with Ctrl+I, and a GIF picker.",
      ] },
      { title: "Channels", items: [
        "Threads: start one from any message.",
        "Forum channels with tags, and media channels.",
        "Stage channels with speakers, an audience and raised hands.",
        "Follow an announcement channel into your own server.",
        "Voice channels can show a status line.",
      ] },
      { title: "Servers", items: [
        "Events with RSVPs and a reminder when they start.",
        "AutoMod blocks bad words, spam and mention spam.",
        "Onboarding with rules screening and a welcome screen.",
        "Server Discovery to find public communities.",
        "Server Insights and pruning inactive members.",
        "Folders in your server list.",
      ] },
      { title: "Apps and bots", items: [
        "Webhooks, bots and slash commands.",
        "An App Directory to add apps to your server.",
        "Activities in voice: Watch Together, Sketch Board, Tic-Tac-Toe and Quick Trivia.",
      ] },
      { title: "Server Boosts", items: [
        "Boost a server for bigger uploads and more emoji, sticker and sound slots.",
      ] },
      { title: "You", items: [
        "Connect your accounts and show what you're playing.",
        "Custom status that clears itself, and automatic Idle.",
        "Sign in with a passkey or by scanning a QR code.",
        "Streamer mode hides your personal details.",
      ] },
      { title: "Notifications", items: [
        "Choose All messages, Only @mentions or Nothing per server and channel.",
        "Mute for 15 minutes, an hour, 8 hours or a day.",
        "Push notifications, even when SEND is closed.",
      ] },
      { title: "Languages", items: [
        "SEND now speaks Polish, French, Spanish, German, Portuguese, Italian, Dutch, Russian, Ukrainian, Arabic and Turkish.",
      ] },
      { title: "Little things", items: [
        "Emoji skin tones and favourite emoji.",
        "Drag channels to reorder them.",
        "Use ↑ and ↓ to move between messages.",
        "A bar warns you about unsaved changes in settings.",
        "Mouse back and forward buttons move through channels.",
      ] },
    ],
  },
];

const KEY = "send.whatsNew.seen";
const latest = CHANGELOG[0]!;
const seen = () => { try { return localStorage.getItem(KEY); } catch { return latest.id; } };
const markSeen = () => { try { localStorage.setItem(KEY, latest.id); } catch { /* private mode */ } };

/** Reopen the changelog from anywhere (Settings). */
export const openWhatsNew = () => window.dispatchEvent(new Event("send:whatsnew"));

export function WhatsNewHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("send:whatsnew", on);
    // First launch after an update: wait until nothing else (download prompt, onboarding…) is on screen.
    let timer: number | undefined;
    if (seen() !== latest.id && seen() !== "skip") { // "skip" is set by the browser tests
      const tryOpen = () => { if (document.querySelector('[aria-modal="true"]')) timer = window.setTimeout(tryOpen, 1500); else setOpen(true); };
      timer = window.setTimeout(tryOpen, 1200);
    }
    return () => { window.removeEventListener("send:whatsnew", on); clearTimeout(timer); };
  }, []);
  if (!open) return null;
  const close = () => { markSeen(); setOpen(false); };
  return (
    <Modal title="What's new in SEND" onClose={close} footer={<button className="btn primary" onClick={close} autoFocus>Dismiss</button>}>
      <div className="whats-new">
        {/* Only this update: older entries stay in the code for reference but aren't shown. */}
        <article>
          <Banner r={latest} big />
          <header><h3 className="sr-only">{latest.title}</h3><time dateTime={latest.date}>{new Date(latest.date + "T12:00:00").toLocaleDateString(currentLocale(), { day: "numeric", month: "long", year: "numeric" })}</time></header>
          <p className="wn-intro">{latest.intro}</p>
          {latest.sections.map((s) => (
            <section key={s.title}>
              <h4>{s.title}</h4>
              <ul>{s.items.map((it) => <li key={it}>{it}</li>)}</ul>
            </section>
          ))}
        </article>
      </div>
    </Modal>
  );
}
