// Secret values are supplied by the Cloudflare deployment, never checked in.
interface Env {
  DATABASE_URL: string;
  STORAGE_TOKEN: string;
  SFU_APP_SECRET: string;
}
