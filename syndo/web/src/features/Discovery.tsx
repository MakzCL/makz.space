import { useEffect, useState } from "react";
import { Compass, Search, Users } from "lucide-react";
import { api, errMsg } from "../api.ts";
import { navigate, setTitle } from "../router.ts";
import { toast } from "../store.ts";
import { MobileNavButton } from "../components/ui.tsx";

const CATS = [["", "Home"], ["gaming", "Gaming"], ["music", "Music"], ["education", "Education"], ["science", "Science & Tech"], ["entertainment", "Entertainment"], ["creative", "Creative arts"], ["technology", "Technology"], ["anime", "Anime"], ["sports", "Sports"], ["community", "Community"], ["language", "Language"], ["other", "Other"]] as const;
interface Server { id: string; name: string; icon: string | null; banner: string | null; description: string | null; category: string | null; member_count: number; online_count: number; premium_tier: number; tag: string | null; joined: boolean }

/** Server Discovery: public servers that chose to be listed. */
export function Discovery() {
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<Server[] | null>(null);
  useEffect(() => setTitle("Discover"), []);
  useEffect(() => {
    const t = setTimeout(() => api.get<Server[]>(`/api/discovery?${new URLSearchParams({ q, ...(cat ? { category: cat } : {}) })}`).then(setList).catch(() => setList([])), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, cat]);
  const join = async (s: Server) => {
    if (s.joined) return navigate(`/channels/${s.id}`);
    try { await api.post(`/api/discovery/${s.id}/join`); navigate(`/channels/${s.id}`); } catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <div className="discover">
      <aside className="discover-cats" aria-label="Categories"><h2><Compass size={20} /> Discover</h2>{CATS.map(([id, label]) => <button key={id} className={`side-link ${cat === id ? "active" : ""}`} onClick={() => setCat(id)}>{label}</button>)}</aside>
      <section className="discover-main">
        <header className="discover-hero"><MobileNavButton /><h1 className="t">Find your community on SEND</h1><p>From gaming, to music, to learning, there's a place for you.</p>
          <div className="discover-search"><Search size={18} /><input placeholder="Explore communities" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search servers" /></div></header>
        {!list ? <p className="muted pad">Loading…</p> : !list.length ? <p className="muted pad">No servers here yet. Server owners can list theirs in Server settings → Discovery.</p> : (
          <div className="discover-grid">{list.map((s) => (
            <button key={s.id} className="discover-card" onClick={() => join(s)}>
              <div className="dc-banner" style={s.banner ? { backgroundImage: `url("${s.banner}")` } : undefined}>{s.icon ? <img src={s.icon} alt="" /> : <span className="rail-initials">{s.name.slice(0, 2)}</span>}</div>
              <div className="dc-b"><strong className="ellipsis">{s.name}{s.tag && <span className="tag">{s.tag}</span>}</strong><p className="muted small">{s.description}</p>
                <span className="muted small"><i className="dot on" /> {s.online_count} online · <Users size={12} /> {s.member_count} members{s.premium_tier ? ` · ✨ Level ${s.premium_tier}` : ""}</span>
                <span className="btn sm">{s.joined ? "Open" : "Join"}</span></div>
            </button>))}</div>
        )}
      </section>
    </div>
  );
}
