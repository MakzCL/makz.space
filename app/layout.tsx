import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";

import { Shell } from "@/components/shell/shell";
import { APPEARANCE_BOOTSTRAP } from "@/components/shell/environment";
import { SITE } from "@/lib/site";

import "./globals.css";

/**
 * Technical metadata is set in a monospace throughout the interface. Loaded
 * through next/font so it is self-hosted, preloaded and subsetted, with no
 * third-party request and no layout shift.
 */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

/**
 * Cabinet Grotesk is self-hosted and fetched once with `npm run fetch:fonts`
 * (see README → Typeface). Resolved at module load so a deployment that has
 * not fetched it yet does not preload a file that is not there — the
 * metric-matched fallback carries the layout until it arrives.
 */
const DISPLAY_FONT = "/fonts/CabinetGrotesk-Variable.woff2";
const displayFontPresent = existsSync(join(process.cwd(), "public", DISPLAY_FONT));

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.operator}`,
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.operator }],
  creator: SITE.operator,
  keywords: [
    "MAKZ",
    "Karol Kuklinski",
    "design",
    "brand identity",
    "livestream",
    "Minecraft server",
    "poster design",
    "Birmingham",
  ],
  openGraph: {
    type: "website",
    url: SITE.url,
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.operator}`,
    description: SITE.description,
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.operator}`,
    description: SITE.description,
  },
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0d10" },
    { media: "(prefers-color-scheme: light)", color: "#edeae2" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={mono.variable} suppressHydrationWarning>
      <head>
        {/* Material and motion are resolved before first paint so the
            environment never flashes the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
        {displayFontPresent ? (
          <link
            rel="preload"
            href={DISPLAY_FONT}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ) : null}
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
