# makz.space

Static public site for projects, livestreams, gaming spaces and community links.

## Structure

- `assets/app.css` — shared design tokens, responsive application shell and reduced-motion fallback.
- `assets/app.js` — shared navigation, account-state notice, micro-interactions, filters and Owncast status checks.
- `livestream.html` — real Owncast status, HLS player when the channel is live and integrated chat.
- `vods/` — saved-replay data and the scheduled YouTube stream refresh.
- `projects/` and `gaming/` — published work and configured gaming spaces.

The site is intentionally static so it remains compatible with its current hosting. Account functionality is not mocked: the profile surface reports that access is unavailable until a real identity provider and secure server-side configuration are added.

