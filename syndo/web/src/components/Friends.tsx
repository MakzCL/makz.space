import { MobileNavButton } from "./ui.tsx";
import { askConfirm, askText } from "./overlay.tsx";
import { Check, MessageSquare, Shield, UserMinus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errMsg } from "../api.ts";
import { openDm } from "../actions.ts";
import { setTitle } from "../router.ts";
import { displayName, toast, useStore } from "../store.ts";
import type { Dialog } from "./Shell.tsx";
import { Avatar, statusLabel } from "./ui.tsx";

type Tab = "online" | "all" | "pending" | "blocked" | "add";

const FRIEND_TABS = { online: "Online", all: "All", pending: "Pending", blocked: "Blocked" } as const;

export function Friends({ onDialog }: { onDialog: (d: Dialog) => void }) {
  const [tab, setTab] = useState<Tab>("online");
  const rels = useStore((s) => s.relationships);
  const presences = useStore((s) => s.presences);
  useEffect(() => setTitle("Friends"), []);
  const list = Object.values(rels).filter((r) =>
    tab === "online" ? r.type === 1 && (presences[r.id] ?? "offline") !== "offline"
      : tab === "all" ? r.type === 1 : tab === "pending" ? r.type === 3 || r.type === 4 : tab === "blocked" ? r.type === 2 : false)
    .sort((a, b) => displayName(a.user).localeCompare(displayName(b.user)));
  const pending = Object.values(rels).filter((r) => r.type === 3).length;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { toast(errMsg(e), "error"); } };
  return (
    <div className="friends">
      <header className="ch-h">
        <MobileNavButton /><Users size={22} aria-hidden /><h1 className="t">Friends</h1>
        <div className="tabs" role="tablist" aria-label="Friend lists">
          {(["online", "all", "pending", "blocked"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {FRIEND_TABS[t]}{t === "pending" && pending > 0 && <span className="badge inline">{pending}</span>}
            </button>
          ))}
          <button role="tab" aria-selected={tab === "add"} className={`add ${tab === "add" ? "active" : ""}`} onClick={() => setTab("add")}>Add friend</button>
          <button className="btn sm" onClick={() => onDialog({ kind: "groupDm" })}>New group</button>
        </div>
      </header>
      <div className="friends-body">
        {tab === "add" ? <AddFriend /> : (
          <>
            <h2 className="side-sec">{tab === "online" ? "Online" : tab === "all" ? "All friends" : tab === "pending" ? "Pending" : "Blocked"}: {list.length}</h2>
            {!list.length && <p className="muted pad list-empty">{tab === "online" ? "No friends are online right now." : tab === "pending" ? "No pending requests." : tab === "blocked" ? "You haven't blocked anyone." : "No friends yet: add someone by their username."}</p>}
            <ul className="friend-list">
              {list.map((r) => (
                <li key={r.id} className="friend">
                  <Avatar user={r.user} size={36} status={r.type === 1 ? "" : null} />
                  <div className="ellipsis"><strong>{displayName(r.user)}</strong> <span className="muted small">@{r.user.username}</span>
                    <small className="block muted">{r.type === 3 ? "Incoming friend request" : r.type === 4 ? "Outgoing friend request" : r.type === 2 ? "Blocked" : statusLabel(presences[r.id] ?? "offline")}</small></div>
                  <div className="friend-actions">
                    {r.type === 1 && <button className="icon-btn" aria-label={`Message ${displayName(r.user)}`} onClick={() => openDm(r.id)}><MessageSquare size={18} /></button>}
                    {r.type === 3 && <button className="icon-btn ok" aria-label="Accept" onClick={() => act(() => api.put(`/api/users/@me/relationships/${r.id}`, { type: 1 }))}><Check size={18} /></button>}
                    {(r.type === 3 || r.type === 4) && <button className="icon-btn danger" aria-label={r.type === 3 ? "Decline" : "Cancel request"} onClick={() => act(() => api.del(`/api/users/@me/relationships/${r.id}`))}><X size={18} /></button>}
                    {r.type === 1 && <button className="icon-btn" aria-label="Remove friend" onClick={async () => (await askConfirm({ title: `Remove ${displayName(r.user)}?`, body: "You can send a new friend request later.", confirmLabel: "Remove friend", danger: true })) && act(() => api.del(`/api/users/@me/relationships/${r.id}`))}><UserMinus size={18} /></button>}
                    {r.type !== 2 && <button className="icon-btn" aria-label="Block" onClick={async () => (await askConfirm({ title: `Block ${displayName(r.user)}?`, body: "They won't be able to message or call you, and won't be told.", confirmLabel: "Block", danger: true })) && act(() => api.put(`/api/users/@me/relationships/${r.id}`, { type: 2 }))}><Shield size={18} /></button>}
                    {r.type === 2 && <button className="btn sm" onClick={() => act(() => api.del(`/api/users/@me/relationships/${r.id}`))}>Unblock</button>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function AddFriend() {
  const [name, setName] = useState(""); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form className="add-friend" onSubmit={async (e) => {
      e.preventDefault();
      try { await api.post("/api/users/@me/relationships", { username: name.trim().replace(/^@/, "") }); setMsg({ ok: true, text: `Friend request sent to @${name}.` }); setName(""); }
      catch (x) { setMsg({ ok: false, text: errMsg(x) }); }
    }}>
      <h2>Add a friend</h2>
      <p className="muted">Add someone by their username. Usernames aren't case-sensitive.</p>
      <div className="add-row">
        <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setMsg(null); }} placeholder="username" aria-label="Username" maxLength={33} />
        <button className="btn primary" disabled={!name.trim()}>Send request</button>
      </div>
      {msg && <p className={msg.ok ? "ok-text" : "danger-text"} role="status">{msg.text}</p>}
    </form>
  );
}
