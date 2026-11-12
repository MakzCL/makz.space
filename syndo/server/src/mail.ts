import nodemailer from "nodemailer";
import { BRAND } from "@send/shared";
import { config } from "./config.ts";
import { q } from "./db.ts";

const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;

/** Plain, branded email. Recorded in mail_outbox, delivered by SMTP when configured. */
export async function sendMail(to: string, subject: string, lines: string[], action?: { label: string; url: string }) {
  const body = [
    ...lines,
    ...(action ? ["", `${action.label}: ${action.url}`] : []),
    "",
    `:  ${BRAND.name} · ${BRAND.tagline}`,
    `If you didn't expect this email, you can ignore it.`,
  ].join("\n");
  const fullSubject = `${subject} · ${BRAND.name}`;
  const [row] = await q<{ id: string }>("insert into mail_outbox(to_address, subject, body) values ($1,$2,$3) returning id", [to, fullSubject, body]);
  if (!transport) {
    if (!config.devMail) console.warn(`[mail] SMTP_URL not set: email to ${to} recorded in mail_outbox only`);
    return;
  }
  try {
    await transport.sendMail({ from: config.mailFrom, to, subject: fullSubject, text: body });
    await q("update mail_outbox set sent_at = now() where id = $1", [row!.id]);
  } catch (e) {
    await q("update mail_outbox set error = $2 where id = $1", [row!.id, String((e as Error).message).slice(0, 500)]);
  }
}
