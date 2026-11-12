# SK Suite Beta: the pre-publish suite

Every update goes to **SK Suite Beta** first. The owner tests it there. Only the words **"Publish fully as an update to the main"** promote it to the live suite.

## Addresses

| App | Beta | Live (unchanged until promoted) |
|---|---|---|
| SK Factory | https://beta.skalarki-factory.pages.dev | https://factory.makz.space |
| Kortana | https://beta.skalarki-factory.pages.dev/kimera | https://kortana.makz.space |
| TROTAN | https://beta.skalarki-factory.pages.dev/trotan | https://trotan.makz.space |
| NUCLEUS | https://beta.nucleus-eda.pages.dev | https://nucleus-eda.pages.dev |
| CADRA | https://beta.cadra.pages.dev | https://cadra.makz.space |
| Desktop | https://beta.sk-suite.pages.dev/download/SK-Suite-Beta-win-x64.zip ("SK Suite Beta.exe") | https://sk-suite.pages.dev/download/SK-Suite-win-x64.zip |

Every beta app shows an amber **BETA** ribbon in its top-left corner, and window titles start with "BETA · ".

## How it works
- **Same code, beta builds:**
  - Each Cloudflare Pages project builds the git branch **`beta`** as a branch deployment at `beta.<project>.pages.dev`.
  - A build is beta when `CF_PAGES_BRANCH=beta` (or `SK_CHANNEL=beta` locally). Each app's `vite.config` passes this in as `__SK_CHANNEL__`.
  - The live projects' production branches and custom domains are not touched.
- **`packages/sk-channel/channel.ts`:**
  - shows the BETA mark;
  - holds the app addresses for the channel, so beta apps link only to beta apps (Factory ⇄ Kortana ⇄ TROTAN, and the SK Suite download link).
  - A page served from a `beta.*` address counts as beta even if it was built without the flag.
- **SK Suite Beta (desktop):** a beta build carries `channel.json`, written by `suite/scripts/channel.mjs` and `bundle.mjs`. It sets:
  - **name and profile:** "SK Suite Beta", its own profile folder and single-instance lock, so it runs side by side with SK Suite;
  - **sign-in:** its own session (`persist:sk-suite-beta`);
  - **updates:** its own update feed (`beta.sk-suite.pages.dev/update/`);
  - **app addresses:** the beta sites. In beta, SK Factory, Kortana and TROTAN share one address, so windows are chosen by path (`/`, `/kimera`, `/trotan`);
  - **bundled apps:** NUCLEUS and CADRA built in beta, so they carry the mark too.
- **Data:** beta uses the **same company database** as the live suite, so testing happens on real work.
  - A beta update that needs a database change must be backwards compatible, so the live suite keeps working.
  - It is backed up (and a restore point is made) before it is applied, as for any publish.
  - Sign-in is by email and password, which works on the beta addresses.
  - Sign-up confirmation and password-reset emails link to the live address unless the beta addresses are added to Supabase's allowed redirect URLs.

## Release flow
1. Work is committed and pushed to `nucleus` (development).
2. A finished, tested cycle is pushed to **`beta`** and deployed to the four beta projects.
3. On **"Publish fully as an update to the main"**:
   - back up the database to `backup_<date>_<name>`;
   - make the restore point branch `backup/pre-<name>-<date>` at the live `origin/main`;
   - fast-forward `main` to `beta`;
   - deploy the live projects;
   - bump the SK Suite version, so installed copies update.

## Tests
- `suite/tests/beta.mjs` (SK Suite Beta, 6 steps):
  - name and profile;
  - BETA mark in the hub, NUCLEUS and CADRA;
  - beta addresses only;
  - own session;
  - beta update feed.
- `suite` `npm test`: the stable desktop build is unchanged (16 steps).
- Checked in the browser: beta Factory, Kortana and TROTAN show the mark and link only to beta; stable builds show no mark and keep the live links.
