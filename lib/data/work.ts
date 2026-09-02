import type { WorkRecord } from "@/types";

const IB = "https://i.ibb.co";

/**
 * Records, not "projects". Each one is a real body of work with its own
 * page. Ordering is editorial, not chronological.
 */
export const WORK: WorkRecord[] = [
  {
    slug: "land-of-plenty",
    index: "01",
    title: "RITUAL",
    subtitle: "Land Of Plenty — a leisure brand that asks for less",
    discipline: ["Brand Strategy", "Brand Identity", "Brand Delivery"],
    year: "2026",
    status: "shipped",
    client: "VIS6041 — Birmingham City University",
    role: "Strategy, identity, art direction, delivery",
    summary:
      "A brand in leisure and lifestyle that is considerate towards the planet without turning restraint into guilt. RITUAL builds the whole system around one idea — make more of less — and carries it from positioning through to refillable packaging, launch campaign and product.",
    cover: {
      src: `${IB}/Z6DsR6gs/hq-makz-space.jpg`,
      alt: "RITUAL brand identity board",
      aspect: "16 / 10",
      fit: "cover",
      meta: "Identity board",
    },
    gallery: [
      {
        src: `${IB}/Z6DsR6gs/hq-makz-space.jpg`,
        alt: "RITUAL identity system overview",
        aspect: "16 / 10",
        fit: "cover",
        caption: "Identity system — mark, palette and secondary language.",
        meta: "01",
      },
      {
        src: `${IB}/jkhTKtLk/MAKZ-SPACE-BG.png`,
        alt: "RITUAL applied across surfaces",
        aspect: "16 / 9",
        fit: "cover",
        caption: "Applied across packaging, campaign and digital surfaces.",
        meta: "02",
      },
    ],
    stack: [
      "Brand strategy",
      "Naming",
      "Identity design",
      "Packaging",
      "Campaign",
      "Digital product",
    ],
    sections: [
      {
        index: "01",
        heading: "The brief",
        body: [
          "Design a brand in the world of leisure and lifestyle that is considerate towards the planet, but still emotionally appealing and joyful.",
          "The trap in this category is obvious and everywhere: sustainability sold as sacrifice. Muted palettes, kraft paper, a lecture on the back of the box. The work started by refusing that — the planet-positive part had to be the reason the brand feels good, not the tax you pay for buying it.",
        ],
        aside: [
          { label: "Module", value: "VIS6041" },
          { label: "Institution", value: "Birmingham City University" },
          { label: "Stages", value: "Three" },
        ],
      },
      {
        index: "02",
        heading: "Strategy",
        body: [
          "Stage one defined the business idea, audience, purpose, mission, values and name. The audience buys intentionally rather than frequently: they want fewer, better things and a routine worth keeping.",
          "They respond to minimal design, wellbeing routines, premium packaging and brands that mean something. They actively reject wasteful products, loud branding, guilt-based sustainability and cheap-looking eco clichés — which is a sharper brief than any positive list.",
          "That contradiction produced the name. A ritual is small, repeated and deliberate. It is the opposite of consumption by volume.",
        ],
        aside: [
          { label: "Values", value: "Intentional living" },
          { label: "", value: "Sustainability" },
          { label: "", value: "Emotional wellbeing" },
          { label: "", value: "Community and connection" },
        ],
      },
      {
        index: "03",
        heading: "Identity",
        body: [
          "Stage two turned the position into a visual system: logo direction, colour, typography, secondary marks and tone of voice.",
          "The mark is set as a wordmark with wide, even spacing so it reads as a label rather than a logo — something that belongs on a refill jar that stays on a shelf for years. Colour stays close to raw material. Typography does the emotional work.",
          "Tone of voice is calm and specific. It never says 'save the planet'. It says what the product is, what it is made of, and how long it lasts.",
        ],
      },
      {
        index: "04",
        heading: "Delivery",
        body: [
          "Stage three proved the brand in the real world across three touchpoints: refillable packaging, a launch campaign and a digital product.",
          "Packaging is the argument — a vessel you keep and a refill you replace. The campaign leads with the big idea rather than the category. The website and app hold the routine, so the brand has a reason to exist between purchases.",
        ],
        aside: [
          { label: "01", value: "Refillable packaging" },
          { label: "02", value: "Launch campaign" },
          { label: "03", value: "Website / app" },
        ],
      },
      {
        index: "05",
        heading: "Reflective journal",
        body: [
          "The submission is a 40-plus slide reflective visual journal mapping the whole process: brief and concept direction, sector and audience research, purpose and positioning, logo and identity development, then packaging, campaign, digital application and final rationale.",
        ],
      },
    ],
    timeline: [
      { phase: "01", label: "Brief & concept", detail: "Challenge, initial thinking, concept direction" },
      { phase: "02", label: "Research", detail: "Sector, audience, strategy and naming" },
      { phase: "03", label: "Positioning", detail: "Purpose, values, tone of voice, big idea" },
      { phase: "04", label: "Identity", detail: "Logo development, colour, typography, system" },
      { phase: "05", label: "Delivery", detail: "Packaging, campaign, digital, rationale" },
    ],
    credits: [{ role: "Design & strategy", name: "Karol Kuklinski" }],
    links: [],
  },
  {
    slug: "makzmc",
    index: "02",
    title: "MAKZMC",
    subtitle: "A Minecraft network built like a product, not a server",
    discipline: ["Systems", "Infrastructure", "Web"],
    year: "2025 — ongoing",
    status: "active",
    client: "MAKZ",
    role: "Design, server engineering, web integration",
    summary:
      "MakzMC [Unbound] is a modded survival network with its own worlds, a live web map, a public status surface and a modpack pipeline. The server and the website are one system: what happens in-game is queryable from the browser.",
    cover: {
      src: `${IB}/MxNWWFMp/makzmc-thumbnail.png`,
      alt: "MakzMC network key art",
      aspect: "16 / 9",
      fit: "cover",
      meta: "Network key art",
    },
    gallery: [
      {
        src: `${IB}/yL111TC/makzmc-webbg.png`,
        alt: "MakzMC world render",
        aspect: "16 / 9",
        fit: "cover",
        caption: "Unbound — expanded gameplay on a base Minecraft identity.",
        meta: "01",
      },
      {
        src: `${IB}/GvbnqpRh/makzmc-webbg2.png`,
        alt: "MakzMC terrain generation",
        aspect: "16 / 9",
        fit: "cover",
        caption: "YUNG and Terralith worldgen driving the survival loop.",
        meta: "02",
      },
      {
        src: `${IB}/5VC0GXm/m-server.png`,
        alt: "MakzMC server branding",
        aspect: "1 / 1",
        fit: "contain",
        caption: "Server mark.",
        meta: "03",
      },
    ],
    stack: [
      "Modded survival",
      "YUNG",
      "Terralith",
      "Live web map",
      "Status API",
      "Modpack distribution",
    ],
    sections: [
      {
        index: "01",
        heading: "The idea",
        body: [
          "Most community servers are a Discord invite and an IP. MakzMC is built so someone can understand the whole thing before they ever launch the game: what is running, who is on it, what the world looks like, and how to get the modpack.",
          "Expanded gameplay with extra features while keeping the base Minecraft identity — no total conversion, no thousand-mod soup.",
        ],
        aside: [
          { label: "Address", value: "play.makz.space" },
          { label: "Focus", value: "Modded survival" },
          { label: "Worldgen", value: "YUNG / Terralith" },
        ],
      },
      {
        index: "02",
        heading: "Web integration",
        body: [
          "The network exposes a live status probe and a dynamic map. Both are surfaced on this site through a server-side proxy, so player counts, version and reachability are real data rather than a screenshot that rots.",
          "The map runs on its own subdomain and opens full-bleed rather than inside a widget — the world is the interface.",
        ],
      },
      {
        index: "03",
        heading: "Community",
        body: [
          "Built to feel polished, readable and welcoming whether someone is joining once or staying long-term. Different worlds and modes get their own identity, maps and progression style instead of being folded into a single lobby.",
        ],
      },
    ],
    timeline: [
      { phase: "01", label: "Network design", detail: "Worlds, modes, progression identity" },
      { phase: "02", label: "Modpack", detail: "Curated feature set on a vanilla spine" },
      { phase: "03", label: "Web layer", detail: "Live map, status probe, public pages" },
      { phase: "04", label: "Operations", detail: "Ongoing hosting, updates, community" },
    ],
    credits: [{ role: "Design & operations", name: "Karol Kuklinski" }],
    links: [
      { label: "Live map", href: "https://map.makz.space", external: true },
      { label: "Modpack", href: "https://modsfire.com/54uN4r1VHFnNBeK", external: true },
      { label: "Discord", href: "https://discord.gg/mTPNyBdPSU", external: true },
      { label: "Server status", href: "/gaming" },
    ],
  },
  {
    slug: "broadcast",
    index: "03",
    title: "BROADCAST",
    subtitle: "A self-hosted stream stack with no ads and no platform",
    discipline: ["Infrastructure", "Interface", "Video"],
    year: "2025 — ongoing",
    status: "ongoing",
    client: "MAKZ",
    role: "Architecture, player interface, operations",
    summary:
      "An independent broadcast running on owned infrastructure: ingest, HLS delivery, chat and a status API on stream.makz.space, with a custom player surface instead of an embed. No ads, no recommendation feed, no platform deciding who sees it.",
    cover: {
      src: `${IB}/vCgJ75ks/makz-sp-1.jpg`,
      alt: "Broadcast still",
      aspect: "16 / 9",
      fit: "cover",
      meta: "Broadcast still",
    },
    gallery: [
      { src: `${IB}/vCgJ75ks/makz-sp-1.jpg`, alt: "Stream still one", aspect: "16 / 9", fit: "cover", caption: "IRL segment.", meta: "01" },
      { src: `${IB}/7tSCzHkb/makz-sp-2.jpg`, alt: "Stream still two", aspect: "16 / 9", fit: "cover", caption: "Build session.", meta: "02" },
      { src: `${IB}/N2xTW6C0/makz-stam1.jpg`, alt: "Stream still three", aspect: "16 / 9", fit: "cover", caption: "Studio.", meta: "03" },
      { src: `${IB}/7Jm1Rmwt/makz-stam2.jpg`, alt: "Stream still four", aspect: "16 / 9", fit: "cover", caption: "Overlay pass.", meta: "04" },
      { src: `${IB}/nqwD0frf/makz-stam3.jpg`, alt: "Stream still five", aspect: "16 / 9", fit: "cover", caption: "Late session.", meta: "05" },
    ],
    stack: ["Owncast", "HLS", "hls.js", "Custom player", "Status API", "Self-hosted"],
    sections: [
      {
        index: "01",
        heading: "Why self-host",
        body: [
          "Every mainstream platform takes a cut of attention before it takes a cut of money. Running the stack directly means the stream has one audience relationship and no interstitial.",
          "Ingest, transcode and HLS delivery sit on the same origin as chat and the status endpoint, which keeps the player logic simple and the latency honest.",
        ],
        aside: [
          { label: "Origin", value: "stream.makz.space" },
          { label: "Delivery", value: "HLS" },
          { label: "Ads", value: "None" },
        ],
      },
      {
        index: "02",
        heading: "The player",
        body: [
          "The interface is a broadcast surface rather than a video box: online and offline are designed states, the viewer count and title are live, and chat is a peer of the video rather than a sidebar bolted on.",
          "When the stream is offline the page does not show a dead rectangle — it shows the schedule, the channels and the last known state.",
        ],
      },
      {
        index: "03",
        heading: "Content",
        body: [
          "Design, gaming, IRL and build sessions. The format shifts; the surface does not.",
        ],
      },
    ],
    timeline: [
      { phase: "01", label: "Stack", detail: "Ingest, transcode, HLS, chat on owned infrastructure" },
      { phase: "02", label: "Surface", detail: "Custom player, live status, cinema mode" },
      { phase: "03", label: "Operations", detail: "Scheduling, overlays, ongoing sessions" },
    ],
    credits: [{ role: "Architecture & production", name: "Karol Kuklinski" }],
    links: [
      { label: "Open the broadcast", href: "/live" },
      { label: "Twitch mirror", href: "https://www.twitch.tv/motomakz", external: true },
    ],
  },
  {
    slug: "ets2-convoy",
    index: "04",
    title: "CONVOY",
    subtitle: "A bilingual ETS2 convoy programme, run like a schedule",
    discipline: ["Community", "Systems", "Identity"],
    year: "2025 — ongoing",
    status: "ongoing",
    client: "MAKZ",
    role: "Programme design, server operations, identity",
    summary:
      "Vanilla+ Euro Truck Simulator 2 convoys with traffic enabled, run in English and Polish. Eight seats, a fixed session flow, a published server name and password, and a poster series that gives each run an identity.",
    cover: {
      src: `${IB}/23ZB95W2/makz-scania-500-S.png`,
      alt: "Scania 500 S convoy poster",
      aspect: "16 / 10",
      fit: "contain",
      meta: "Convoy poster",
    },
    gallery: [
      {
        src: `${IB}/23ZB95W2/makz-scania-500-S.png`,
        alt: "Scania 500 S convoy livery",
        aspect: "16 / 10",
        fit: "contain",
        caption: "Scania 500 S — convoy livery.",
        meta: "01",
      },
    ],
    stack: ["ETS2 Convoy 1.58", "Vanilla+", "Traffic enabled", "EN / PL"],
    sections: [
      {
        index: "01",
        heading: "Setup",
        body: [
          "A lightweight configuration that keeps the base ETS2 feel while adding enough extras to make a group drive worth showing up for. Traffic stays on: the whole point is road presence, spacing and realistic pacing.",
          "The server is listed publicly with a bilingual name so English and Polish drivers both know they are in the right place before they join.",
        ],
        aside: [
          { label: "Server", value: "makz. | Vanilla+ | Traffic | Server 01 | EN/PL" },
          { label: "Password", value: "makz." },
          { label: "Seats", value: "8" },
          { label: "Version", value: "Convoy 1.58" },
        ],
      },
      {
        index: "02",
        heading: "Session flow",
        body: [
          "Every run uses the same three beats so nobody has to ask what happens next.",
        ],
        aside: [
          { label: "01", value: "Find server — search the exact name, enter the password" },
          { label: "02", value: "Meet — gather, repair, fuel, park up, ready" },
          { label: "03", value: "Drive — hold the route and spacing, finish on a lineup" },
        ],
      },
      {
        index: "03",
        heading: "Posters",
        body: [
          "Each convoy gets artwork. It sounds like a flourish; in practice it is the thing that makes a session feel like an event rather than a lobby, and it gives the community something to post.",
        ],
      },
    ],
    timeline: [
      { phase: "01", label: "Programme", detail: "Format, seats, bilingual access" },
      { phase: "02", label: "Identity", detail: "Poster series per convoy" },
      { phase: "03", label: "Runs", detail: "Scheduled sessions, ongoing" },
    ],
    credits: [{ role: "Programme & design", name: "Karol Kuklinski" }],
    links: [
      { label: "Convoy details", href: "/gaming" },
      { label: "Discord", href: "https://discord.gg/HWUrCtQar8", external: true },
    ],
  },
  {
    slug: "home-assistant",
    index: "05",
    title: "HOME",
    subtitle: "A smart home interface shaped around one household",
    discipline: ["Interface", "Systems", "Automation"],
    year: "2026",
    status: "active",
    focus: true,
    client: "Personal",
    role: "Interface design, automation, integration",
    summary:
      "A fully customised Home Assistant surface built around how the house is actually used rather than around what the integrations happen to expose. Dashboards are composed per room and per moment, not per device.",
    cover: {
      src: `${IB}/jkhTKtLk/MAKZ-SPACE-BG.png`,
      alt: "Home Assistant interface composition",
      aspect: "16 / 9",
      fit: "cover",
      meta: "Interface",
    },
    gallery: [],
    stack: ["Home Assistant", "YAML", "Custom dashboards", "Automations", "Local control"],
    sections: [
      {
        index: "01",
        heading: "The problem with device lists",
        body: [
          "Out of the box, a smart home is an inventory: forty entities in a scrolling list, each one a toggle. Nobody thinks in entities. They think 'going to bed', 'leaving', 'someone is at the door'.",
          "The build reorganises everything around those moments, so the common case is one press and the full device list is available but never the default view.",
        ],
        aside: [
          { label: "Status", value: "Active build" },
          { label: "Control", value: "Local-first" },
        ],
      },
      {
        index: "02",
        heading: "Surfaces",
        body: [
          "Wall tablet, phone and desktop each get a different composition of the same state — the tablet is glanceable and touch-first, the phone is thumb-reachable, the desktop is dense.",
        ],
      },
    ],
    timeline: [
      { phase: "01", label: "Audit", detail: "Entities, rooms, real usage patterns" },
      { phase: "02", label: "Composition", detail: "Moment-led dashboards per surface" },
      { phase: "03", label: "Automation", detail: "Routines, presence, local control" },
    ],
    credits: [{ role: "Design & build", name: "Karol Kuklinski" }],
    links: [],
  },
  {
    slug: "makz-space",
    index: "06",
    title: "MAKZ.SPACE",
    subtitle: "This environment — the site as the portfolio piece",
    discipline: ["Interface", "Motion", "Engineering"],
    year: "2026",
    status: "active",
    client: "MAKZ",
    role: "Concept, design system, motion, full-stack build",
    summary:
      "A personal digital environment built as one application shell rather than a set of pages: a persistent index rail, a command interface, route-level curtain transitions, a real account system and live data from the broadcast and game servers.",
    cover: {
      src: `${IB}/Z6DsR6gs/hq-makz-space.jpg`,
      alt: "MAKZ environment",
      aspect: "16 / 9",
      fit: "cover",
      meta: "Environment",
    },
    gallery: [],
    stack: [
      "Next.js",
      "React",
      "TypeScript",
      "Tailwind CSS",
      "GSAP / ScrollTrigger",
      "Motion",
      "Supabase",
      "PostgreSQL",
    ],
    sections: [
      {
        index: "01",
        heading: "One shell",
        body: [
          "Navigation, status and identity live in a persistent frame that never re-renders between routes. Sections load into a stage inside it, so moving through the site feels like changing view in an application rather than requesting documents.",
          "The index is a single array in the codebase. The rail, the mobile dock, the command palette and the sitemap all read from it, which is why they can never disagree.",
        ],
        aside: [
          { label: "Routes", value: "Six sections" },
          { label: "Shell", value: "Persistent" },
          { label: "Palette", value: "⌘K" },
        ],
      },
      {
        index: "02",
        heading: "Motion as structure",
        body: [
          "Five named behaviours — fast, interface, reveal, page, cinematic — carry every animation in the build. Nothing picks its own duration or curve.",
          "Route changes run a curtain: shutters climb, the destination's index and name resolve inside the mask, then the shutters lift and the incoming content reveals under clipping masks. The transition tells you where you went.",
        ],
      },
      {
        index: "03",
        heading: "Real data, real accounts",
        body: [
          "Broadcast status and Minecraft server state are proxied server-side and rendered live. Accounts run on Supabase with row-level security, cookie sessions, email verification and password recovery — profiles, preferences and saved records are actual rows, not local storage.",
        ],
      },
    ],
    timeline: [
      { phase: "01", label: "Concept", detail: "Environment metaphor, information architecture" },
      { phase: "02", label: "System", detail: "Tokens, type scale, motion behaviours" },
      { phase: "03", label: "Shell", detail: "Ledger, rail, dock, curtain, palette" },
      { phase: "04", label: "Sections", detail: "Standby, work, live, gaming, frames, signal" },
      { phase: "05", label: "Accounts", detail: "Auth, profiles, preferences, saved records" },
    ],
    credits: [{ role: "Concept, design & build", name: "Karol Kuklinski" }],
    links: [{ label: "You are here", href: "/" }],
  },
];

export function getWork(slug: string): WorkRecord | undefined {
  return WORK.find((record) => record.slug === slug);
}

export function adjacentWork(slug: string) {
  const i = WORK.findIndex((record) => record.slug === slug);
  if (i === -1) return { previous: undefined, next: undefined };
  return {
    previous: i > 0 ? WORK[i - 1] : WORK[WORK.length - 1],
    next: i < WORK.length - 1 ? WORK[i + 1] : WORK[0],
  };
}
