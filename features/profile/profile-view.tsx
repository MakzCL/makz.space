"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Avatar } from "@/components/ui/avatar";
import { SplitText } from "@/components/ui/split-text";
import { ActionLink } from "@/components/ui/action";
import { Rolling } from "@/components/ui/rolling";
import { formatDate, formatRelative } from "@/lib/utils";
import type { ActivityEntry, Profile, SavedItem } from "@/types";

const ACTIVITY_COPY: Record<string, string> = {
  "account.created": "Joined the environment",
  "profile.updated": "Updated their profile",
  "item.saved": "Kept",
  "item.unsaved": "Released",
};

/**
 * THE PROFILE
 *
 * An account record set the same way as a work record: index, name at display
 * scale, facts on a rule, then contents. It is deliberately not a social
 * profile — no follower count, no feed, no avatar in a circle.
 */
export function ProfileView({
  profile,
  saved,
  activity,
  isOwner,
  showActivity,
}: {
  profile: Profile;
  saved: SavedItem[];
  activity: ActivityEntry[];
  isOwner: boolean;
  showActivity: boolean;
}) {
  const reduced = useReducedMotion();
  const name = profile.display_name || profile.username;

  return (
    <article>
      <header className="gutter pt-8 md:pt-12">
        <motion.div
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={motionPreset.interface}
          className="flex items-center gap-3"
        >
          <span className="t-micro text-[var(--color-signal)]">PROFILE</span>
          <span aria-hidden className="block h-px w-8 bg-[var(--color-line-strong)]" />
          <span className="t-micro text-[var(--color-paper-20)]">
            /u/{profile.username}
          </span>
          {profile.role === "admin" ? (
            <span className="t-micro border border-[var(--color-signal)] px-1.5 py-0.5 text-[var(--color-signal)]">
              OPERATOR
            </span>
          ) : null}
        </motion.div>

        <div className="mt-7 flex flex-wrap items-end gap-6">
          <motion.div
            initial={reduced ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={motionPreset.reveal}
          >
            <Avatar name={name} src={profile.avatar_url} size={84} />
          </motion.div>

          <div className="min-w-0">
            <SplitText
              as="h1"
              by="char"
              delay={0.08}
              className="t-display block text-[var(--color-paper)]"
            >
              {name}
            </SplitText>
            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...motionPreset.interface, delay: 0.3 }}
              className="t-micro mt-3 text-[var(--color-paper-35)]"
            >
              @{profile.username}
            </motion.p>
          </div>
        </div>

        {profile.bio ? (
          <motion.p
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionPreset.reveal, delay: 0.34 }}
            className="t-lead mt-8 max-w-[54ch] t-pretty"
          >
            {profile.bio}
          </motion.p>
        ) : isOwner ? (
          <motion.p
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...motionPreset.interface, delay: 0.34 }}
            className="t-body mt-8 max-w-[46ch]"
          >
            No bio yet.{" "}
            <Link
              href="/settings#profile"
              className="border-b border-[var(--color-signal)] text-[var(--color-signal)]"
            >
              Write one
            </Link>
            .
          </motion.p>
        ) : null}

        {isOwner ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <ActionLink href="/settings" tone="line">
              Edit profile
            </ActionLink>
            <ActionLink href="/saved" tone="ghost">
              Saved records
            </ActionLink>
          </div>
        ) : null}
      </header>

      {/* ---- FACTS -------------------------------------------------------- */}
      <dl className="mt-10 grid grid-cols-2 border-y border-[var(--color-line)] md:grid-cols-4">
        {[
          { label: "Joined", value: formatDate(profile.created_at, "short") },
          {
            label: "Kept",
            value: <Rolling value={String(saved.length).padStart(2, "0")} />,
          },
          { label: "Location", value: profile.location || "—" },
          {
            label: "Last seen",
            value: profile.last_seen_at ? formatRelative(profile.last_seen_at) : "—",
          },
        ].map((fact, i) => (
          <motion.div
            key={fact.label}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ ...motionPreset.reveal, delay: i * stagger.item }}
            className="border-b border-r border-[var(--color-line)] px-[var(--unit-gutter)] py-5 last:border-r-0 md:border-b-0 md:px-6 [&:nth-child(2n)]:border-r-0 md:[&:nth-child(2n)]:border-r"
          >
            <dt className="t-micro text-[var(--color-paper-20)]">{fact.label}</dt>
            <dd className="t-ui t-tabular mt-2.5 text-[var(--color-paper)]">
              {fact.value}
            </dd>
          </motion.div>
        ))}
      </dl>

      {profile.website ? (
        <div className="gutter border-b border-[var(--color-line)] py-4">
          <a
            href={profile.website}
            target="_blank"
            rel="noreferrer noopener nofollow"
            data-cursor="external"
            className="t-meta text-[var(--color-paper-70)] transition-colors duration-200 hover:text-[var(--color-signal)]"
          >
            {profile.website.replace(/^https?:\/\//, "")} ↗
          </a>
        </div>
      ) : null}

      {/* ---- CONTENTS ------------------------------------------------------ */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <section className="border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-9 lg:border-b-0 lg:border-r">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="t-micro text-[var(--color-paper-35)]">Kept records</h2>
            <span className="t-micro t-tabular text-[var(--color-paper-20)]">
              {String(saved.length).padStart(2, "0")}
            </span>
          </div>

          {saved.length === 0 ? (
            <p className="t-body mt-6 max-w-[42ch]">
              {isOwner
                ? "Nothing kept yet. The keep control sits at the top of every record."
                : "This account has not kept anything publicly."}
            </p>
          ) : (
            <ul role="list" className="mt-6">
              {saved.slice(0, 8).map((item, i) => (
                <motion.li
                  key={item.id}
                  initial={reduced ? false : { opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ ...motionPreset.reveal, delay: i * stagger.item }}
                  className="border-t border-[var(--color-line)]"
                >
                  <Link
                    href={item.item_href}
                    className="group flex items-center gap-4 py-3.5"
                  >
                    <span className="t-micro w-12 shrink-0 text-[var(--color-paper-20)]">
                      {item.item_type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-paper)] transition-colors duration-200 group-hover:text-[var(--color-signal)]">
                      {item.item_title}
                    </span>
                    <span
                      aria-hidden
                      className="t-micro shrink-0 text-[var(--color-paper-20)] transition-transform duration-200 group-hover:translate-x-1"
                    >
                      →
                    </span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </section>

        <section className="px-[var(--unit-gutter)] py-9">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="t-micro text-[var(--color-paper-35)]">Activity</h2>
            <span className="t-micro text-[var(--color-paper-20)]">
              {showActivity ? "Visible" : "Private"}
            </span>
          </div>

          {!showActivity ? (
            <p className="t-body mt-6 max-w-[42ch]">
              This account keeps its activity private.
            </p>
          ) : activity.length === 0 ? (
            <p className="t-body mt-6 max-w-[42ch]">Nothing recorded yet.</p>
          ) : (
            <ol role="list" className="mt-6">
              {activity.slice(0, 10).map((entry, i) => (
                <motion.li
                  key={entry.id}
                  initial={reduced ? false : { opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ ...motionPreset.reveal, delay: i * stagger.item * 0.7 }}
                  className="flex items-baseline gap-4 border-t border-[var(--color-line)] py-3"
                >
                  <span className="t-micro w-[7.5rem] shrink-0 leading-[1.5] text-[var(--color-paper-20)]">
                    {formatRelative(entry.created_at)}
                  </span>
                  <span className="t-micro leading-[1.7] text-[var(--color-paper-70)]">
                    {ACTIVITY_COPY[entry.kind] ?? entry.kind}
                    {entry.subject ? (
                      <span className="text-[var(--color-paper-35)]"> — {entry.subject}</span>
                    ) : null}
                  </span>
                </motion.li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </article>
  );
}
