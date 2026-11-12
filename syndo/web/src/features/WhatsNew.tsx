import { useEffect, useState } from "react";
import { Modal } from "../components/ui.tsx";
import { currentLocale } from "./i18n.tsx";

/**
 * "What's new" changelog. It opens once after each update (when the newest entry hasn't been seen on this device),
 * waits until no other dialog is open, and can be reopened from Settings. Both the X and Dismiss close it.
 */
interface Release { id: string; title: string; date: string; intro: string; sections: { title: string; items: string[] }[] }

export const CHANGELOG: Release[] = [
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
        {CHANGELOG.map((r, i) => (
          <article key={r.id} className={i ? "older" : ""}>
            <header><h3>{r.title}</h3><time dateTime={r.date}>{new Date(r.date + "T12:00:00").toLocaleDateString(currentLocale(), { day: "numeric", month: "long", year: "numeric" })}</time></header>
            <p className="wn-intro">{r.intro}</p>
            {r.sections.map((s) => (
              <section key={s.title}>
                <h4>{s.title}</h4>
                <ul>{s.items.map((it) => <li key={it}>{it}</li>)}</ul>
              </section>
            ))}
          </article>
        ))}
      </div>
    </Modal>
  );
}
