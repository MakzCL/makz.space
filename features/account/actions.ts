"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { serverClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/supabase/viewer";
import {
  REMEMBER_COOKIE,
  REMEMBER_MAX_AGE,
  supabaseConfigured,
} from "@/lib/supabase/config";
import { SITE } from "@/lib/site";

import {
  fieldErrorsOf,
  newPasswordSchema,
  preferencesSchema,
  profileSchema,
  resetRequestSchema,
  savedItemSchema,
  signInSchema,
  signUpSchema,
  type ActionResult,
} from "./schema";

const NOT_CONFIGURED =
  "Accounts are not available: this deployment has no Supabase credentials configured.";

/** Absolute origin for redirect links in transactional email. */
async function origin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host");
  const proto = list.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : SITE.url;
}

/** Records the device's "remember me" choice before the auth cookies are set. */
async function setRemember(remember: boolean) {
  const jar = await cookies();
  if (remember) {
    jar.set(REMEMBER_COOKIE, "1", {
      maxAge: REMEMBER_MAX_AGE,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  } else {
    jar.set(REMEMBER_COOKIE, "0", {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }
}

/* ========================================================================
   ENTRY
   ======================================================================== */

export async function signInAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  if (!supabaseConfigured) return { ok: false, message: NOT_CONFIGURED };

  const parsed = signInSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    remember: form.get("remember") === "on",
    next: (form.get("next") as string) || undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the details above.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  // Written first so the cookie writer in serverClient sees the choice when
  // Supabase sets the session on the response.
  await setRemember(parsed.data.remember);

  const supabase = await serverClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately identical for a wrong password and an unknown address, so
    // this endpoint cannot be used to enumerate accounts.
    if (error.message.toLowerCase().includes("email not confirmed")) {
      return {
        ok: false,
        message: "Confirm your email address first — check your inbox for the link.",
      };
    }
    return { ok: false, message: "Those details were not recognised." };
  }

  revalidatePath("/", "layout");
  redirect(parsed.data.next ?? "/u/me");
}

export async function signUpAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  if (!supabaseConfigured) return { ok: false, message: NOT_CONFIGURED };

  const parsed = signUpSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    username: form.get("username"),
    displayName: form.get("displayName"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the details above.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const supabase = await serverClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  const { data: available } = await supabase.rpc("username_available", {
    candidate: parsed.data.username,
  });
  if (available === false) {
    return {
      ok: false,
      message: "That handle is taken.",
      fieldErrors: { username: "Already in use" },
    };
  }

  await setRemember(true);

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${await origin()}/auth/callback?next=/u/me`,
      data: {
        username: parsed.data.username,
        display_name: parsed.data.displayName || null,
      },
    },
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return {
    ok: true,
    message:
      "Account created. Confirm the link in your inbox to finish entering.",
  };
}

export async function signOutAction() {
  const supabase = await serverClient();
  await supabase?.auth.signOut();
  const jar = await cookies();
  jar.delete(REMEMBER_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}

/* ========================================================================
   RECOVERY
   ======================================================================== */

export async function requestResetAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  if (!supabaseConfigured) return { ok: false, message: NOT_CONFIGURED };

  const parsed = resetRequestSchema.safeParse({ email: form.get("email") });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the address above.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const supabase = await serverClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await origin()}/auth/callback?next=/account/recover`,
  });

  // Always the same answer, whether or not the address exists.
  return {
    ok: true,
    message: "If that address has an account, a reset link is on its way.",
  };
}

export async function updatePasswordAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const parsed = newPasswordSchema.safeParse({
    password: form.get("password"),
    confirm: form.get("confirm"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the details above.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const supabase = await serverClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true, message: "Password updated." };
}

/* ========================================================================
   PROFILE & PREFERENCES
   ======================================================================== */

export async function updateProfileAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "You are not signed in." };

  const parsed = profileSchema.safeParse({
    username: form.get("username"),
    display_name: form.get("display_name"),
    bio: form.get("bio"),
    location: form.get("location"),
    website: form.get("website"),
    avatar_url: form.get("avatar_url"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the details above.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const supabase = await serverClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  if (parsed.data.username !== viewer.profile.username) {
    const { data: available } = await supabase.rpc("username_available", {
      candidate: parsed.data.username,
    });
    if (available === false) {
      return {
        ok: false,
        message: "That handle is taken.",
        fieldErrors: { username: "Already in use" },
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      username: parsed.data.username,
      display_name: parsed.data.display_name || null,
      bio: parsed.data.bio || null,
      location: parsed.data.location || null,
      website: parsed.data.website || null,
      avatar_url: parsed.data.avatar_url || null,
    })
    .eq("id", viewer.id);

  if (error) return { ok: false, message: error.message };

  await supabase.from("activity").insert({
    user_id: viewer.id,
    kind: "profile.updated",
    subject: parsed.data.username,
  });

  revalidatePath("/", "layout");
  revalidatePath(`/u/${parsed.data.username}`);
  return { ok: true, message: "Profile saved." };
}

export async function updatePreferencesAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "You are not signed in." };

  const parsed = preferencesSchema.safeParse({
    appearance: form.get("appearance"),
    motion: form.get("motion"),
    show_activity: form.get("show_activity") === "on",
    email_updates: form.get("email_updates") === "on",
    profile_visibility: form.get("profile_visibility"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Those settings were not accepted." };
  }

  const supabase = await serverClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  const [{ error: prefError }, { error: profileError }] = await Promise.all([
    supabase
      .from("preferences")
      .update({
        appearance: parsed.data.appearance,
        motion: parsed.data.motion,
        show_activity: parsed.data.show_activity,
        email_updates: parsed.data.email_updates,
      })
      .eq("user_id", viewer.id),
    supabase
      .from("profiles")
      .update({ profile_visibility: parsed.data.profile_visibility })
      .eq("id", viewer.id),
  ]);

  if (prefError || profileError) {
    return { ok: false, message: (prefError ?? profileError)!.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved." };
}

/* ========================================================================
   SAVED RECORDS
   ======================================================================== */

export async function toggleSavedAction(
  input: unknown,
): Promise<ActionResult<{ saved: boolean }>> {
  const viewer = await getViewer();
  if (!viewer) {
    return { ok: false, message: "Sign in to keep this." };
  }

  const parsed = savedItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That item cannot be saved." };

  const supabase = await serverClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };

  const { data: existing } = await supabase
    .from("saved_items")
    .select("id")
    .eq("user_id", viewer.id)
    .eq("item_type", parsed.data.item_type)
    .eq("item_slug", parsed.data.item_slug)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("saved_items")
      .delete()
      .eq("id", existing.id);
    if (error) return { ok: false, message: error.message };

    await supabase.from("activity").insert({
      user_id: viewer.id,
      kind: "item.unsaved",
      subject: parsed.data.item_title,
    });
    revalidatePath("/saved");
    return { ok: true, data: { saved: false }, message: "Removed." };
  }

  const { error } = await supabase.from("saved_items").insert({
    user_id: viewer.id,
    ...parsed.data,
  });
  if (error) return { ok: false, message: error.message };

  await supabase.from("activity").insert({
    user_id: viewer.id,
    kind: "item.saved",
    subject: parsed.data.item_title,
    metadata: { href: parsed.data.item_href },
  });
  revalidatePath("/saved");
  return { ok: true, data: { saved: true }, message: "Kept." };
}
