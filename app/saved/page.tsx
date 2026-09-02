import type { Metadata } from "next";

import { listSaved } from "@/lib/data/saved";
import { SectionHead } from "@/components/ui/section-head";
import { SavedList } from "@/features/saved/saved-list";

export const metadata: Metadata = {
  title: "Saved",
  robots: { index: false, follow: false },
};

/** Protected by the proxy: unauthenticated visitors never reach this. */
export default async function SavedPage() {
  const items = await listSaved();

  return (
    <>
      <SectionHead
        index="··"
        name="Saved"
        lede="Records you kept. Stored on your account, not this browser, so they follow you between devices."
        readouts={[
          { label: "Items", value: String(items.length).padStart(2, "0") },
          {
            label: "Types",
            value: String(new Set(items.map((i) => i.item_type)).size).padStart(2, "0"),
          },
        ]}
      />
      <div className="mt-8 md:mt-12">
        <SavedList items={items} />
      </div>
    </>
  );
}
