"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";

import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Field } from "@/components/ui/field";
import { Action } from "@/components/ui/action";
import { useToast } from "@/components/shell/toaster";

import { updatePasswordAction } from "./actions";
import type { ActionResult } from "./schema";

export function NewPassword({ email }: { email: string | null }) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const { notify } = useToast();
  const [state, submit, pending] = useActionState<ActionResult | null, FormData>(
    updatePasswordAction,
    null,
  );

  useEffect(() => {
    if (!state?.ok) return;
    notify({ label: "Password updated", tone: "signal" });
    router.push("/u/me");
  }, [notify, router, state]);

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <div className="gutter flex min-h-full flex-col justify-center py-14">
      <span className="t-micro text-[var(--color-signal)]">ACCESS — RECOVERY</span>

      <h1 className="mt-5 max-w-[14ch] text-[clamp(2.2rem,7vw,5rem)] font-extrabold leading-[0.9] tracking-[-0.045em] text-[var(--color-paper)]">
        Set a new password.
      </h1>

      {email ? (
        <p className="t-lead mt-6 max-w-[46ch]">
          You are recovering the account on <strong>{email}</strong>. Choose
          something you do not use anywhere else.
        </p>
      ) : null}

      <form action={submit} noValidate className="mt-10 w-full max-w-[26rem]">
        {[
          <Field
            key="password"
            index="01"
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            placeholder="At least 10 characters"
            hint="Ten characters or more, with a number or symbol."
            error={errors.password}
          />,
          <Field
            key="confirm"
            index="02"
            label="Confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Type it again"
            error={errors.confirm}
          />,
        ].map((field, i) => (
          <motion.div
            key={i}
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...motionPreset.reveal, delay: 0.06 + i * stagger.item }}
          >
            {field}
          </motion.div>
        ))}

        {state && !state.ok ? (
          <p
            role="alert"
            className="t-micro mt-3 border-l-2 border-[var(--color-signal)] py-2 pl-3 leading-[1.7] text-[var(--color-signal)]"
          >
            {state.message}
          </p>
        ) : null}

        <Action type="submit" tone="solid" size="lg" full disabled={pending} className="mt-6">
          {pending ? "Saving…" : "Save password"}
        </Action>
      </form>
    </div>
  );
}
