import type { MetadataRoute } from "next";

import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — ${SITE.operator}`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0c0d10",
    theme_color: "#0c0d10",
    categories: ["portfolio", "design", "entertainment"],
    icons: [
      { src: "/favicon.png", sizes: "any", type: "image/png", purpose: "any" },
    ],
  };
}
