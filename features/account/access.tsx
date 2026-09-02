"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";

import { SITE } from "@/lib/site";
import { duration, ease, motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Field } from "@/components/ui/field";
import { Action } from "@/components/ui/action";
import { useToast } from "@/components/shell/toaster";
import { cx } from "@/lib/utils";

import {
  requestResetAction,
  signInAction,
  signUpAction,
} from "./actions";
import type { ActionResult } from "./schema";

type Mode = "enter" | "create" | "recover";

const COPY: Record<Mode, { word: string; line: string; cta: string }> = {
  enter: {
    word: "ENTER",
    line: "Sign in to keep records, set the environment to your taste, and carry it between devices.",
    cta: "Sign in",
  },
  create: {
    word: "CREATE",
    line: "An account is a handle, a profile and a place to keep things. Nothing else is collected.",
    cta: "Create account",
  },
  recover: {
    word: "RECOVER",
    line: "Give the address on the account and a single-use link will be sent to it.",
    cta: "Send reset link",
  },
};

const FAULTS: Record<string, string> = {
  "missing-code": "That link was incomplete. Request a new one.",
  expired: "That link has expired or was already used.",
  "not-configured": "The account layer is not configured on this deployment.",
};

/**
 * THE ACCESS LAYER
 *
 * Not a login page. The environment restructures: the stage splits, the mode
 * becomes display type on the left, and the form arrives as a ruled column on
 * the right with no box around it. Changing mode swaps the word under a mask
 * and re-staggers the fields — the surface reconfigures rather than
 * navigating.
 *
 * URLs stay honest: /account, /account?mode=create, /account?mode=recover.
 */
