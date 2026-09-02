import type { MetadataRoute } from "next";

import { SECTIONS, SITE } from "@/lib/site";
import { WORK } from "@/lib/data/work";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    ...SECTIONS.map((section) => ({
      url: `${SITE.url}${section.href}`,
      lastModified: now,
      changeFrequency: section.href === "/live" ? ("hourly" as const) : ("weekly" as const),
      priority: section.href === "/" ? 1 : 0.8,
    })),
    ...WORK.map((record) => ({
      url: `${SITE.url}/work/${record.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
