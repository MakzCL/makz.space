import { useId, type CSSProperties } from "react";
import { collectionById, type Collection } from "./collections.ts";

/** Original vector artwork, shared by avatars, gallery previews and profile frames. */
function Ornament({ motif }: { motif: Collection["motif"] }) {
  switch (motif) {
    case "moon": return <><circle r="13" fill="none" stroke="currentColor" strokeWidth=".6"/><path d="M5-13C-15-15-19 12-1 15C-10 4-6-7 5-13Z" fill="var(--art-fill)"/><circle cx="-7" cy="-3" r="2.5" fill="var(--art-dark)"/><circle cx="-4" cy="8" r="1.5" fill="var(--art-dark)"/></>;
    case "rose": return <><path d="M0-15C15-19 20-2 11 7C15 20-3 22-10 12C-24 12-22-7-10-10C-10-19-2-20 0-15Z" fill="var(--art-dark)" stroke="currentColor"/><path d="M0-10C12-13 15 3 6 8C-4 17-15 6-10-3C-5-12 5-7 5-1C5 7-6 8-5 1C-4-3 2-4 2 0" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M-11 12l-15 3 9 8Z M11 9l15-2-7 14Z" fill="var(--art-fill)" opacity=".65"/></>;
    case "butterfly": return <><path d="M0 0C-30-30-34 4-9 5C-30 25-4 29 0 7C4 29 30 25 9 5C34 4 30-30 0 0Z" fill="var(--art-fill)" fillOpacity=".55" stroke="currentColor"/><path d="M0-3v16M0-2l-4-6M0-2l4-6M-3 3l-15-10M3 3l15-10" fill="none" stroke="var(--art-light)" strokeWidth=".7"/></>;
    case "flame": return <><path d="M-9 15C-27 0-4-5-6-23C13-12 3-4 13-10C30 15 5 26-9 15Z" fill="var(--art-fill)"/><path d="M-3 13C-12 4 3 0 2-9C17 9 6 22-3 13Z" fill="var(--art-light)"/></>;
    case "crystal": return <><path d="M0-25L12-8 8 17 0 26-8 17-12-8Z" fill="var(--art-fill)" fillOpacity=".3" stroke="currentColor"/><path d="M0-25v51M-12-8L0-2 12-8M-8 17L0-2 8 17" fill="none" stroke="var(--art-light)" strokeWidth=".65"/><path d="M-17 0l6 7-3 14-6-9Z M17 0l-6 7 3 14 6-9Z" fill="var(--art-fill)" opacity=".65"/></>;
    case "blossom": return <><path d="M0 1C-28-9-17-28-4-12C-9-36 15-30 9-10C29-25 36-2 14 1C35 15 15 34 6 13C-1 38-23 25-8 10C-33 15-35-10-12-5Z" fill="var(--art-fill)" fillOpacity=".8"/><circle r="3" fill="var(--art-light)"/>{[0,72,144,216,288].map(a=><path key={a} transform={`rotate(${a})`} d="M0 1L0-9M-2-10h4" stroke="var(--art-light)" strokeWidth=".6"/>)}</>;
    case "wave": return <><path d="M-25 13C-12-4-13-25 6-20C28-14 16 10 3 1C20 3 16-16 4-12C-10-7 4 7 12 11C-3 5-9 27-25 13Z" fill="var(--art-fill)" fillOpacity=".55" stroke="currentColor"/><path d="M-21 14C-8 16-7 6 1 6M-11 3C-11-21 18-22 14-6" fill="none" stroke="var(--art-light)"/></>;
    case "thorn": return <><path d="M-22 16C-5 14-16-11-3-16C11-22 23-9 12 0C-1 9-10 0-5-6C6-17 14 1 5 10C-2 17 2 26 16 21" fill="none" stroke="currentColor" strokeWidth="5"/><path d="M-13 7l-13-8 12 1M-6-15l-2-14 6 13M14-11l12-6-10 11M5 13l12 3-14 1" fill="var(--art-fill)"/><circle cx="5" cy="-9" r="1.5" fill="var(--art-light)"/></>;
    case "star": return <><path d="M0-24L5-5 24 0 5 5 0 24-5 5-24 0-5-5Z" fill="var(--art-fill)"/><path d="M-13-13L13 13M13-13L-13 13" stroke="currentColor" strokeWidth=".5"/><circle r="8" stroke="var(--art-light)" fill="none" strokeWidth=".5"/></>;
    case "filigree": return <><path d="M0 24V-15C0-36-30-14-12-8C3-2-2-29 17-20C35-11 5 9 12-9M0 7C-28-5-28 22-9 17C7 12-12-6-21 4M0 17C25 3 30 24 11 23" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M0-26l4 7-4 6-4-6Z" fill="var(--art-fill)"/></>;
    case "vine": return <><path d="M0-27C-15-5 15 4-3 28" fill="none" stroke="currentColor"/>{[-17,-6,5,16].map((y,i)=><g key={y} transform={`translate(${i%2?3:-3} ${y}) scale(${i%2?-1:1} 1)`}><path d="M0 0Q-23-18-20-3Q-18 10 0 0Z" fill="var(--art-fill)" opacity=".8"/><path d="M-2 1Q-8 19 0 25Q7 14-2 1Z" fill="var(--art-fill)" opacity=".5"/></g>)}</>;
    case "ghost": return <><path d="M-15 16C-3 1-18-15 0-21C26-22 13 4 25 15C17 28 8 4 1 15C-9 30-9 14-15 16Z" fill="var(--art-fill)" fillOpacity=".5" stroke="currentColor"/><path d="M0-8v4M7-9v4" stroke="var(--art-dark)" strokeWidth="2"/><path d="M-28 14Q-8-9 28 2" fill="none" stroke="currentColor" opacity=".5"/></>;
  }
}
export function CollectionArt({ id, frame = false, animate = true }: { id?: string | null; frame?: boolean; animate?: boolean }) {
  const c = collectionById(id), uid = useId().replace(/:/g, "");
  if (!c) return null;
  return <svg aria-hidden="true" className={`collection-art ${frame ? "collection-frame" : "collection-avatar"} ${animate ? "" : "art-still"} art-${c.motif} motion-${c.motion ?? "shimmer"}`} viewBox={frame ? "0 0 300 420" : "0 0 140 140"} preserveAspectRatio={frame ? "none" : "xMidYMid meet"} style={{ color: c.primary, "--art-dark": c.secondary, "--art-light": "#FFF9EF", "--art-fill": `url(#${uid}-metal)` } as CSSProperties}>
    <defs><linearGradient id={uid} x1="0" y1="0" x2="1" y2="1"><stop stopColor={c.primary}/><stop offset=".5" stopColor={c.secondary}/><stop offset="1" stopColor={c.primary}/></linearGradient><linearGradient id={`${uid}-metal`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#FFF9EF"/><stop offset=".2" stopColor={c.primary}/><stop offset=".48" stopColor={c.secondary}/><stop offset=".65" stopColor={c.primary}/><stop offset="1" stopColor={c.secondary}/></linearGradient></defs>
    {c.art && <>
      <defs><clipPath id={`${uid}-cover`}><rect x={frame?12:4} y={frame?12:92} width={frame?276:42} height={frame?104:42} rx={frame?20:14}/></clipPath></defs>
      <image className={`collection-source-art source-${c.artKind}`} href={c.art} x={frame?12:4} y={frame?12:92} width={frame?276:42} height={frame?104:42} preserveAspectRatio={c.artKind==="logo"?"xMidYMid meet":"xMidYMid slice"} clipPath={`url(#${uid}-cover)`}/>
    </>}
    {frame ? <>
      <path d="M42 8H258Q292 8 292 42V378Q292 412 258 412H42Q8 412 8 378V42Q8 8 42 8Z" fill="none" stroke={`url(#${uid})`} strokeWidth="1.3"/>
      <path d="M50 15H250M285 60V360M250 405H50M15 360V60" fill="none" stroke="currentColor" strokeWidth=".35" opacity=".65"/>
      {[{x:19,y:22,r:-35,s:.9},{x:281,y:25,r:35,s:.75},{x:280,y:394,r:140,s:.8},{x:21,y:396,r:215,s:.7}].map((p,i)=><g className={`art-ornament art-o${i}`} key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.r}) scale(${p.s})`}><Ornament motif={c.motif}/></g>)}
      <path d="M30 70Q-5 120 14 160M285 270Q310 330 275 360" fill="none" stroke="currentColor" opacity=".4"/>
      <g className="art-dust">{Array.from({length:14},(_,i)=><path key={i} d="M0-3V3M-3 0H3" transform={`translate(${i%2?280-(i*19)%80:18+(i*13)%60} ${44+i*24})`} stroke="currentColor" strokeWidth={i%3===0?1:.4}/>)}</g>
    </> : <>
      <circle cx="70" cy="70" r="53" fill="none" stroke={`url(#${uid})`} strokeWidth="2" strokeDasharray={c.motif==="star"?"2 4":"155 12 70 8"}/>
      <circle cx="70" cy="70" r="57" fill="none" stroke="currentColor" strokeWidth=".45" opacity=".65"/>
      <path d="M25 30Q0 65 25 99M115 40Q141 75 114 112" fill="none" stroke="currentColor" strokeWidth="1.3"/>
      {[{x:29,y:109,r:-35,s:.8},{x:110,y:28,r:30,s:.67},{x:119,y:96,r:135,s:.45}].map((p,i)=><g className={`art-ornament art-o${i}`} key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.r}) scale(${p.s})`}><Ornament motif={c.motif}/></g>)}
      <g className="art-dust"><path d="M32 14v10M27 19h10M125 58v7M121.5 61.5h7M65 125v8M61 129h8" stroke="currentColor" strokeWidth=".8"/><circle cx="10" cy="74" r="1.5" fill="var(--art-fill)"/><circle cx="86" cy="11" r="1" fill="var(--art-fill)"/></g>
    </>}
  </svg>;
}
