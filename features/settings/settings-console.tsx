"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { duration, ease, motionPreset, spring, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useEnvironment } from "@/components/shell/environment";
import { useToast } from "@/components/shell/toaster";
import { Field, AreaField } from "@/components/ui/field";
import { Switch, Segmented } from "@/components/ui/switch";
import { Action } from "@/components/ui/action";
import { Avatar } from "@/components/ui/avatar";
import { signOutAction, updateProfileAction, updatePreferencesAction } from "@/features/account/actions";
import { requestResetAction } from "@/features/account/actions";
import type { ActionResult } from "@/features/account/schema";
import { formatDate, cx } from "@/lib/utils";
import type { Viewer } from "@/types";

const PANELS = [
  { id: "general", index: "01", name: "General" },
  { id: "profile", index: "02", name: "Profile" },
  { id: "appearance", index: "03", name: "Appearance" },
  { id: "privacy", index: "04", name: "Privacy" },
  { id: "security", index: "05", name: "Security" },
  { id: "account", index: "06", name: "Account" },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

/**
 * SETTINGS
 *
 * A console, not a form page: a numbered panel index down the side and one
 * panel at a time in the stage, swapped under a directional mask. Controls
 * are the system's own — ruled fields, two-position switches, travelling
 * segment markers — never browser defaults.
 *
 * Appearance and motion apply the instant they are touched and are written to
 * the account in the background; everything else is saved explicitly.
 */
export function SettingsConsole({ viewer }: { viewer: Viewer }) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const { notify } = useToast();
  const environment = useEnvironment();

  const [panel, setPanel] = useState<PanelId>("general");
  const [order, setOrder] = useState(1);

  const move = (next: PanelId) => {
    const from = PANELS.findIndex((p) => p.id === panel);
    const to = PANELS.findIndex((p) => p.id === next);
    setOrder(to > from ? 1 : -1);
    setPanel(next);
  };

  // Deep links from the profile page (/settings#profile).
  useEffect(() => {
    const hash = window.location.hash.slice(1) as PanelId;
    if (PANELS.some((p) => p.id === hash)) setPanel(hash);
  }, []);

  return (
    <div className="grid grid-cols-1 border-t border-[var(--color-line)] lg:grid-cols-[15rem_1fr]">
      {/* ---- PANEL INDEX ------------------------------------------------ */}
      <nav
        aria-label="Settings sections"
        className="flex overflow-x-auto border-b border-[var(--color-line)] lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r"
      >
        {PANELS.map((entry) => {
          const active = entry.id === panel;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => move(entry.id)}
              aria-current={active ? "true" : undefined}
              data-cursor="focus"
              className={cx(
                "relative flex shrink-0 items-center gap-3 px-4 py-4 text-left transition-colors duration-200 lg:px-5",
                active
                  ? "text-[var(--color-paper)]"
                  : "text-[var(--color-paper-35)] hover:text-[var(--color-paper-70)]",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="settings-mark"
                  aria-hidden
                  transition={reduced ? { duration: 0 } : spring.snap}
                  className="absolute bottom-0 left-0 block h-[2px] w-full bg-[var(--color-signal)] lg:inset-y-0 lg:h-auto lg:w-[2px]"
                />
              ) : null}
              <span className="t-micro t-tabular text-[var(--color-paper-20)]">
                {entry.index}
              </span>
              <span className="t-meta whitespace-nowrap">{entry.name}</span>
            </button>
          );
        })}
      </nav>

      {/* ---- PANEL ------------------------------------------------------- */}
      <div className="relative min-h-[32rem] overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={panel}
            aria-label={PANELS.find((p) => p.id === panel)?.name}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: order * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={
              reduced
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    x: order * -20,
                    transition: { duration: duration.fast, ease: ease.in },
                  }
            }
            transition={motionPreset.reveal}
            className="px-[var(--unit-gutter)] py-9"
          >
            {panel === "general" ? <General viewer={viewer} /> : null}
            {panel === "profile" ? (
              <ProfilePanel viewer={viewer} onSaved={() => router.refresh()} />
            ) : null}
            {panel === "appearance" ? <Appearance /> : null}
            {panel === "privacy" ? <Privacy viewer={viewer} /> : null}
            {panel === "security" ? (
              <Security viewer={viewer} notify={notify} />
            ) : null}
            {panel === "account" ? <AccountPanel viewer={viewer} /> : null}
          </motion.section>
        </AnimatePresence>
      </div>
    </div>
  );

  function Appearance() {
    return (
      <PanelBody
        title="Appearance"
        lede="Applies immediately and is written to your account, so the environment looks the same on every device you sign in from."
      >
        <Row label="Material" hint="Day inverts the material without changing the accent.">
          <Segmented
            name="appearance"
            label="Material"
            value={environment.appearance}
            onChange={environment.setAppearance}
            options={[
              { value: "dark", label: "Dark", hint: "Default" },
              { value: "day", label: "Day", hint: "Paper" },
              { value: "system", label: "Auto", hint: "Follow OS" },
            ]}
          />
        </Row>

        <Row
          label="Motion"
          hint="Reduced keeps every state change but removes the travel between them. Your operating system's own setting always wins."
        >
          <Segmented
            name="motion"
            label="Motion"
            value={environment.motion}
            onChange={environment.setMotion}
            options={[
              { value: "full", label: "Full", hint: "Authored" },
              { value: "reduced", label: "Reduced", hint: "Still" },
            ]}
          />
        </Row>
      </PanelBody>
    );
  }
}

