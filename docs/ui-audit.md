# UI audit: every app, every control

**Date:** 2026-11-04

**Apps:** SK Factory, Kortana, TROTAN, NUCLEUS and the SK Suite desktop hub.

## How the audit works

An automated crawler opens every screen of every app. For each screen it does two things.

**1. Checks the screen as it stands.** It runs these checks at desktop width (1440 px) and phone width (390 px). NUCLEUS is checked at 1024 px instead of 390 px. The Suite is checked at 820 px.

- Horizontal page scroll.
- Controls pushed off screen. Controls inside a sideways-scrolling strip are not counted.
- Clipped text.
- Controls without an accessible name.
- Tap targets under 24 px on phones.
- Text contrast below WCAG AA (4.5:1, or 3:1 for large text).

**2. Clicks every control.** This covers every button, tab, link, menu item, checkbox and dropdown, on its own, starting from a fresh page each time. For each click it records:

- JavaScript errors and console errors;
- failed requests;
- controls that change nothing;
- layout breakage after the click.

**Test data.** SK Factory, Kortana and TROTAN run against a mocked backend seeded with realistic data, so nothing real is touched. NUCLEUS and the Suite need no backend.

## Running the crawler

| App | Command |
|---|---|
| SK Factory, Kortana, TROTAN | `factory/tests/audit/audit-web.mjs <outDir> [factory\|kortana\|trotan]`. Set `SCREEN=` to audit one screen. |
| NUCLEUS | `nucleus/tests/audit/audit-nucleus.mjs <outDir>` |
| SK Suite | `xvfb-run -a node suite/tests/audit.mjs <outDir>` |

## Results

| App | First pass | Final pass |
|---|---|---|
| SK Factory | 23 | 4: all false alarms, from the decorative circle on the stat tiles making the box measure wider than its text |
| Kortana | 142 | 0 |
| TROTAN | 55 | 0 |
| NUCLEUS | 31 | 0 |
| SK Suite | 9 | 0 |

Most first-pass findings were crawler noise, which was fixed in the crawler itself:

- clicking an already-active tab;
- clicking controls behind an open dialog;
- tabs in sideways-scrolling strips counted as "off screen";
- disabled menu items;
- reordered tables not counted as a change.

## Real defects found and fixed

### SK Suite

- The "An update is ready / Update now" banner showed on Home even when there was no update. A CSS display rule overrode the hidden state.
- Red buttons with white text were 4.38:1. Their red is now 5.05:1.
- Red "Sign out on this computer" text was 3.98:1. It now uses a lighter red on dark palettes.
- "Check for updates" gave no visible feedback. The status now shows the time of the last check.

### TROTAN

- **Phone header:** on phones the header pushed Produce, Administration, the colour switch and Sign out off screen. The module tabs now scroll sideways, and the colour switch has moved into the Account panel.
- **Account unreachable:** on tablets and phones (under 1100 px) the name button was hidden, so Account and Sign out of devices could not be reached. It is now always shown, shortened if needed.
- **Sideways scrolling:** Administration tabs and selects slid off the left edge on phones. Pages no longer scroll sideways; wide tables scroll inside their own box.
- **Contrast:** "Sign out everywhere" was 3.03:1. It is now 5.6:1.
- **Tap targets:** the name button (18 px tall) and the dialog close button (14 × 22 px) were too small. Both are now at least 32–36 px.

### SK Factory

- **Jobs crash:** a job with an unexpected status crashed the Jobs screen ("Cannot read properties of undefined (reading 'label')"). It now shows the job as Open.
- **Contrast:**
  - Bottom-nav labels, "Off shift" and the footer were 2.8–3.2:1. The "dim" text colour is now at least 5:1 on every surface.
  - White text on red was 4.38:1: the role tag, buttons, "Hours this month" and the award tiles. Filled red is now 5.05:1, and small text on coloured tiles is solid white.
- **Unlabelled toggles:** settings toggles had no accessible name. All toggles now carry their setting's name.
- **Back button:** 23 px tall, now 36 px.
- **Status "Set" button:** clipped on phones; it no longer shrinks.

### Kortana

- **Grammar:** Insights said "1 orders". It now uses proper plurals in English and Polish.
- **Contrast:** "Sign out everywhere" on purple was 3.73:1. It is now 4.56:1.
- **Tap targets:** the sales-order rank ↑/↓ buttons (22 px) and the table sort headers (17 px tall) are now 28 px with a mouse and 36 px on touch screens.

### NUCLEUS

- **Crash:** opening the PCB or Manufacturing menu before a board existed threw a ResizeObserver error.
- **Clipped name:** the project name in the header was cut off at 1024 px with no way to read it. Hovering now shows the full name, revision and file.
