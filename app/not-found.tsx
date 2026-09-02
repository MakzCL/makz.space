import type { Metadata } from "next";

import { SECTIONS } from "@/lib/site";
import { ActionLink } from "@/components/ui/action";
import { SplitText } from "@/components/ui/split-text";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

/**
 * 404 as a readout: the index number that does not exist, stated plainly,
 * with the whole index offered underneath so the visitor is one press from
 * anywhere rather than one press from the homepage.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="gutter py-14">
        <span className="t-micro text-[var(--color-signal)]">FAULT 404</span>

        <SplitText
          as="h1"
          by="char"
          delay={0.08}
          className="t-mega mt-6 block text-[var(--color-paper)]"
        >
          404
        </SplitText>

        <p className="t-lead mt-8 max-w-[44ch] t-pretty">
          No record at that address. It may have been renamed, or it never
          existed — either way, nothing here is lost, only unindexed.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <ActionLink href="/" tone="solid">
            Return to standby
          </ActionLink>
          <ActionLink href="/work" tone="line">
            Open the records
          </ActionLink>
        </div>
      </div>

      <ul role="list" className="border-t border-[var(--color-line)]">
        {SECTIONS.map((section) => (
          <li key={section.href} className="border-b border-[var(--color-line)]">
            <ActionLink
              href={section.href}
              tone="ghost"
              size="lg"
              full
              className="!justify-start gap-5 px-[var(--unit-gutter)] hover:bg-[var(--color-surface)] hover:text-[var(--color-paper)]"
              index={section.index}
            >
              {section.name}
            </ActionLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