export function Access({
  initialMode,
  next,
  fault,
}: {
  initialMode: Mode;
  next?: string;
  fault?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const reduced = useReducedMotion();
  const { notify } = useToast();

  const [signInState, signIn, signingIn] = useActionState<ActionResult | null, FormData>(
    signInAction,
    null,
  );
  const [signUpState, signUp, signingUp] = useActionState<ActionResult | null, FormData>(
    signUpAction,
    null,
  );
  const [resetState, reset, resetting] = useActionState<ActionResult | null, FormData>(
    requestResetAction,
    null,
  );

  const state =
    mode === "enter" ? signInState : mode === "create" ? signUpState : resetState;
  const pending = mode === "enter" ? signingIn : mode === "create" ? signingUp : resetting;

  useEffect(() => {
    if (fault && FAULTS[fault]) {
      notify({ label: "Link problem", detail: FAULTS[fault], tone: "fault" });
    }
  }, [fault, notify]);

  useEffect(() => {
    if (state?.ok && state.message) {
      notify({ label: state.message, tone: "signal" });
    }
  }, [notify, state]);

  const copy = COPY[mode];
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <div className="grid min-h-[calc(100dvh-var(--unit-ledger)-var(--unit-dock))] grid-cols-1 lg:min-h-[calc(100dvh-var(--unit-ledger)-var(--unit-deck))] lg:grid-cols-[1.1fr_1fr]">
      {/* ---- LEFT: the mode, as type ---------------------------------- */}
      <section className="relative flex flex-col justify-between border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-8 lg:border-b-0 lg:border-r lg:py-12">
        <div className="flex items-center gap-3">
          <span className="t-micro text-[var(--color-signal)]">ACCESS</span>
          <span aria-hidden className="block h-px w-8 bg-[var(--color-line-strong)]" />
          <span className="t-micro text-[var(--color-paper-20)]">{SITE.domain}</span>
        </div>

        <div className="py-10 lg:py-0">
          <h1 className="sr-only">
            {copy.cta} — {SITE.name}
          </h1>

          <span className="reveal-clip block">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={mode}
                aria-hidden
                className="block text-[clamp(2.75rem,8.5vw,7.5rem)] font-extrabold leading-[0.82] tracking-[-0.045em] text-[var(--color-paper)]"
                initial={reduced ? { opacity: 0 } : { y: "104%" }}
                animate={reduced ? { opacity: 1 } : { y: "0%" }}
                exit={
                  reduced
                    ? { opacity: 0 }
                    : { y: "-104%", transition: { duration: duration.interface, ease: ease.in } }
                }
                transition={motionPreset.reveal}
              >
                {copy.word}
              </motion.span>
            </AnimatePresence>
          </span>

          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={mode}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: duration.fast } }}
              transition={{ ...motionPreset.reveal, delay: 0.12 }}
              className="t-lead mt-7 max-w-[42ch] t-pretty"
            >
              {copy.line}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Mode selector. Three positions on one rule. */}
        <nav aria-label="Access mode" className="flex flex-wrap gap-x-1 gap-y-2">
          {(Object.keys(COPY) as Mode[]).map((option) => {
            const active = option === mode;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                aria-pressed={active}
                data-cursor="focus"
                className={cx(
                  "relative px-3 py-2.5 transition-colors duration-200",
                  active
                    ? "text-[var(--color-paper)]"
                    : "text-[var(--color-paper-35)] hover:text-[var(--color-paper-70)]",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="access-mark"
                    aria-hidden
                    transition={reduced ? { duration: 0 } : motionPreset.interface}
                    className="absolute inset-x-2 bottom-0 block h-px bg-[var(--color-signal)]"
                  />
                ) : null}
                <span className="t-meta">{COPY[option].word}</span>
              </button>
            );
          })}
        </nav>
      </section>

      {/* ---- RIGHT: the form, as ruled lines ---------------------------- */}
      <section className="flex flex-col justify-center px-[var(--unit-gutter)] py-10 lg:py-12">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={reduced ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{
              opacity: 0,
              x: -18,
              transition: { duration: duration.fast, ease: ease.in },
            }}
            transition={motionPreset.reveal}
            className="w-full max-w-[26rem]"
          >
            {mode === "enter" ? (
              <form action={signIn} noValidate>
                <input type="hidden" name="next" value={next ?? ""} />
                <Stack>
                  <Field
                    index="01"
                    label="Email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                    error={errors.email}
                  />
                  <Field
                    index="02"
                    label="Password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="••••••••••"
                    error={errors.password}
                  />
                  <Remember />
                  <Submit pending={pending} label={copy.cta} />
                  <Fault state={state} />
                  <p className="t-micro text-[var(--color-paper-20)]">
                    Forgotten it?{" "}
                    <button
                      type="button"
                      onClick={() => setMode("recover")}
                      className="border-b border-[var(--color-paper-35)] pb-px text-[var(--color-paper-70)] transition-colors duration-200 hover:border-[var(--color-signal)] hover:text-[var(--color-signal)]"
                    >
                      Recover it
                    </button>
                  </p>
                </Stack>
              </form>
            ) : mode === "create" ? (
              <form action={signUp} noValidate>
                <Stack>
                  <Field
                    index="01"
                    label="Handle"
                    name="username"
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={24}
                    placeholder="karol"
                    hint="Lowercase letters, numbers, hyphen and underscore. This becomes your address."
                    error={errors.username}
                  />
                  <Field
                    index="02"
                    label="Display name"
                    name="displayName"
                    autoComplete="name"
                    maxLength={60}
                    placeholder="Karol Kuklinski"
                    hint="Optional. Shown instead of your handle."
                    error={errors.displayName}
                  />
                  <Field
                    index="03"
                    label="Email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                    error={errors.email}
                  />
                  <Field
                    index="04"
                    label="Password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    placeholder="At least 10 characters"
                    hint="Ten characters or more, with a number or symbol."
                    error={errors.password}
                  />
                  <Submit pending={pending} label={copy.cta} />
                  <Fault state={state} />
                  <p className="t-micro leading-[1.8] text-[var(--color-paper-20)]">
                    Creating an account stores your handle, profile and saved
                    records. Passwords are hashed by the auth provider and never
                    reach this application.
                  </p>
                </Stack>
              </form>
            ) : (
              <form action={reset} noValidate>
                <Stack>
                  <Field
                    index="01"
                    label="Email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                    error={errors.email}
                  />
                  <Submit pending={pending} label={copy.cta} />
                  <Fault state={state} />
                  <p className="t-micro text-[var(--color-paper-20)]">
                    <button
                      type="button"
                      onClick={() => setMode("enter")}
                      className="border-b border-[var(--color-paper-35)] pb-px text-[var(--color-paper-70)] transition-colors duration-200 hover:border-[var(--color-signal)] hover:text-[var(--color-signal)]"
                    >
                      Back to sign in
                    </button>
                  </p>
                </Stack>
              </form>
            )}
          </motion.div>
        </AnimatePresence>

        <p className="t-micro mt-10 max-w-[26rem] text-[var(--color-paper-20)]">
          <Link href="/" className="hover:text-[var(--color-paper-70)]">
            ← Back to standby
          </Link>
        </p>
      </section>
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex flex-col gap-2.5">
      {Array.isArray(children)
        ? children.map((child, i) => (
            <motion.div
              key={i}
              initial={reduced ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...motionPreset.reveal, delay: 0.06 + i * stagger.item }}
            >
              {child}
            </motion.div>
          ))
        : children}
    </div>
  );
}

function Remember() {
  const [on, setOn] = useState(true);
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2">
      <input
        type="checkbox"
        name="remember"
        checked={on}
        onChange={(event) => setOn(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "relative flex h-4 w-4 shrink-0 items-center justify-center border transition-colors duration-200",
          on ? "border-[var(--color-signal)]" : "border-[var(--color-edge)]",
        )}
      >
        <motion.span
          initial={false}
          animate={{ scale: on ? 1 : 0 }}
          transition={motionPreset.fast}
          className="block h-2 w-2 bg-[var(--color-signal)]"
        />
      </span>
      <span className="t-micro text-[var(--color-paper-50)]">
        Keep me signed in on this device
      </span>
    </label>
  );
}

function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <Action type="submit" tone="solid" size="lg" full disabled={pending} className="mt-4">
      {pending ? "Working…" : label}
    </Action>
  );
}

/** Server-side failures are shown on the form, not thrown away in a toast. */
function Fault({ state }: { state: ActionResult | null }) {
  return (
    <AnimatePresence initial={false}>
      {state && !state.ok ? (
        <motion.p
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={motionPreset.fast}
          className="t-micro overflow-hidden border-l-2 border-[var(--color-signal)] py-2 pl-3 leading-[1.7] text-[var(--color-signal)]"
        >
          {state.message}
        </motion.p>
      ) : state?.ok && state.message ? (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={motionPreset.fast}
          className="t-micro overflow-hidden border-l-2 border-[var(--color-paper-35)] py-2 pl-3 leading-[1.7] text-[var(--color-paper-70)]"
        >
          {state.message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}
