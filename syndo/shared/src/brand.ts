/**
 * Syndo — the single source of truth for the product's identity.
 *
 * Everything that names or colours the product reads from here: the web
 * client's CSS tokens, the HTML <title>, the web manifest, notifications,
 * email templates and the server's API metadata. Change it here and nowhere
 * else.
 *
 * About the name: "Syndo" is a personal reference to Down syndrome. The
 * public identity stays on friendship, community and communication. The mark
 * is a sharp hexagonal "S" — one solid shape, cut by two channels into a path
 * that flows from one side to the other, like a conversation passing between
 * people. The warm yellow and calm blue (colours long associated with Down
 * syndrome awareness) remain in the palette.
 */
export const BRAND = {
  name: "Syndo",
  tagline: "Talk together. Belong together.",
  description:
    "Syndo is a free place for friends and communities to chat, call, share their screens and hang out — every feature, for everyone.",
  /** Shown in email footers and the about panel. */
  publisher: "Syndo",
  supportEmail: "support@syndo.local",

  colors: {
    /** Primary brand blue — calm, trustworthy, the main interactive colour. */
    blue: "#3D6BFF",
    blueDeep: "#2547C9",
    /** Warm sunrise yellow — highlights, the third voice in the mark. */
    yellow: "#FFC93C",
    yellowDeep: "#E0A600",
    /** A soft coral used for the second voice and for warmth, never for errors. */
    coral: "#FF8A6B",
    /** Status colours (independent of brand colours so meaning never drifts). */
    online: "#2FBF71",
    idle: "#F2B33D",
    dnd: "#E5484D",
    offline: "#7C8597",
    danger: "#E5484D",
    success: "#2FBF71",
  },

  /** Default dark ("Night") and light ("Day") surfaces. Themes override these. */
  surfaces: {
    dark: {
      bg0: "#0E1220", // app frame / server rail
      bg1: "#141A2B", // sidebars
      bg2: "#1A2136", // main content
      bg3: "#232C45", // raised: inputs, cards
      line: "#2E3858",
      text: "#EEF1F8",
      textMuted: "#A9B2C7",
      textFaint: "#7C8597",
    },
    light: {
      bg0: "#E6EAF4",
      bg1: "#F1F3F9",
      bg2: "#FFFFFF",
      bg3: "#F3F5FA",
      line: "#D5DBEA",
      text: "#141A2B",
      textMuted: "#4A5470",
      textFaint: "#6B7590",
    },
  },

  /** Typography — system stacks, so there is no third-party font request. */
  fonts: {
    ui: `"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`,
    mono: `"JetBrains Mono", "Cascadia Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
  },

  assets: {
    logo: "/brand/syndo-mark.svg",
    appIcon256: "/brand/syndo-icon-256.png",
    wordmark: "/brand/syndo-wordmark.svg",
    appIcon: "/brand/syndo-icon.svg",
    appIcon192: "/brand/syndo-icon-192.png",
    appIcon512: "/brand/syndo-icon-512.png",
  },

  /** Loading-screen copy. Rotates; kept warm and short. */
  loadingLines: [
    "Gathering your friends…",
    "Warming up the conversation…",
    "Saving you a seat…",
    "Finding your people…",
  ],
} as const;

export type Brand = typeof BRAND;

/** Page title helper so every route names the product the same way. */
export const pageTitle = (section?: string) => (section ? `${section} · ${BRAND.name}` : BRAND.name);
