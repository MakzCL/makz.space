/**
 * /fx: a public preview of profile cosmetics on the real profile card and renderer, with a sample person.
 *   /fx?ids=a,b,c        those bundles          /fx?c=cyber      one collection (24 bundles)
 *   &anim=0              still frames           &w=300           card width
 * Used by the store's share links and by the visual QA that renders every bundle.
 */
import { useMemo } from "react";
import { COSMETIC_COLLECTIONS, type User } from "@send/shared";
import { COLLECTIONS, collectionTheme } from "./collections.ts";
import { ProfileCardView } from "./ProfileEditor.tsx";

/** A neutral sample avatar (soft portrait silhouette), so previews don't depend on anyone's photo. */
export const SAMPLE_AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b4a6b"/><stop offset="1" stop-color="#1a2030"/></linearGradient><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9d5c4"/><stop offset="1" stop-color="#c9a892"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="60" cy="50" r="22" fill="url(#s)"/><path d="M60 26c-14 0-24 9-24 22 0 3 1 6 2 8 2-9 9-15 22-15s20 6 22 15c1-2 2-5 2-8 0-13-10-22-24-22z" fill="#2a2320"/><path d="M18 120c3-24 20-36 42-36s39 12 42 36z" fill="#d9dee8"/></svg>`)}`;

export default function FxLab() {
  const q = new URLSearchParams(location.search);
  const anim = q.get("anim") !== "0", w = Number(q.get("w")) || 300;
  if (q.get("t")) (window as any).__fxPreroll = Number(q.get("t"));
  const list = useMemo(() => {
    const ids = q.get("ids")?.split(",").filter(Boolean), c = q.get("c");
    return ids ? COLLECTIONS.filter((x) => ids.includes(x.id)) : c ? COLLECTIONS.filter((x) => x.collectionId === c) : COLLECTIONS.filter((x) => x.flagship);
  }, []); // eslint-disable-line
  const user = { id: "100", username: "sendpreview", display_name: "Alex Rivera", avatar: SAMPLE_AVATAR, banner: null, bio: "", pronouns: "they/them", accent_color: null, profile_theme: null, bot: false } as unknown as User;
  const col = COSMETIC_COLLECTIONS.find((c) => c.id === q.get("c"));
  return (
    <main className="fx-lab" data-ready="1">
      {col && <header><h1>{col.name}</h1><p className="muted">{col.blurb}</p></header>}
      <div className="fx-lab-grid" style={{ "--fxw": `${w}px` } as React.CSSProperties}>
        {list.map((c) => (
          <figure key={c.id} className="fx-lab-cell" data-id={c.id}>
            <div className="profile-card fx-lab-card" style={{ width: w }}>
              <ProfileCardView d={{ user: { ...user, profile_theme: collectionTheme(c) } as User, name: "Alex Rivera", username: "alex", pronouns: "they/them", bio: "Designer, night owl, collector of nice things.", avatar: SAMPLE_AVATAR, banner: null, theme: collectionTheme(c), status: null }}
                serverTheme={{ ...collectionTheme(c), ...(anim ? {} : {}) }} statusDot="online" />
            </div>
            <figcaption><strong>{c.name}</strong>{c.flagship && <span className="fx-flag">Flagship</span>}<small>{c.id}</small></figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
