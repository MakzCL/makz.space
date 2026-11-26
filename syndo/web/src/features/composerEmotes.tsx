import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { emojiUrl } from "@send/shared";
import { emoteUrl } from "./Emotes.tsx";

/*
 * The message box shows custom emoji and 7TV/BTTV emotes as pictures instead of their codes.
 * The textarea holds a short `:name:` for each one (so typing, the caret and selection stay native),
 * a mirror layer underneath draws the text with the picture over each `:name:`, and the codes are put
 * back when the message is sent.
 */
const TOKEN = /<(?:(a?):([A-Za-z0-9_]{2,32}):(\d{1,20})|(7tv|bttv):([A-Za-z0-9_]{2,32}):([A-Za-z0-9]{24,26}))>/g;
export type EmoteMap = Record<string, string>;

/** Codes → `:name:`, remembering each code in `map`. */
export function collapseEmotes(text: string, map: EmoteMap) {
  if (!text.includes("<")) return text;
  return text.replace(TOKEN, (tok, _a, name1, _id, _p, name2) => { const name = (name1 ?? name2) as string; map[name] = tok; return `:${name}:`; });
}
/** `:name:` → the code it stands for (only names this box knows). */
export function expandEmotes(text: string, map: EmoteMap) {
  if (!text.includes(":")) return text;
  return text.replace(/:([A-Za-z0-9_]{2,32}):/g, (m, name: string) => map[name] ?? m);
}
const NAME = /:([A-Za-z0-9_]{2,32}):/g;
export function hasEmotes(text: string, map: EmoteMap) {
  for (const m of text.matchAll(NAME)) if (map[m[1]!]) return true;
  return false;
}
function imageFor(tok: string) {
  TOKEN.lastIndex = 0;
  const m = TOKEN.exec(tok); TOKEN.lastIndex = 0;
  if (!m) return null;
  return m[3] ? emojiUrl(m[3]) : emoteUrl(m[4]!, m[6]!);
}
/** Backspace right after an emote removes the whole emote. Returns the new text + caret, or null. */
export function backspaceEmote(text: string, caret: number, map: EmoteMap) {
  const m = text.slice(0, caret).match(/:([A-Za-z0-9_]{2,32}):$/);
  if (!m || !map[m[1]!]) return null;
  const at = caret - m[0].length;
  return { text: text.slice(0, at) + text.slice(caret), caret: at };
}

const COPY = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "tabSize", "boxSizing"] as const;

/** The picture layer under the textarea. Render only while the text contains emotes. */
export function EmoteMirror({ text, map, textarea }: { text: string; map: EmoteMap; textarea: RefObject<HTMLTextAreaElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const ta = textarea.current, el = ref.current; if (!ta || !el) return;
    const cs = getComputedStyle(ta);
    for (const k of COPY) (el.style as any)[k] = cs[k];
    el.style.borderStyle = "solid"; el.style.borderColor = "transparent";
    el.scrollTop = ta.scrollTop;
    const sync = () => { el.scrollTop = ta.scrollTop; };
    ta.addEventListener("scroll", sync); return () => ta.removeEventListener("scroll", sync);
  });
  const parts: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(NAME)) {
    const tok = map[m[1]!]; if (!tok) continue;
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const src = imageFor(tok);
    parts.push(<span key={i++} className="ta-emote">{m[0]}{src && <img src={src} alt="" draggable={false} />}</span>);
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last) + (text.endsWith("\n") ? "​" : ""));
  return <div ref={ref} className="ta-mirror" aria-hidden>{parts}</div>;
}
