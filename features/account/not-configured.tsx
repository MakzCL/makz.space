import { ActionLink } from "@/components/ui/action";

/**
 * Shown when the deployment has no Supabase credentials. It states exactly
 * what is missing rather than presenting a form that cannot possibly work.
 */
export function NotConfigured() {
  return (
    <div className="gutter flex min-h-full flex-col justify-center py-16">
      <span className="t-micro text-[var(--color-signal)]">ACCESS — UNAVAILABLE</span>

      <h1 className="mt-6 max-w-[16ch] text-[clamp(2.2rem,7vw,5rem)] font-extrabold leading-[0.9] tracking-[-0.045em] text-[var(--color-paper)]">
        No account layer here.
      </h1>

      <p className="t-lead mt-7 max-w-[52ch]">
        This deployment has no database credentials, so accounts, profiles and
        saved records are switched off. Everything else on the site works
        normally.
      </p>

      <div className="mt-9 max-w-[46rem] border-t border-[var(--color-line)]">
        <p className="t-micro mt-5 text-[var(--color-paper-35)]">
          To switch it on, set these in <code>.env.local</code> and redeploy:
        </p>
        <ul role="list" className="mt-4">
          {["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].map(
            (name) => (
              <li
                key={name}
                className="border-t border-[var(--color-line)] py-3"
              >
                <code className="t-meta text-[var(--color-paper)]">{name}</code>
              </li>
            ),
          )}
        </ul>
        <p className="t-micro mt-5 leading-[1.8] text-[var(--color-paper-20)]">
          Then apply <code>supabase/migrations/0001_init.sql</code> to the
          project. The full procedure is in the README.
        </p>
      </div>

      <div className="mt-9 flex flex-wrap gap-3">
        <ActionLink href="/" tone="solid">
          Back to standby
        </ActionLink>
        <ActionLink href="/work" tone="line">
          Browse the records
        </ActionLink>
      </div>
    </div>
  );
}
