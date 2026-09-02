/**
 * The loading state is a readout being drawn, not a spinner. It appears only
 * while a route's data is genuinely outstanding — nothing here delays a
 * navigation that is already resolved.
 */
export default function Loading() {
  return (
    <div className="gutter flex min-h-full flex-col justify-center py-14" aria-busy>
      <span className="t-micro text-[var(--color-signal)]">RESOLVING</span>

      <div className="mt-8 flex flex-col gap-3" aria-hidden>
        {[42, 26, 34].map((width, i) => (
          <span
            key={i}
            className="block h-[clamp(1.75rem,5vw,3.5rem)] animate-pulse bg-[var(--color-surface)]"
            style={{ width: `${width}%`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>

      <div className="mt-10 flex gap-1" aria-hidden>
        {Array.from({ length: 24 }, (_, i) => (
          <span
            key={i}
            className="block h-2 w-[2px] animate-pulse bg-[var(--color-paper-12)]"
            style={{ animationDelay: `${i * 45}ms` }}
          />
        ))}
      </div>

      <span className="sr-only">Loading</span>
    </div>
  );
}
