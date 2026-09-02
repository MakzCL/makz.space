"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";

type Route = "home" | "work" | "live" | "gaming" | "support";
type WorkFilter = "all" | "design" | "systems";

type LiveState = {
  phase: "checking" | "online" | "offline" | "unavailable";
  viewers: number;
  title: string | null;
  description: string | null;
};

type MinecraftState = {
  phase: "checking" | "online" | "offline" | "unavailable";
  players: string;
  version: string;
};

type JsonRecord = Record<string, unknown>;

const routes: Array<{ id: Route; label: string; index: number }> = [
  { id: "home", label: "Home", index: 0 },
  { id: "work", label: "Work", index: 1 },
  { id: "live", label: "Live", index: 2 },
  { id: "gaming", label: "Gaming", index: 3 },
  { id: "support", label: "Support", index: 4 },
];

const works = [
  {
    category: "design",
    index: "01 / 26",
    title: ["Land of", "Plenty"],
    label: "Brand strategy · identity · delivery",
    copy: "A leisure and lifestyle brand that makes sustainable routines feel considered, joyful and real.",
    mark: "RITUAL",
  },
  {
    category: "systems",
    index: "02 / WIP",
    title: ["Home", "Assistant"],
    label: "Custom smart-home system",
    copy: "An active home-control environment being shaped around actual routines and hardware.",
    mark: "HA",
  },
] as const;

const owncastUrl = process.env.NEXT_PUBLIC_OWNCAST_URL ?? "https://stream.makz.space";

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : {};
}

