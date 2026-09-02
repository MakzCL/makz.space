"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

import { Frame } from "@/components/media/frame";
import { SplitText } from "@/components/ui/split-text";
import { ActionLink } from "@/components/ui/action";
import { SaveControl } from "@/features/saved/save-control";
import { useStageScroll } from "@/components/shell/stage-scroll";
import { ProcessSequence } from "./process-sequence";
import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";
import type { WorkRecord } from "@/types";

/**
 * THE RECORD
 *
 * A case study, composed as an editorial spread rather than a stack of
 * sections. The cover holds the top of the stage and drifts under the title
 * as you leave it; body sections are numbered and hang off a rule with their
 * facts in the margin; media is full-bleed where it earns it.
 */
export function RecordView({
  record,
  saved,
  previous,
  next,
}: {
  record: WorkRecord;
  saved: boolean;
  previous?: WorkRecord;
  next?: WorkRecord;
}) {
  const reduced = useReducedMotion();
  const cover = useRef<HTMLDivElement>(null);
  const container = useStageScroll();

  const { scrollYProgress } = useScroll({
    target: cover,
    container,
    offset: ["start start", "end start"],
  });
  const coverY = useTransform(scrollYProgress, [0, 1], ["0%", reduced ? "0%" : "22%"]);
  const coverFade = useTransform(scrollYProgress, [0, 0.9], [1, reduced ? 1 : 0.25]);

  return (
    <article>
      {/* ---- COVER ---------------------------------------------------- */}
      <div ref={cover} className="relative">
        <motion.div
          style={{ y: coverY, opacity: coverFade }}
          className="relative h-[46vh] min-h-[19rem] w-full overflow-hidden border-b border-[var(--color-line)] md:h-[58vh]"
        >
          <Frame
            asset={record.cover}
            sizes="100vw"
            priority
            className="h-full w-full"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-[var(--color-base)] via-transparent to-transparent"
          />
        </motion.div>

        <div className="gutter relative -mt-[4.5rem] pb-8 md:-mt-24">
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={motionPreset.interface}
            className="flex items-center gap-3"
          >
            <span className="t-micro text-[var(--color-signal)]">{record.index}</span>
            <span aria-hidden className="block h-px w-8 bg-[var(--color-line-strong)]" />
            <span className="t-micro text-[var(--color-paper-35)]">
              {record.status.toUpperCase()} — {record.year}
            </span>
          </motion.div>

          <SplitText
            as="h1"
            by="char"
            delay={0.06}
            className="t-display mt-4 block text-[var(--color-paper)]"
          >
            {record.title}
          </SplitText>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionPreset.reveal, delay: 0.28 }}
            className="t-lead mt-5 max-w-[46ch] t-pretty"
          >
            {record.subtitle}
          </motion.p>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionPreset.reveal, delay: 0.36 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <SaveControl
              type="work"
              slug={record.slug}
              title={record.title}
              href={`/work/${record.slug}`}
              saved={saved}
            />
            {record.links.map((link) => (
              <ActionLink
                key={link.href}
                href={link.href}
                external={link.external}
                tone="line"
              >
                {link.label}
              </ActionLink>
            ))}
          </motion.div>
        </div>
      </div>

      {/* ---- FACTS ------------------------------------------------------ */}
      <dl className="grid grid-cols-2 border-y border-[var(--color-line)] md:grid-cols-4">
        {[
          { label: "Client", value: record.client },
          { label: "Role", value: record.role },
          { label: "Discipline", value: record.discipline.join(", ") },
          { label: "Year", value: record.year },
        ].map((fact, i) => (
          <motion.div
            key={fact.label}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ ...motionPreset.reveal, delay: i * stagger.item }}
            className="border-b border-r border-[var(--color-line)] px-[var(--unit-gutter)] py-5 last:border-r-0 md:border-b-0 md:px-6 [&:nth-child(2n)]:border-r-0 md:[&:nth-child(2n)]:border-r"
          >
            <dt className="t-micro text-[var(--color-paper-20)]">{fact.label}</dt>
            <dd className="t-ui mt-2.5 leading-relaxed text-[var(--color-paper)]">
              {fact.value}
            </dd>
          </motion.div>
        ))}
      </dl>

      {/* ---- SUMMARY ---------------------------------------------------- */}
      <div className="gutter py-12 md:py-20">
        <p className="max-w-[34ch] text-[clamp(1.35rem,3.2vw,2.35rem)] font-medium leading-[1.22] tracking-[-0.03em] text-[var(--color-paper)] t-pretty">
          {record.summary}
        </p>
      </div>

      {/* ---- BODY ------------------------------------------------------- */}
      <div className="border-t border-[var(--color-line)]">
        {record.sections.map((section) => (
          <section
            key={section.index}
            className="grid grid-cols-1 gap-y-6 border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-10 md:grid-cols-12 md:gap-x-8 md:py-14"
          >
            <div className="md:col-span-3">
              <div className="sticky top-6">
                <span className="t-micro text-[var(--color-signal)]">{section.index}</span>
                <h2 className="mt-3 text-[1.25rem] font-bold leading-tight tracking-[-0.03em] text-[var(--color-paper)]">
                  {section.heading}
                </h2>
              </div>
            </div>

            <div className="md:col-span-6">
              {section.body.map((paragraph, i) => (
                <motion.p
                  key={i}
                  initial={reduced ? false : { opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-12% 0px" }}
                  transition={{ ...motionPreset.reveal, delay: i * stagger.item }}
                  className="t-body mt-0 max-w-[60ch] [&+&]:mt-5"
                >
                  {paragraph}
                </motion.p>
              ))}
            </div>

            {section.aside ? (
              <dl className="md:col-span-3">
                {section.aside.map((row, i) => (
                  <div
                    key={`${row.label}-${i}`}
                    className="flex gap-3 border-t border-[var(--color-line)] py-2.5 first:border-t-0 first:pt-0"
                  >
                    {row.label ? (
                      <dt className="t-micro w-16 shrink-0 pt-0.5 text-[var(--color-paper-20)]">
                        {row.label}
                      </dt>
                    ) : (
                      <dt className="w-16 shrink-0" />
                    )}
                    <dd className="t-micro leading-[1.75] text-[var(--color-paper-70)]">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ))}
      </div>

      {/* ---- GALLERY ----------------------------------------------------- */}
      {record.gallery.length > 0 ? (
        <section aria-label="Gallery" className="border-b border-[var(--color-line)]">
          <div className="gutter flex items-baseline justify-between gap-6 py-5">
            <h2 className="t-micro text-[var(--color-paper-35)]">Gallery</h2>
            <span className="t-micro t-tabular text-[var(--color-paper-20)]">
              {String(record.gallery.length).padStart(2, "0")} items
            </span>
          </div>
          <div className="grid grid-cols-1 border-t border-[var(--color-line)] lg:grid-cols-2">
            {record.gallery.map((asset, i) => (
              <figure
                key={asset.src + i}
                className={cx(
                  "border-b border-[var(--color-line)] lg:border-r lg:[&:nth-child(2n)]:border-r-0",
                  record.gallery.length % 2 === 1 && i === record.gallery.length - 1
                    ? "lg:col-span-2 lg:border-r-0"
                    : "",
                )}
              >
                <Frame
                  asset={asset}
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  parallax={4}
                  cursor="view"
                />
                {asset.caption ? (
                  <figcaption className="flex items-baseline gap-4 px-[var(--unit-gutter)] py-4">
                    <span className="t-micro text-[var(--color-signal)]">{asset.meta}</span>
                    <span className="t-micro leading-[1.7] text-[var(--color-paper-35)]">
                      {asset.caption}
                    </span>
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- PROCESS -------------------------------------------------------
           Full width: the sequence pins, so nothing may share its row. */}
      <section
        aria-label="Process"
        className="border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-10"
      >
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="t-micro text-[var(--color-paper-35)]">Process</h2>
          <span className="t-micro t-tabular text-[var(--color-paper-20)]">
            {String(record.timeline.length).padStart(2, "0")} phases
          </span>
        </div>
        <ProcessSequence phases={record.timeline} />
      </section>

      {/* ---- STACK + CREDITS ------------------------------------------------ */}
      <div className="grid grid-cols-1 border-b border-[var(--color-line)] lg:grid-cols-2">
        <section
          aria-label="Technical"
          className="border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-10 lg:border-b-0 lg:border-r"
        >
          <h2 className="t-micro text-[var(--color-paper-35)]">Built with</h2>
          <ul role="list" className="mt-6 flex flex-wrap gap-x-3 gap-y-2">
            {record.stack.map((item, i) => (
              <motion.li
                key={item}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ ...motionPreset.fast, delay: i * 0.03 }}
                className="border border-[var(--color-edge)] px-2.5 py-1.5"
              >
                <span className="t-micro text-[var(--color-paper-70)]">{item}</span>
              </motion.li>
            ))}
          </ul>
        </section>

        <section aria-label="Credits" className="px-[var(--unit-gutter)] py-10">
          <h2 className="t-micro text-[var(--color-paper-35)]">Credits</h2>
          <dl className="mt-6">
            {record.credits.map((credit) => (
              <div
                key={credit.role}
                className="flex items-baseline gap-4 border-t border-[var(--color-line)] py-3"
              >
                <dt className="t-micro w-40 shrink-0 text-[var(--color-paper-20)]">
                  {credit.role}
                </dt>
                <dd className="t-ui text-[var(--color-paper)]">{credit.name}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* ---- ADJACENT ------------------------------------------------------ */}
      <nav aria-label="Other records" className="grid grid-cols-1 md:grid-cols-2">
        {previous ? <Adjacent record={previous} direction="prev" /> : null}
        {next ? <Adjacent record={next} direction="next" /> : null}
      </nav>
    </article>
  );
}

function Adjacent({
  record,
  direction,
}: {
  record: WorkRecord;
  direction: "prev" | "next";
}) {
  return (
    <Link
      href={`/work/${record.slug}`}
      data-cursor={direction === "next" ? "next" : "prev"}
      className={cx(
        "group flex flex-col gap-3 border-t border-[var(--color-line)] px-[var(--unit-gutter)] py-8 transition-colors duration-200 hover:bg-[var(--color-surface)]",
        direction === "next" ? "md:border-l md:text-right" : "",
      )}
    >
      <span
        className={cx(
          "t-micro flex items-center gap-2 text-[var(--color-paper-20)]",
          direction === "next" ? "md:justify-end" : "",
        )}
      >
        {direction === "prev" ? "← Previous" : "Next →"}
        <span className="t-tabular text-[var(--color-signal)]">{record.index}</span>
      </span>
      <span className="t-title text-[var(--color-paper)] transition-colors duration-200 group-hover:text-[var(--color-signal)]">
        {record.title}
      </span>
      <span className="t-micro max-w-[44ch] leading-[1.7] text-[var(--color-paper-35)] md:max-w-none">
        {record.subtitle}
      </span>
    </Link>
  );
}
