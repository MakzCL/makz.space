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
    id: "2026-11-polish",
    title: "Polish and phones",
    date: "2026-11-11",
    intro: "A tidier phone layout, big uploads, 7TV and BTTV emotes and a nicer call screen.",
    sections: [
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
export const openWhatsNew = () => window.dispatchEvent(new Event("syndo:whatsnew"));

export function WhatsNewHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("syndo:whatsnew", on);
    // First launch after an update: wait until nothing else (download prompt, onboarding…) is on screen.
    let timer: number | undefined;
    if (seen() !== latest.id) {
      const tryOpen = () => { if (document.querySelector('[aria-modal="true"]')) timer = window.setTimeout(tryOpen, 1500); else setOpen(true); };
      timer = window.setTimeout(tryOpen, 1200);
    }
    return () => { window.removeEventListener("syndo:whatsnew", on); clearTimeout(timer); };
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
