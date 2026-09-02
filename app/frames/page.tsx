import { Suspense } from "react";
import type { Metadata } from "next";

import { FRAMES } from "@/lib/data/frames";
import { Gallery } from "@/features/frames/gallery";
import { SectionHead } from "@/components/ui/section-head";

export const metadata: Metadata = {
  title: "Frames",
  description:
    "Poster work and stills — machine series, convoy liveries and broadcast photography, in a full-bleed viewer.",
  alternates: { canonical: "/frames" },
};

export default function FramesPage() {
  const series = new Set(FRAMES.map((frame) => frame.series));

  return (
    <>
      <SectionHead
        index="04"
        name="Frames"
        lede="Poster work and stills. Open one and it takes the whole screen — arrow keys, drag or the strip to move through the set."
        readouts={[
          { label: "Frames", value: String(FRAMES.length).padStart(2, "0") },
          { label: "Series", value: String(series.size).padStart(2, "0") },
          { label: "Viewer", value: "FULL BLEED" },
        ]}
      />
      <div className="mt-8 md:mt-12">
        <Suspense fallback={<GalleryFallback />}>
          <Gallery frames={FRAMES} />
        </Suspense>
      </div>
    </>
  );
}

/** Skeleton in the shape of the real grid, ruled rather than shimmering. */
function GalleryFallback() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-1 gap-px bg-[var(--color-line)] md:grid-cols-12"
    >
      {[
        "md:col-span-7",
        "md:col-span-5",
        "md:col-span-5",
        "md:col-span-4",
        "md:col-span-8",
        "md:col-span-6",
      ].map((span, i) => (
        <div key={i} className={`bg-[var(--color-base)] p-4 ${span}`}>
          <div className="aspect-[3/2] w-full bg-[var(--color-surface)]" />
          <div className="mt-4 h-2 w-24 bg-[var(--color-surface)]" />
        </div>
      ))}
    </div>
  );
}
