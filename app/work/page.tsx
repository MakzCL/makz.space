import type { Metadata } from "next";

import { WORK } from "@/lib/data/work";
import { RecordIndex } from "@/features/work/record-index";
import { SectionHead } from "@/components/ui/section-head";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Selected records — brand strategy and identity, self-hosted broadcast infrastructure, game server networks and interface systems.",
  alternates: { canonical: "/work" },
};

export default function WorkPage() {
  const active = WORK.filter(
    (record) => record.status === "active" || record.status === "ongoing",
  ).length;

  return (
    <>
      <SectionHead
        index="01"
        name="Work"
        lede="Six records. Brand systems, broadcast infrastructure, server networks and the interface you are reading this in."
        readouts={[
          { label: "Records", value: String(WORK.length).padStart(2, "0") },
          { label: "In progress", value: String(active).padStart(2, "0") },
          { label: "Span", value: "2025 — 2026" },
        ]}
      />
      <div className="mt-8 md:mt-12">
        <RecordIndex records={WORK} />
      </div>
    </>
  );
}