/* ---- PANELS -------------------------------------------------------------- */

function General({ viewer }: { viewer: Viewer }) {
  return (
    <PanelBody
      title="General"
      lede="What this account is and when it started."
    >
      <div className="flex items-center gap-5 border-b border-[var(--color-line)] pb-6">
        <Avatar
          name={viewer.profile.display_name || viewer.profile.username}
          src={viewer.profile.avatar_url}
          size={56}
        />
        <div className="min-w-0">
          <p className="text-[1.15rem] font-semibold tracking-[-0.025em] text-[var(--color-paper)]">
            {viewer.profile.display_name || viewer.profile.username}
          </p>
          <p className="t-micro mt-1.5 text-[var(--color-paper-35)]">
            @{viewer.profile.username}
          </p>
        </div>
      </div>

      <dl>
        {[
          { label: "Email", value: viewer.email ?? "—" },
          { label: "Role", value: viewer.profile.role },
          { label: "Joined", value: formatDate(viewer.profile.created_at) },
          { label: "Updated", value: formatDate(viewer.profile.updated_at) },
          { label: "Address", value: `/u/${viewer.profile.username}` },
        ].map((row) => (
          <div
            key={row.label}
            className="flex items-baseline gap-5 border-b border-[var(--color-line)] py-3.5"
          >
            <dt className="t-micro w-24 shrink-0 text-[var(--color-paper-20)]">
              {row.label}
            </dt>
            <dd className="t-ui break-all text-[var(--color-paper)]">{row.value}</dd>
          </div>
        ))}
      </dl>
    </PanelBody>
  );
}