function readNumber(record: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function readText(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normaliseRoute(value: string): Route {
  return routes.some((route) => route.id === value) ? (value as Route) : "home";
}

function routeFromHash() {
  return normaliseRoute(window.location.hash.replace("#", ""));
}

function statusLabel(live: LiveState) {
  if (live.phase === "online") return `Live · ${live.viewers} ${live.viewers === 1 ? "viewer" : "viewers"}`;
  if (live.phase === "checking") return "Checking live";
  return "Off air";
}

export function MakzApp() {
  const [route, setRoute] = useState<Route>("home");
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [accountOpen, setAccountOpen] = useState(false);
  const [cinema, setCinema] = useState(false);
  const [live, setLive] = useState<LiveState>({ phase: "checking", viewers: 0, title: null, description: null });
  const [minecraft, setMinecraft] = useState<MinecraftState>({ phase: "checking", players: "—", version: "—" });
  const [fieldPoint, setFieldPoint] = useState({ x: 52, y: 46 });

  const activeRoute = routes.find((item) => item.id === route) ?? routes[0];
  const appStyle = { "--nav-index": activeRoute.index } as CSSProperties;

  useEffect(() => {
    const syncHash = () => setRoute(routeFromHash());
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    let current = true;
    const updateLive = async () => {
      try {
        const response = await fetch(`${owncastUrl.replace(/\/$/, "")}/api/status`, { cache: "no-store" });
        if (!response.ok) throw new Error("Live status unavailable");
        const data = asRecord(await response.json());
        const online = Boolean(data.online ?? data.isOnline ?? data.live ?? data.streamOnline);
        if (!current) return;
        setLive({
          phase: online ? "online" : "offline",
          viewers: readNumber(data, ["viewerCount", "viewers", "currentViewers", "viewer_count"]),
          title: readText(data, ["streamTitle", "title", "name"]),
          description: readText(data, ["streamDescription", "description"]),
        });
      } catch {
        if (current) setLive({ phase: "unavailable", viewers: 0, title: null, description: null });
      }
    };
    void updateLive();
    const timer = window.setInterval(() => void updateLive(), 15_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let current = true;
    const updateMinecraft = async () => {
      try {
        const response = await fetch("https://api.mcsrvstat.us/3/play.makz.space:25567", { cache: "no-store" });
        if (!response.ok) throw new Error("Minecraft status unavailable");
        const data = asRecord(await response.json());
        const players = asRecord(data.players);
        const online = Boolean(data.online);
        if (!current) return;
        setMinecraft({
          phase: online ? "online" : "offline",
          players: online ? `${readNumber(players, ["online"])} / ${readNumber(players, ["max"]) || "?"}` : "—",
          version: readText(data, ["version"]) ?? "Unavailable",
        });
      } catch {
        if (current) setMinecraft({ phase: "unavailable", players: "—", version: "Unavailable" });
      }
    };
    void updateMinecraft();
    const timer = window.setInterval(() => void updateMinecraft(), 120_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.body.dataset.cinema = cinema ? "true" : "false";
    return () => { delete document.body.dataset.cinema; };
  }, [cinema]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCinema(false);
        setAccountOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const visibleWorks = useMemo(
    () => works.filter((work) => filter === "all" || work.category === filter),
    [filter],
  );

  const navigate = (next: Route) => {
    window.location.hash = next;
    setCinema(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pointStyle = { "--pointer-x": `${fieldPoint.x}%`, "--pointer-y": `${fieldPoint.y}%` } as CSSProperties;

  return (
    <div className="app-shell" style={appStyle}>
      <a className="skip-link" href="#content">Skip to content</a>

      <header className="topline">
        <button className="wordmark" type="button" onClick={() => navigate("home")} aria-label="Go to makz.space home">
          MAKZ<span>.</span>SPACE
        </button>
        <p className="connection"><i className={live.phase === "online" ? "is-live" : ""} />{statusLabel(live)}</p>
      </header>

      <nav className="dock" aria-label="Primary navigation">
        <div className="dock-tabs" role="tablist" aria-label="Main sections">
          <span className="dock-indicator" aria-hidden="true" />
          {routes.map((item) => (
            <button
              key={item.id}
              className={route === item.id ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={route === item.id}
              onClick={() => navigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button className="profile-button" type="button" onClick={() => setAccountOpen(true)} aria-haspopup="dialog" aria-label="Open account panel">
          <span aria-hidden="true" />
        </button>
      </nav>

      <main id="content" className={`route route-${route}`} key={route}>
        {route === "home" && (
          <section className="home-view" aria-labelledby="home-title">
            <div className="home-copy route-enter">
              <p className="eyebrow">A working space on the internet</p>
              <h1 id="home-title">MAKE<br /><span>ROOM</span><br />FOR IT.</h1>
              <p className="lede">Visual experiments, broadcasts, game worlds and the useful things built around them.</p>
              <div className="action-row">
                <button className="action action-primary" type="button" onClick={() => navigate("work")}>Open work</button>
                <button className="action" type="button" onClick={() => navigate("live")}>Watch live</button>
              </div>
            </div>
            <div
              className="field-object route-enter"
              style={pointStyle}
              onPointerMove={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setFieldPoint({ x: ((event.clientX - box.left) / box.width) * 100, y: ((event.clientY - box.top) / box.height) * 100 });
              }}
              aria-label="Interactive MAKZ mark"
            >
              <p>Field object / 01<br />Move close.</p>
              <strong aria-hidden="true">M</strong>
              <small>It settles when you leave.</small>
            </div>
            <div className="home-foot route-enter">
              <p><i className={live.phase === "online" ? "status-live" : ""} />{live.phase === "online" ? `${live.viewers} people are watching now.` : "The broadcast room is quiet."}</p>
              <button className="underlined" type="button" onClick={() => navigate("support")}>Find Makz online <b>↗</b></button>
            </div>
          </section>
        )}

        {route === "work" && (
          <section className="content-view" aria-labelledby="work-title">
            <div className="page-head route-enter">
              <div><p className="eyebrow">Work index / 2026</p><h1 id="work-title">THE WORK<br />THAT&apos;S READY.</h1></div>
              <p>Only public projects with real context live here. Active work stays out of view until it has something useful to say.</p>
            </div>
            <div className="filters route-enter" aria-label="Filter work">
              {(["all", "design", "systems"] as WorkFilter[]).map((item) => (
                <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>
              ))}
            </div>
            <div className="work-list route-enter">
              {visibleWorks.map((work) => (
                <article className="work-row" key={work.index}>
                  <span>{work.index}</span>
                  <div><h2>{work.title.map((line) => <span key={line}>{line}<br /></span>)}</h2><small>{work.label}</small></div>
                  <div className={`work-mark work-mark-${work.category}`} aria-hidden="true">{work.mark}</div>
                  <p>{work.copy}</p>
                </article>
              ))}
            </div>
            {!visibleWorks.length && <p className="empty-state">Nothing has been published in this filter yet.</p>}
          </section>
        )}

        {route === "live" && (
          <section className="live-view" aria-labelledby="live-title">
            <div className="page-head route-enter live-head">
              <div><p className="eyebrow">Broadcast room</p><h1 id="live-title">LIVE, WHEN<br />IT&apos;S LIVE.</h1></div>
              <p>The player checks the real Owncast status. It does not invent a schedule, viewer count or upcoming broadcast.</p>
            </div>
            <div className="broadcast-layout route-enter">
              <section className={`broadcast ${live.phase === "online" ? "is-online" : ""}`} aria-label="Makz livestream player">
                <div className="live-label"><i className={live.phase === "online" ? "is-live" : ""} />{statusLabel(live)}</div>
                {live.phase === "online" ? (
                  <video className="stream-player" src={`${owncastUrl.replace(/\/$/, "")}/hls/stream.m3u8`} controls autoPlay muted playsInline />
                ) : (
                  <div className="off-air"><span>Channel status / off air</span><h2>OFF<br />AIR.</h2><p>{live.phase === "unavailable" ? "The stream status could not be reached. You can still open the channel directly." : "The broadcast room will wake when the channel comes online."}</p><div className="level-bars" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--bar": `${28 + ((index * 19) % 64)}%`, "--delay": `${index * 0.11}s` } as CSSProperties} />)}</div></div>
                )}
                <button className="cinema-close action" type="button" onClick={() => setCinema(false)}>Exit cinema</button>
              </section>
              <aside className="live-sidebar">
                <section className="info-panel"><h2>{live.phase === "online" ? live.title ?? "ON AIR" : "CHANNEL STATUS"}</h2><p>{live.phase === "online" ? live.description ?? "The broadcast is live now." : "This is a designed quiet state, not a blank player."}</p><dl><div><dt>State</dt><dd>{live.phase === "online" ? "Live now" : "Off air"}</dd></div><div><dt>Viewers</dt><dd>{live.phase === "online" ? live.viewers : "—"}</dd></div><div><dt>Channel</dt><dd><a href={owncastUrl} target="_blank" rel="noreferrer">Open Owncast ↗</a></dd></div></dl><button className="action cinema-open" type="button" onClick={() => setCinema(true)}>Cinema mode</button></section>
                <section className="chat-panel"><header><strong>CHAT</strong><span>Owncast</span></header><iframe src={`${owncastUrl.replace(/\/$/, "")}/embed/chat/readwrite`} title="Makz livestream chat" loading="lazy" /></section>
              </aside>
            </div>
          </section>
        )}

        {route === "gaming" && (
          <section className="content-view" aria-labelledby="gaming-title">
            <div className="page-head route-enter"><div><p className="eyebrow">Gaming / environments</p><h1 id="gaming-title">PLACES<br />TO PLAY.</h1></div><p>Configured spaces only. No made-up activity counters, games or server details.</p></div>
            <div className="gaming-grid route-enter">
              <article className="game-card minecraft-card"><span>01 / Minecraft</span><h2>MAKZ<br />MC</h2><p>A growing network for custom worlds, community play and the live map.</p><dl><div><dt>Server</dt><dd>play.makz.space:25567</dd></div><div><dt>State</dt><dd>{minecraft.phase === "online" ? "Online" : minecraft.phase === "checking" ? "Checking" : "Unavailable"}</dd></div><div><dt>Players</dt><dd>{minecraft.players}</dd></div><div><dt>Version</dt><dd>{minecraft.version}</dd></div></dl><a className="underlined" href="https://map.makz.space" target="_blank" rel="noreferrer">Open live map <b>↗</b></a></article>
              <article className="game-card convoy-card"><span>02 / Euro Truck Simulator 2</span><h2>ETS2<br />CONVOY</h2><p>An organised multiplayer environment for shared routes and cinematic drives.</p><dl><div><dt>Mode</dt><dd>Convoy / Vanilla+</dd></div><div><dt>Traffic</dt><dd>Enabled</dd></div><div><dt>Language</dt><dd>EN / PL</dd></div><div><dt>Access</dt><dd>Ask in community</dd></div></dl><button className="underlined" type="button" onClick={() => navigate("support")}>Community route <b>↗</b></button></article>
            </div>
            <div className="quiet-state route-enter"><h2>CURRENTLY<br />PLAYING</h2><p>No current game is published here. This space stays empty until there is something real to add.</p></div>
          </section>
        )}

        {route === "support" && (
          <section className="content-view" aria-labelledby="support-title">
            <div className="support-split route-enter"><div><p className="eyebrow">Community / contact</p><h1 id="support-title">STAY IN<br />THE LOOP.</h1><p className="lede">The public support route is community-first. Follow the work, streams and server activity where they already live.</p></div><div className="plus-object" aria-hidden="true"><span>Community<br />line / 01</span><strong>+</strong></div></div>
            <div className="support-list route-enter">
              <a href="https://discord.gg/mTPNyBdPSU" target="_blank" rel="noreferrer"><span>D</span><div><h2>Discord</h2><p>Announcements, conversation and server-related updates.</p></div><b>Join ↗</b></a>
              <a href="https://www.twitch.tv/motomakz" target="_blank" rel="noreferrer"><span>T</span><div><h2>Twitch</h2><p>Livestreams and replays from the broadcast room.</p></div><b>Watch ↗</b></a>
              <a href="https://www.instagram.com/moto.makz/" target="_blank" rel="noreferrer"><span>I</span><div><h2>Instagram</h2><p>Updates, bike bits and selected frames.</p></div><b>Follow ↗</b></a>
            </div>
          </section>
        )}
      </main>

      <footer><span>© {new Date().getFullYear()} makz.space</span><span>Built to move with purpose.</span></footer>

      {accountOpen && (
        <div className="account-backdrop" role="presentation" onMouseDown={() => setAccountOpen(false)}>
          <section className="account-sheet" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><p className="eyebrow">Account surface</p><button type="button" onClick={() => setAccountOpen(false)} aria-label="Close account panel">×</button></header>
            <h2 id="account-title">ACCESS<br />IS PRIVATE.</h2>
            <p>No sign-in is shown until a real authentication service is configured. This public build does not collect credentials or imitate an account system.</p>
            <button className="action action-primary" type="button" onClick={() => { setAccountOpen(false); navigate("support"); }}>Community & contact</button>
          </section>
        </div>
      )}
    </div>
  );
}

