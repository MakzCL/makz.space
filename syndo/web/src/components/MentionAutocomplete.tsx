import { AtSign, Users } from "lucide-react";
import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import { P, type Channel, type Member } from "@send/shared";
import { api } from "../api.ts";
import { can, displayName, useStore } from "../store.ts";
import { Avatar } from "./ui.tsx";
import { emojiText, myEmojis } from "../expressions.ts";
import { emoteGroups, emoteToken, emoteUrl, loadEmotes, useEmotes } from "../features/Emotes.tsx";

type Suggestion = { key: string; label: string; detail: string; value: string; user?: Member["user"]; image?: string };

/** Suggestions are scoped to this server or DM; the API still authorizes every ping. */
export function useMentionAutocomplete(channel: Channel, text: string, setText: (value: string) => void, textarea: RefObject<HTMLTextAreaElement | null>, display?: (value: string) => string) {
  const id = useId();
  const [caret, setCaret] = useState(text.length);
  const [dismissed, setDismissed] = useState("");
  const [selected, setSelected] = useState(0);
  const [remote, setRemote] = useState<{ query: string; members: Member[] } | null>(null);
  const guild = useStore((s) => channel.guild_id ? s.guilds[channel.guild_id] : null);
  const members = useStore((s) => channel.guild_id ? s.members[channel.guild_id] : null);
  const me = useStore((s) => s.me);
  const prefix = text.slice(0, caret);
  // "@name" → people and roles; ":name" (2+ letters) → custom emoji from my servers.
  const emojiMatch = prefix.match(/(?:^|\s):([A-Za-z0-9_]{2,32})$/);
  const match = emojiMatch ?? prefix.match(/(?:^|\s)@([^\s@<>`]{0,32})$/u);
  const kind = emojiMatch ? "emoji" : "mention";
  // 7TV/BTTV emotes join the :name: suggestions once loaded.
  const emoteVersion = useEmotes((s) => `${s.global?.length ?? 0}:${Object.keys(s.guild).length}`);
  useEffect(() => { if (kind === "emoji") loadEmotes(channel.guild_id); }, [kind, channel.guild_id]);
  const signature = `${caret}:${prefix}`;
  // A selection replaces text, rather than completing a token in the middle of it.
  const active = !!match && signature !== dismissed && textarea.current?.selectionStart === textarea.current?.selectionEnd;
  const query = active ? match![1].toLocaleLowerCase() : null;
  const start = match ? caret - match[1].length - 1 : caret;

  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => {
    if (query === null || !channel.guild_id || kind === "emoji") return;
    let stale = false;
    const timer = setTimeout(() => {
      api.get<Member[]>(`/api/guilds/${channel.guild_id}/members?q=${encodeURIComponent(query)}&limit=20`).then((list) => {
        if (stale) return;
        setRemote({ query, members: list });
        // Make inserted user mentions render by name even beyond the initial member page.
        useStore.setState((s) => ({ users: { ...s.users, ...Object.fromEntries(list.map((m) => [m.user.id, m.user])) } }));
      }).catch(() => { if (!stale) setRemote(null); });
    }, 180);
    return () => { stale = true; clearTimeout(timer); };
  }, [channel.guild_id, query, kind]);

  const options = useMemo(() => {
    if (query === null) return [];
    const out: Suggestion[] = [];
    if (kind === "emoji") {
      for (const g of myEmojis(channel.guild_id)) for (const e of g.emojis) {
        if (e.name.toLowerCase().includes(query)) out.push({ key: `emoji:${e.id}`, label: `:${e.name}:`, detail: g.guildName, value: emojiText(e), image: e.url });
      }
      const seen = new Set(out.map((o) => o.label.toLowerCase()));
      for (const g of emoteGroups(channel.guild_id)) for (const e of g.emotes) {
        if (!e.name.toLowerCase().includes(query) || seen.has(`:${e.name.toLowerCase()}:`)) continue;
        seen.add(`:${e.name.toLowerCase()}:`);
        out.push({ key: `emote:${e.provider}:${e.id}`, label: `:${e.name}:`, detail: g.title, value: emoteToken(e), image: emoteUrl(e.provider, e.id) });
      }
      return out.sort((a, b) => Number(!a.label.slice(1).toLowerCase().startsWith(query)) - Number(!b.label.slice(1).toLowerCase().startsWith(query)) || a.label.localeCompare(b.label)).slice(0, 10);
    }
    const matches = (...values: (string | null | undefined)[]) => values.some((v) => v?.toLocaleLowerCase().includes(query));
    const people = channel.guild_id ? [...Object.values(members ?? {}), ...(remote?.query === query ? remote.members : [])]
      : [me, ...(channel.recipients ?? [])].filter((u): u is Member["user"] => !!u).map((user) => ({ user, nick: null }));
    const seen = new Set<string>();
    for (const m of people) {
      if (seen.has(m.user.id)) continue;
      seen.add(m.user.id);
      const label = m.nick || displayName(m.user);
      if (matches(label, m.user.username)) out.push({ key: `user:${m.user.id}`, label, detail: `@${m.user.username}`, value: `<@${m.user.id}>`, user: m.user });
    }
    const massMention = can(channel, P.MENTION_EVERYONE);
    for (const role of guild?.roles ?? []) {
      if (role.id !== guild?.id && (role.mentionable || massMention) && matches(role.name)) out.push({ key: `role:${role.id}`, label: role.name, detail: "Role", value: `<@&${role.id}>` });
    }
    if (guild && massMention) for (const name of ["everyone", "here"]) {
      if (matches(name)) out.push({ key: name, label: `@${name}`, detail: name === "here" ? "Notify online members" : "Notify everyone", value: `@${name}` });
    }
    return out.sort((a, b) => Number(!a.label.toLocaleLowerCase().startsWith(query)) - Number(!b.label.toLocaleLowerCase().startsWith(query)) || a.label.localeCompare(b.label)).slice(0, 10);
  }, [query, members, remote, me, channel, guild, kind, emoteVersion]);
  const index = Math.min(selected, Math.max(0, options.length - 1));
  useEffect(() => { document.getElementById(`${id}-${index}`)?.scrollIntoView?.({ block: "nearest" }); }, [id, index, options.length]);
  const choose = (option: Suggestion) => {
    const value = display ? display(option.value) : option.value;
    const next = text.slice(0, start) + value + " " + text.slice(caret);
    const pos = start + value.length + 1;
    setText(next); setCaret(pos);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(pos, pos); });
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || query === null) return false;
    if (e.key === "Escape") { e.preventDefault(); setDismissed(signature); return true; }
    if (!options.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSelected((index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); return true; }
    if ((e.key === "Enter" && !e.shiftKey) || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); choose(options[index]); return true; }
    return false;
  };
  return {
    onKeyDown,
    onSelect: () => { if (textarea.current) setCaret(textarea.current.selectionStart); },
    onBlur: () => setDismissed(signature),
    inputProps: { "aria-autocomplete": "list" as const, "aria-controls": options.length ? id : undefined, "aria-activedescendant": options.length ? `${id}-${index}` : undefined },
    popup: options.length > 0 ? <div className="mention-popup" id={id} role="listbox" aria-label="Mention suggestions">
      <p className="muted small">{kind === "emoji" ? "Emoji matching" : "Mention someone"} · ↑↓ to choose · Enter to insert · Esc to dismiss</p>
      {options.map((option, i) => <div id={`${id}-${i}`} key={option.key} role="option" aria-selected={i === index} className={`mention-option ${i === index ? "selected" : ""}`} onMouseEnter={() => setSelected(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(option)}>
        {option.image ? <img className="mention-emoji" src={option.image} alt="" /> : option.user ? <Avatar user={option.user} size={26} /> : option.key.startsWith("role:") ? <Users size={22} aria-hidden /> : <AtSign size={22} aria-hidden />}
        <strong className="ellipsis">{option.label}</strong><span className="muted small ellipsis">{option.detail}</span>
      </div>)}
    </div> : null,
  };
}
