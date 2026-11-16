// Sync server (Supabase). The key is the public "publishable" key: it only
// allows calling the dairy_* functions, which each check the phone's own
// secret device key. Leave SYNC_URL empty to build an app without sync.
export const SYNC_URL = 'https://lqlcsfgfsosavolujnku.supabase.co';
export const SYNC_KEY = 'sb_publishable_dBCKrK7sK5ll-w0JyFeShg_YxEw7Egk';

// Where the web version and the invite page are published (Cloudflare Pages).
// Invite links point here; the browser version can be used from it too.
export const WEB_URL = 'https://dairy-herd.pages.dev';
