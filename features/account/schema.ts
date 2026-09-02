import { z } from "zod";

/**
 * One schema per action, shared by the client form and the server action, so
 * the browser can validate instantly and the server can never be bypassed.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address")
  .email("That does not look like an email address")
  .max(254);

export const passwordSchema = z
  .string()
  .min(10, "At least 10 characters")
  .max(72, "72 characters maximum")
  .refine((value) => /[a-z]/i.test(value), "Include at least one letter")
  .refine((value) => /[0-9]/.test(value) || /[^\w\s]/.test(value), {
    message: "Include a number or a symbol",
  });

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(24, "24 characters maximum")
  .regex(
    /^[a-z0-9](?:[a-z0-9_-]{1,22})[a-z0-9]$/,
    "Lowercase letters, numbers, hyphen and underscore only",
  );

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean().default(false),
  next: z.string().startsWith("/").optional(),
});

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
  displayName: z.string().trim().max(60).optional().or(z.literal("")),
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const newPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "The two passwords do not match",
  });

export const profileSchema = z.object({
  username: usernameSchema,
  display_name: z.string().trim().max(60).optional().or(z.literal("")),
  bio: z.string().trim().max(400).optional().or(z.literal("")),
  location: z.string().trim().max(80).optional().or(z.literal("")),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || /^https?:\/\/.+\..+/.test(value), {
      message: "Use a full URL starting with https://",
    })
    .optional()
    .or(z.literal("")),
  avatar_url: z
    .string()
    .trim()
    .max(400)
    .refine((value) => value === "" || /^https:\/\/.+/.test(value), {
      message: "Use an https image URL",
    })
    .optional()
    .or(z.literal("")),
});

export const preferencesSchema = z.object({
  appearance: z.enum(["system", "dark", "day"]),
  motion: z.enum(["full", "reduced"]),
  show_activity: z.boolean(),
  email_updates: z.boolean(),
  profile_visibility: z.enum(["public", "private"]),
});

export const savedItemSchema = z.object({
  item_type: z.enum(["work", "frame", "game", "stream"]),
  item_slug: z.string().min(1).max(120),
  item_title: z.string().min(1).max(200),
  item_href: z.string().startsWith("/").max(200),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;

/** Uniform result shape every action returns. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}