function ProfilePanel({
  viewer,
  onSaved,
}: {
  viewer: Viewer;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [state, submit, pending] = useActionState<ActionResult | null, FormData>(
    updateProfileAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    notify({
      label: state.ok ? "Profile saved" : "Not saved",
      detail: state.ok ? undefined : state.message,
      tone: state.ok ? "signal" : "fault",
    });
    if (state.ok) onSaved();
  }, [notify, onSaved, state]);

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <PanelBody
      title="Profile"
      lede="Everything here is public on your profile page unless you make the profile private."
    >
      <form action={submit} noValidate className="flex max-w-[34rem] flex-col gap-3">
        <Field
          index="01"
          label="Handle"
          name="username"
          defaultValue={viewer.profile.username}
          required
          minLength={3}
          maxLength={24}
          hint={`Your address becomes /u/${viewer.profile.username}`}
          error={errors.username}
        />
        <Field
          index="02"
          label="Display name"
          name="display_name"
          defaultValue={viewer.profile.display_name ?? ""}
          maxLength={60}
          error={errors.display_name}
        />
        <AreaField
          index="03"
          label="Bio"
          name="bio"
          defaultValue={viewer.profile.bio ?? ""}
          maxLength={400}
          hint="400 characters."
          error={errors.bio}
        />
        <Field
          index="04"
          label="Location"
          name="location"
          defaultValue={viewer.profile.location ?? ""}
          maxLength={80}
          error={errors.location}
        />
        <Field
          index="05"
          label="Website"
          name="website"
          type="url"
          inputMode="url"
          defaultValue={viewer.profile.website ?? ""}
          placeholder="https://"
          error={errors.website}
        />
        <Field
          index="06"
          label="Avatar URL"
          name="avatar_url"
          type="url"
          inputMode="url"
          defaultValue={viewer.profile.avatar_url ?? ""}
          placeholder="https://"
          hint="An https image URL. Leave empty for the generated mark."
          error={errors.avatar_url}
        />

        <Action type="submit" tone="solid" disabled={pending} className="mt-6">
          {pending ? "Saving…" : "Save profile"}
        </Action>
      </form>
    </PanelBody>
  );
}

function Privacy({ viewer }: { viewer: Viewer }) {
  const { notify } = useToast();
  const environment = useEnvironment();
  const [visibility, setVisibility] = useState(viewer.profile.profile_visibility);
  const [showActivity, setShowActivity] = useState(viewer.preferences.show_activity);
  const [emailUpdates, setEmailUpdates] = useState(viewer.preferences.email_updates);
  const [pending, start] = useTransition();

  const save = () => {
    const form = new FormData();
    form.set("appearance", environment.appearance);
    form.set("motion", environment.motion);
    form.set("profile_visibility", visibility);
    if (showActivity) form.set("show_activity", "on");
    if (emailUpdates) form.set("email_updates", "on");

    start(async () => {
      const result = await updatePreferencesAction(null, form);
      notify({
        label: result.ok ? "Privacy saved" : "Not saved",
        detail: result.ok ? undefined : result.message,
        tone: result.ok ? "signal" : "fault",
      });
    });
  };

  return (
    <PanelBody
      title="Privacy"
      lede="Who can see your record, and what appears on it."
    >
      <Row
        label="Profile visibility"
        hint="Private removes your profile from public view entirely. Your saved records are private either way."
      >
        <Segmented
          name="visibility"
          label="Profile visibility"
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "public", label: "Public", hint: "Anyone" },
            { value: "private", label: "Private", hint: "Only you" },
          ]}
        />
      </Row>

      <div className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
        <Switch
          checked={showActivity}
          onChange={setShowActivity}
          label="Show activity on my profile"
          description="Joining, profile edits and records you keep. Hidden entirely when switched off."
        />
        <Switch
          checked={emailUpdates}
          onChange={setEmailUpdates}
          label="Occasional email updates"
          description="Only when something substantial ships. Off by default and never shared."
        />
      </div>

      <Action tone="solid" onClick={save} disabled={pending} className="mt-6">
        {pending ? "Saving…" : "Save privacy"}
      </Action>
    </PanelBody>
  );
}

