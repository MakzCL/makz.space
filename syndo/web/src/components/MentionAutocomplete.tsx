import { AtSign, Users } from "lucide-react";
import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import { P, type Channel, type Member } from "@syndo/shared";
import { api } from "../api.ts";
import { can, displayName, useStore } from "../store.ts";
import { Avatar } from "./ui.tsx";

type Suggestion = { key: string; label: string; detail: string; value: string; user?: Member["user"] };

/** Suggestions are scoped to this server or DM; the API still authorizes every ping. */
export function useMentionAutocomplete(channel: Channel, text: string, setText: (value: string) => void, textarea: RefObject<HTMLTextAreaElement | null>) {
  const id = useId();
  const [caret, setCaret] = useState(text.length);
  const [dismissed, setDismissed] = useState("");
  const [selected, setSelected] = useState(0);
  const [remote, setRemote] = useState<{ query: string; members: Member[] } | null>(null);
  const guild = useStore((s) => channel.guild_id ? s.guilds[channel.guild_id] : null);
  const members = useStore((s) => channel.guild_id ? s.members[channel.guild_id] : null);
  const me = useStore((s) => s.me);
  const prefix = text.slice(0, caret);
  const match = prefix.match(/(?:^|\s)@([^\s@<>`]{0,32})$/u);
  const signature = `${caret}:${prefix}`;
  // A selection replaces text, rather than completing a token in the middle of it.
  const active = !!match && signature !== dismissed && textarea.current?.selectionStart === textarea.current?.selectionEnd;
  const query = active ? match![1].toLocaleLowerCase() : null;
  const start = match ? caret - match[1].length - 1 : caret;

  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => {
    if (query === null || !channel.guild_id) return;
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
  }, [channel.guild_id, query]);

  const options = useMemo(() => {
    if (query === null) return [];
    const out: Suggestion[] = [];
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
  }, [query, members, remote, me, channel, guild]);
  const index = Math.min(selected, Math.max(0, options.length - 1));
  useEffect(() => { document.getElementById(`${id}-${index}`)?.scrollIntoView?.({ block: "nearest" }); }, [id, index, options.length]);
  const choose = (option: Suggestion) => {
    const next = text.slice(0, start) + option.value + " " + text.slice(caret);
    const pos = start + option.value.length + 1;
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
      <p className="muted small">Mention someone · ↑↓ to choose · Enter to insert · Esc to dismiss</p>
      {options.map((option, i) => <div id={`${id}-${i}`} key={option.key} role="option" aria-selected={i === index} className={`mention-option ${i === index ? "selected" : ""}`} onMouseEnter={() => setSelected(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(option)}>
        {option.user ? <Avatar user={option.user} size={26} /> : option.key.startsWith("role:") ? <Users size={22} aria-hidden /> : <AtSign size={22} aria-hidden />}
        <strong className="ellipsis">{option.label}</strong><span className="muted small ellipsis">{option.detail}</span>
      </div>)}
    </div> : null,
  };
}
