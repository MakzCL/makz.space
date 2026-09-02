# makz.space

A clean Next.js rebuild for the public MAKZ experience.

## Run locally

```bash
npm install
npm run dev
```

## Configuration

Copy `.env.example` to `.env.local` to override the public Owncast URL. No credentials are committed. Account access is intentionally unavailable until a real authentication provider is configured.

## Product boundaries

- The live status checks a real Owncast endpoint.
- Projects, gaming entries and social links use existing public content only.
- No fake viewers, donation accounts, playtime, or authentication flows are included.