function Security({
  viewer,
  notify,
}: {
  viewer: Viewer;
  notify: (input: { label: string; detail?: string; tone?: "neutral" | "signal" | "fault" }) => void;
}) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);

  const sendReset = () => {
    if (!viewer.email) return;
    const form = new FormData();
    form.set("email", viewer.email);
    start(async () => {
      const result = await requestResetAction(null, form);
      setSent(result.ok);
      notify({
        label: result.ok ? "Reset link sent" : "Could not send",
        detail: result.message,
        tone: result.ok ? "signal" : "fault",
      });
    });
  };

  return (
    <PanelBody
      title="Security"
      lede="Sessions and credentials. Passwords are hashed by the auth provider — this application never sees or stores one."
    >
      <Row
        label="Password"
        hint="Sends a single-use link to your address. Following it brings you back here to set a new one."
      >
        <Action tone="line" onClick={sendReset} disabled={pending || !viewer.email}>
          {pending ? "Sending…" : sent ? "Link sent" : "Send reset link"}
        </Action>
      </Row>

      <Row
        label="Sessions"
        hint="Signing out clears the session cookie on this device. It does not affect other devices."
      >
        <Action tone="line" onClick={() => void signOutAction()}>
          Sign out here
        </Action>
      </Row>

      <div className="mt-2 border-t border-[var(--color-line)] pt-5">
        <p className="t-micro max-w-[60ch] leading-[1.9] text-[var(--color-paper-20)]">
          Sessions are stored in httpOnly cookies, rotated on every navigation
          and validated against the auth server on each request. Nothing about
          your account is kept in this browser&apos;s local storage.
        </p>
      </div>
    </PanelBody>
  );
}

function AccountPanel({ viewer }: { viewer: Viewer }) {
  return (
    <PanelBody
      title="Account"
      lede="What is stored, and how to have it removed."
    >
      <dl>
        {[
          {
            label: "Profile",
            value: "Handle, display name, bio, location, website, avatar URL.",
          },
          {
            label: "Preferences",
            value: "Appearance, motion, activity visibility, email opt-in.",
          },
          { label: "Saved", value: "The records you kept, and when." },
          { label: "Activity", value: "Account created, profile edits, keeps and releases." },
          { label: "Never stored", value: "Passwords, payment details, tracking profiles." },
        ].map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-2 border-b border-[var(--color-line)] py-4 sm:flex-row sm:gap-5"
          >
            <dt className="t-micro w-28 shrink-0 text-[var(--color-paper-20)]">
              {row.label}
            </dt>
            <dd className="t-micro max-w-[52ch] leading-[1.85] text-[var(--color-paper-70)]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 border-l-2 border-[var(--color-signal)] pl-5">
        <p className="t-meta text-[var(--color-signal)]">Deleting the account</p>
        <p className="t-micro mt-3 max-w-[54ch] leading-[1.9] text-[var(--color-paper-50)]">
          Deletion removes the auth user and cascades to the profile,
          preferences, saved records and activity — there is nothing left
          afterwards. It is deliberately not a button here: message{" "}
          <a
            href="https://discord.gg/HWUrCtQar8"
            target="_blank"
            rel="noreferrer noopener"
            className="border-b border-[var(--color-signal)] text-[var(--color-signal)]"
          >
            the Discord
          </a>{" "}
          from{" "}
          <span className="text-[var(--color-paper-70)]">{viewer.email}</span> and
          it is done within a day.
        </p>
      </div>
    </PanelBody>
  );
}

/* ---- PANEL FURNITURE ------------------------------------------------------ */

function PanelBody({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="max-w-[46rem]">
      <motion.h2
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionPreset.reveal}
        className="t-title text-[var(--color-paper)]"
      >
        {title}
      </motion.h2>
      <motion.p
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionPreset.reveal, delay: stagger.item }}
        className="t-body mt-4 max-w-[56ch]"
      >
        {lede}
      </motion.p>
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionPreset.reveal, delay: stagger.item * 2 }}
        className="mt-9"
      >
        {children}
      </motion.div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--color-line)] py-6 first:border-t-0 first:pt-0">
      <p className="t-meta text-[var(--color-paper)]">{label}</p>
      {hint ? (
        <p className="t-micro mt-2 max-w-[54ch] leading-[1.85] text-[var(--color-paper-35)]">
          {hint}
        </p>
      ) : null}
      <div className="mt-4 max-w-[26rem]">{children}</div>
    </div>
  );
}
