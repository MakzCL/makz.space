# SEND theme schema & appearance system

Everything visual in SEND is data validated by one schema (`shared/src/theme.ts`), used by the client and the server. Themes can't contain HTML, script, remote URLs or unbounded values.

## Where every control lives

| What | Where |
|---|---|
| SEND Studio | Settings → Appearance → **Open SEND Studio**; user menu (click your name) → **Edit appearance**; server menu → **Edit appearance** |
| Quick theme / accent | Settings → Appearance |
| Accessibility & performance | Settings → Accessibility, or Studio → Accessibility & performance |
| Panels & transparency (14 regions) | Studio → Panels & transparency (click a region in the live preview, or use the list) |
| Backgrounds & library | Studio → Backgrounds |
| Layout | Studio → Layout |
| Per-server look | Studio → Per-server, or the server menu → Edit appearance |
| Per-conversation look, label, shared theme | Palette button in the chat header, or Studio → Per-conversation |
| Global profile & effects | Settings → Profile, or Studio → Profile & effects |
| Server profile | Studio → Profile & effects → *Server profile…*; server menu → Edit server profile |
| Presets, import, export | Studio → Presets & import/export |
| Tokens JSON & custom CSS | Studio → Advanced |
| Desktop window material, updates | Settings → Desktop app (desktop app only) |
| Recovery | `Ctrl+Shift+Alt+R`, `/?safe-appearance=1`, **Reset appearance** on the sign-in screen |

## Hierarchy

Later layers win, per value:

1. Built-in defaults
2. Selected theme (built-in preset or your preset)
3. Your global overrides
4. This-device overrides (layout & performance only; not synced)
5. Your personal server override
6. An accepted shared conversation theme
7. Your personal channel / conversation override
8. Accessibility enforcement (always last: reduced motion, high contrast, blur limits, low power, minimum text contrast)

What each scope may override:

| Scope | colors | panels | background | effects | conversation (bubbles, opacity, label…) | typography | layout | customCss |
|---|---|---|---|---|---|---|---|---|
| Global | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (opt-in) |
| Device | | | | | | | ✓ | |
| Server (personal) | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| Shared conversation | ✓ | ✓ | ✓ | ✓ | | | | |
| Channel / DM (personal) | ✓ | ✓ | ✓ | ✓ | ✓ | | | |

These stay separate and never overwrite each other: personal app appearance (private), public global profile, public server profile, administrator server branding (icon/banner/tag), and accepted shared conversation themes.

## Theme file (version 2)

```json
{
  "schema": "send.theme",
  "version": 2,
  "meta": { "id": "my-theme", "name": "My theme", "author": "me", "description": "…", "version": "1.0", "license": "CC-BY-4.0", "tags": ["dark", "glass"], "scheme": "dark" },
  "colors": { "bg0": "#0E1220", "bg1": "#141A2B", "bg2": "#1A2136", "bg3": "#232C45", "line": "#2E3858", "text": "#EEF1F8", "textMuted": "#A9B2C7", "textFaint": "#7C8597", "accent": "#3D6BFF", "accent2": "#FFC93C", "mention": "#FFC93C", "link": "#7EA2FF", "danger": "#E5484D", "success": "#2FBF71", "warning": "#F2B33D" },
  "panels": { "chat": { "bg": "#0E1220", "opacity": 30, "blur": 10, "border": "#FFFFFF", "borderOpacity": 12, "borderWidth": 1, "radius": 14, "shadow": 20, "gradient": { "to": "#3D6BFF", "angle": 135 }, "image": null, "text": null, "icon": null } },
  "typography": { "font": "system", "size": 15, "lineHeight": 1.4, "letterSpacing": 0 },
  "layout": { "nav": "vertical", "railColumns": 1, "sidebarWidth": 248, "memberWidth": 260, "showMembers": true, "showSidebar": true, "density": "cozy", "spacing": 4, "messageStyle": "list", "avatarSize": 40, "grouping": true, "timestamps": "always", "timeFormat": "12h", "panelStyle": "flat", "radius": 10, "gap": 0, "margin": 0, "unreadStyle": "pill", "mentionStyle": "tint", "statusStyle": "dot", "scale": 1 },
  "background": { "dark": { "kind": "image", "asset": "builtin:dunes", "fit": "cover", "x": 50, "y": 50, "zoom": 1, "brightness": 90, "saturation": 110, "blur": 0, "tint": "#000000", "overlay": 20, "vignette": 30 }, "light": null, "target": "app" },
  "effects": { "animatedBackground": false, "glow": 0, "blurScale": 1 },
  "conversation": { "bubbles": { "mine": "#3D6BFF", "theirs": "#232C45", "radius": 16, "spacing": 4 } },
  "customCss": "",
  "assets": { "a123": { "mime": "image/webp", "name": "wall", "data": "<base64>" } }
}
```

Rules:
- Colours are `#RRGGBB` (or `#RRGGBBAA`). Numbers have documented ranges; out-of-range values are rejected with their path, e.g. `panels.chat.opacity must be between 0 and 100`.
- Regions: `app, rail, sidebar, dmSidebar, chat, header, composer, members, panels, userPanel, call, profileCard, settings, overlay`.
- Fonts: `system, rounded, serif, mono, readable, condensed` (device fonts only, nothing downloaded).
- Assets are references only: `builtin:<name>` (`dunes, frost, grid, canvas, hexfield, waves`) or `a<id>` from **your** library. URLs are rejected. Packaged `assets` are uploaded to your library on import (type-sniffed, size-limited) and references rewritten.
- Unknown keys are ignored with a warning. Partial files are fine; missing sections fall back to defaults.
- Version 1 exports (`{"syndo_theme": 1, …}`) are migrated automatically.
- Export never includes per-conversation settings, labels or conversation ids, and leaves out your images unless you tick *Include my images*.

## Custom CSS (opt-in)

Parsed, not string-filtered. Allowed: `selector { property: value; }` only, where selectors use `[data-region="…"]`, documented classes (`.msg, .msg-content, .msg-name, .mention, .reaction, .side-ch, .rail-item, .member, .btn, .composer, .ch-h, .profile-card, .tile, .ctl, .modal, .menu …`), simple elements and `:hover, :focus-visible, :focus-within, :active, :first-child, :last-child, ::placeholder, ::selection`. Properties are visual only (colours, borders, radii, shadows, fonts, letter-spacing, padding, opacity ≥ 0.4, backdrop-filter, CSS variables). Rejected: at-rules (`@import`, `@font-face`, `@media`…), `url()`, `image-set()`, `expression()`, escapes, HTML, and anything that hides or moves elements (`display, position, visibility, content, transform, width/height…`). Output is scoped under `.send-css`; safe mode ignores it.

## Not supported

BetterDiscord / Vencord `.theme.css` files target another application's markup and are rejected on import with an explanation. There is no conversion layer.
