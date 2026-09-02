import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WORK, adjacentWork, getWork } from "@/lib/data/work";
import { isSaved } from "@/lib/data/saved";
import { RecordView } from "@/features/work/record-view";
import { SITE } from "@/lib/site";

export function generateStaticParams() {
  return WORK.map((record) => ({ slug: record.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const record = getWork(slug);
  if (!record) return { title: "Record not found" };

  return {
    title: record.title,
    description: record.summary,
    alternates: { canonical: `/work/${record.slug}` },
    openGraph: {
      title: `${record.title} — ${SITE.name}`,
      description: record.summary,
      images: [{ url: record.cover.src, alt: record.cover.alt }],
    },
  };
}

export default async function RecordPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const record = getWork(slug);
  if (!record) notFound();

  const [saved, { previous, next }] = await Promise.all([
    isSaved("work", record.slug),
    Promise.resolve(adjacentWork(record.slug)),
  ]);

  return (
    <>
      <RecordView record={record} saved={saved} previous={previous} next={next} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CreativeWork",
            name: record.title,
            headline: record.subtitle,
            description: record.summary,
            dateCreated: record.year,
            creator: { "@type": "Person", name: SITE.operator },
            url: `${SITE.url}/work/${record.slug}`,
          }),
        }}
      />
    </>
  );
}
