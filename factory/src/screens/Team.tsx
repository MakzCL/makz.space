import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Link2, Search, Share2, ShieldCheck, Trash2, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Scene } from "../components/Scene";
import { useToast } from "../components/Toast";
import { Badge, Btn, Chip, Field, RoundBtn, Section, Sheet, item, list } from "../components/ui";
import { useActions, usePresence, useStations } from "../lib/actions";
import { JOIN_PIN } from "../lib/backend";
import { plural, t } from "../lib/i18n";
import { can, ROLE_META, ROLE_ORDER } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { ago, clock, dailyTotals, dayLabel, hm, hms, jobStats, splitOvertime, startOfDay, startOfMonth, ymd } from "../lib/time";
import type { JoinLink, Role } from "../lib/types";
import { TimeSheet } from "./Time";

export const roleLabel = (r: Role) => t(ROLE_META[r].label);
export const joinUrl = (code: string) => `${location.origin}/?join=${code}`;

export function Team({ onPerson }: { onPerson: (id: string) => void }) {
  const { db, me } = useStore();
  const presence = usePresence();
  const now = useNow(30000);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "on" | Role>("all");
  const [links, setLinks] = useState(false);
  const today = ymd(startOfDay());
  const people = db.profiles
    .filter((p) => p.active)
    .filter((p) => !q || p.full_name.toLowerCase().includes(q.toLowerCase()) || p.employee_code.toLowerCase().includes(q.toLowerCase()))
    .filter((p) => only === "all" || (only === "on" ? presence.get(p.id)!.state !== "off" : p.role === only))
    .sort((a, b) => Number(presence.get(b.id)!.state !== "off") - Number(presence.get(a.id)!.state !== "off") || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.full_name.localeCompare(b.full_name));
  const onCount = [...presence.values()].filter((p) => p.state !== "off").length;
  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <motion.div className="hero" variants={item}>
        <Scene kind="town" height={180}>
          <div className="scene-title"><h1>{t("Team")}</h1><p>{t("{n} people", { n: db.profiles.filter((p) => p.active).length })} · {t("{n} on shift", { n: onCount })}</p></div>
          {can.linkRoles(me.role).length > 0 && <div className="scene-actions"><RoundBtn label={t("Invite links")} onClick={() => setLinks(true)}><Link2 size={18} /></RoundBtn></div>}
        </Scene>
        {can.linkRoles(me.role).length > 0 && (
          <div className="hero-cta"><Btn tone="primary" wide icon={<Link2 size={18} />} onClick={() => setLinks(true)}>{t("Invite new starters")}</Btn></div>
        )}
      </motion.div>
      <PendingMembers />
      <div className="searchbar"><Search size={18} /><input placeholder={t("Search name or code…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="chips">
        <Chip on={only === "on"} onClick={() => setOnly(only === "on" ? "all" : "on")}>{t("On shift")}</Chip>
        {ROLE_ORDER.map((r) => <Chip key={r} on={only === r} onClick={() => setOnly(only === r ? "all" : r)}>{roleLabel(r)}</Chip>)}
      </div>
      <motion.div className="stack" variants={list} initial="hidden" animate="show">
        {people.map((p) => {
          const pr = presence.get(p.id)!;
          const todayMs = dailyTotals(db.shifts.filter((s) => s.user_id === p.id), db.breaks, now).get(today) ?? 0;
          const job = pr.jobId ? db.jobs.find((j) => j.id === pr.jobId) : null;
          return (
            <motion.button type="button" key={p.id} variants={item} className="card person" onClick={() => onPerson(p.id)} whileTap={{ scale: 0.985 }}>
              <Avatar p={p} size={48} status={pr.state} />
              <div className="grow">
                <b>{p.full_name}</b>
                <small className="muted">{roleLabel(p.role)} · #{p.employee_code}</small>
                <small className={`state ${pr.state}`}>{pr.state === "working" ? t("Working on {code}", { code: job?.code ?? "" }) : pr.state === "break" ? t("On break") : pr.state === "on" ? t("On shift · free") : t("Off shift")}</small>
              </div>
              <div className="right"><b>{hm(todayMs)}</b><small className="muted">{t("today")}</small></div>
            </motion.button>
          );
        })}
      </motion.div>
      <JoinLinksSheet open={links} onClose={() => setLinks(false)} />
    </motion.div>
  );
}

/** Accounts that signed up without a link, waiting for an admin. */
export function PendingMembers() {
  const { db, me } = useStore();
  const a = useActions();
  const pending = db.profiles.filter((p) => !p.active);
  if (!can.admin(me.role) || !pending.length) return null;
  return (
    <Section title={t("Waiting for approval")} sub={t("Signed up without an invite link")}>
      <div className="stack">
        <AnimatePresence initial={false}>
          {pending.map((p) => (
            <motion.div key={p.id} className="card person pending-card" layout exit={{ opacity: 0, height: 0 }}>
              <Avatar p={p} size={44} />
              <div className="grow"><b>{p.full_name}</b><small className="muted">{t("signed up {when}", { when: ago(p.created_at) })}</small></div>
              {me.role === "boss" && <button type="button" className="icon-btn subtle" onClick={() => a.removeMember(p)} aria-label={t("Remove")}><X size={18} /></button>}
              <Btn small tone="primary" icon={<UserCheck size={16} />} onClick={() => a.approve(p)}>{t("Approve")}</Btn>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Section>
  );
}

const EXPIRY = [{ h: 24, label: "24 hours" }, { h: 24 * 7, label: "7 days" }, { h: 24 * 30, label: "30 days" }];
const USES: (number | null)[] = [1, 5, 20, null];

export function JoinLinksSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, me, person } = useStore();
  const a = useActions();
  const roles = can.linkRoles(me.role);
  const [role, setRole] = useState<Role>("operator");
  const [hours, setHours] = useState(24 * 7);
  const [uses, setUses] = useState<number | null>(1);
  const [made, setMade] = useState<JoinLink | null>(null);
  useEffect(() => { if (open) setMade(null); }, [open]);
  const live = db.join_links.filter((l) => !l.revoked && new Date(l.expires_at) > new Date() && (l.max_uses === null || l.uses < l.max_uses))
    .sort((x, y) => y.created_at.localeCompare(x.created_at));

  return (
    <Sheet open={open} onClose={onClose} tall title={made ? t("Share this link") : t("Invite new starters")}>
      {made ? <LinkCard link={made} onDone={() => setMade(null)} /> : (
        <div className="stack">
          <p className="muted">{t("Make one link per person. They open it, type the team PIN and create their account — no approval needed afterwards.")}</p>
          <Field label={t("They join as")}>
            <div className="chips">{roles.map((r) => <Chip key={r} on={role === r} onClick={() => setRole(r)}><ShieldCheck size={14} />{roleLabel(r)}</Chip>)}</div>
          </Field>
          <div className="pin-show"><small>{t("Team PIN (same for every link)")}</small><b>{JOIN_PIN}</b><small>{t("Tell people the PIN in person — not in the same message as the link.")}</small></div>
          <Field label={t("Link works for")}>
            <div className="chips">{EXPIRY.map((e) => <Chip key={e.h} on={hours === e.h} onClick={() => setHours(e.h)}>{t(e.label)}</Chip>)}</div>
          </Field>
          <Field label={t("How many people can use it")}>
            <div className="chips">{USES.map((u) => <Chip key={String(u)} on={uses === u} onClick={() => setUses(u)}>{u === null ? t("No limit") : u}</Chip>)}</div>
          </Field>
          <Btn tone="primary" wide icon={<Link2 size={18} />} onClick={async () => { const l = await a.createJoinLink(role, JOIN_PIN, hours, uses); if (l) setMade(l); }}>{t("Create link")}</Btn>

          {live.length > 0 && (
            <Section title={t("Active links")}>
              <div className="stack">
                {live.map((l) => (
                  <div key={l.id} className="card link-row">
                    <div className="grow">
                      <div className="row gap-s"><span className="code">{l.code}</span><Badge>{roleLabel(l.role)}</Badge></div>
                      <small className="muted">PIN {l.pin} · {t("used {n}", { n: l.uses })}{l.max_uses ? `/${l.max_uses}` : ""} · {t("until {date}", { date: dayLabel(l.expires_at) })} · {person(l.created_by)?.full_name.split(" ")[0]}</small>
                      {l.failed > 0 && <small className="red-t">{plural(l.failed, ["wrong PIN attempt", "wrong PIN attempts"], ["błędna próba PIN", "błędne próby PIN", "błędnych prób PIN"])}{l.failed >= 10 ? ` · ${t("locked")}` : ""}</small>}
                    </div>
                    <button type="button" className="icon-btn subtle" onClick={() => setMade(l)} aria-label={t("Show")}><Share2 size={17} /></button>
                    <button type="button" className="icon-btn subtle" onClick={() => a.revokeJoinLink(l.id)} aria-label={t("Switch off")}><Trash2 size={17} /></button>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </Sheet>
  );
}

function LinkCard({ link, onDone }: { link: JoinLink; onDone: () => void }) {
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const url = joinUrl(link.code);
  useEffect(() => {
    import("qrcode").then((Q) => Q.toDataURL(url, { margin: 1, width: 440, color: { dark: "#0b1033", light: "#ffffff" } })).then(setQr).catch(() => setQr(null));
  }, [url]);
  const copy = async (txt: string) => { try { await navigator.clipboard.writeText(txt); toast(t("Copied"), "info"); } catch { /* ignore */ } };
  return (
    <div className="stack center">
      <motion.div className="qr" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 18 }}>
        {qr ? <img src={qr} alt="QR" /> : <div className="qr-skel" />}
      </motion.div>
      <p className="muted">{t("Scan with a phone camera, or send the link.")}</p>
      <div className="link-box"><span>{url}</span><button type="button" className="icon-btn subtle" onClick={() => copy(url)} aria-label={t("Copy")}><Copy size={17} /></button></div>
      <div className="pin-show"><small>{t("PIN")}</small><b>{link.pin}</b><small>{roleLabel(link.role)} · {t("until {date}", { date: dayLabel(link.expires_at) })}</small></div>
      <div className="row gap">
        {"share" in navigator && <Btn tone="soft" wide icon={<Share2 size={18} />} onClick={() => navigator.share({ title: "Skalarki Factory", text: t("Join the Skalarki Factory app"), url }).catch(() => {})}>{t("Share")}</Btn>}
        <Btn tone="primary" wide icon={<Check size={18} />} onClick={onDone}>{t("Done")}</Btn>
      </div>
    </div>
  );
}

export function PersonSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { db, me, person } = useStore();
  const presence = usePresence();
  const now = useNow(1000);
  const a = useActions();
  const p = person(id);
  const [allow, setAllow] = useState<string>("");
  const stations = useStations(); // before the early return: hooks must run on every render
  const [missed, setMissed] = useState({ day: "", cin: "06:00", cout: "14:00" });
  if (!p) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const pr = presence.get(p.id)!;
  const month = startOfMonth();
  const shifts = db.shifts.filter((s) => s.user_id === p.id && new Date(s.clock_in) >= month);
  const { normal, over } = splitOvertime(dailyTotals(shifts, db.breaks, now).values());
  const jobsDone = new Set(db.participants.filter((x) => x.user_id === p.id).map((x) => x.job_id));
  const teamJobs = [...jobsDone].filter((j) => jobStats(db, j, now).team).length;
  const used = db.absences.filter((x) => x.user_id === p.id && x.kind === "holiday" && x.status === "approved" && x.start_date.startsWith(String(new Date().getFullYear())))
    .reduce((tt, x) => tt + (new Date(x.end_date).getTime() - new Date(x.start_date).getTime()) / 864e5 + 1, 0);
  const isAdmin = can.admin(me.role);
  const openShift = db.shifts.find((x) => x.user_id === p.id && !x.clock_out);
  const pending = db.absences.filter((x) => x.user_id === p.id && x.status === "pending").sort((x, y) => x.start_date.localeCompare(y.start_date));
  const roles = can.assignRoles(me.role);
  const canRole = p.id !== me.id && roles.length > 0 && (p.role !== "boss" || me.role === "boss");
  const myStations = stations.of(p.id);
  return (
    <Sheet open={!!id} onClose={onClose} tall title={t("Team member")}>
      <div className="stack">
        <div className="person-hero">
          <Avatar p={p} size={84} status={pr.state} />
          <div><h2>{p.full_name}</h2><span className="row gap-s"><Badge tone="red">{roleLabel(p.role)}</Badge><Badge>#{p.employee_code}</Badge></span>
            <small className={`state ${pr.state}`}>{pr.state === "working" ? `${t("Working")} · ${hms(now - new Date(pr.since!).getTime())}` : pr.state === "break" ? t("On break") : pr.state === "on" ? t("On shift") : t("Off shift")}</small>
          </div>
        </div>
        <div className="tri">
          <div><small>{t("This month")}</small><b>{hm(normal + over)}</b></div>
          <div><small>{t("Overtime")}</small><b>{hm(over)}</b></div>
          <div><small>{t("Team jobs")}</small><b>{teamJobs}</b></div>
        </div>
        {canRole && (
          <Field label={t("Role")} hint={me.role === "boss" ? undefined : t("Only the owner can give or take away Owner.")}>
            <div className="chips">{roles.map((r) => <Chip key={r} on={p.role === r} onClick={() => p.role !== r && a.updateProfile(p.id, { role: r })}><ShieldCheck size={14} />{roleLabel(r)}</Chip>)}</div>
          </Field>
        )}
        {isAdmin && pending.length > 0 && (
          <Field label={t("Waiting for approval")}>
            <div className="stack">
              {pending.map((r) => (
                <div key={r.id} className="card flat row between wrap gap-s">
                  <span><b>{t(r.kind === "sick" ? "Off-sick" : r.kind === "day_off" ? "Day-off" : "Holidays")}</b> <small className="muted">{dayLabel(r.start_date)}{r.end_date !== r.start_date ? ` → ${dayLabel(r.end_date)}` : ""}{r.note ? ` · ${r.note}` : ""}</small></span>
                  <span className="row gap-s">
                    <Btn small tone="ghost" onClick={() => a.decideAbsence(r.id, "rejected")}>{t("Decline")}</Btn>
                    <Btn small tone="primary" onClick={() => a.decideAbsence(r.id, "approved")}>{t("Approve")}</Btn>
                  </span>
                </div>
              ))}
            </div>
          </Field>
        )}
        {isAdmin && p.id !== me.id && (
          <Field label={t("Shifts")} hint={t("Fix a forgotten clock-in or clock-out. Tap the pencil on a shift below to change its times.")}>
            <div className="stack">
              {openShift && (
                <div className="row between wrap gap-s">
                  <small className="muted">{t("Clocked in since {time}", { time: `${dayLabel(openShift.clock_in)} ${clock(openShift.clock_in)}` })}</small>
                  <Btn small tone="primary" onClick={() => a.endShiftFor(openShift)}>{t("End shift now")}</Btn>
                </div>
              )}
              <div className="row gap wrap">
                <input type="date" value={missed.day} max={ymd(new Date())} onChange={(e) => setMissed({ ...missed, day: e.target.value })} aria-label={t("Date")} />
                <input type="time" value={missed.cin} onChange={(e) => setMissed({ ...missed, cin: e.target.value })} aria-label={t("Clock in")} />
                <input type="time" value={missed.cout} onChange={(e) => setMissed({ ...missed, cout: e.target.value })} aria-label={t("Clock out")} />
                <Btn small tone="soft" disabled={!missed.day} onClick={async () => {
                  const cin = new Date(`${missed.day}T${missed.cin}`), cout = new Date(`${missed.day}T${missed.cout}`);
                  if (cout <= cin) cout.setDate(cout.getDate() + 1); // night shift past midnight
                  await a.addShiftFor(p.id, cin.toISOString(), cout.toISOString()); setMissed({ ...missed, day: "" });
                }}>{t("Add missed shift")}</Btn>
              </div>
            </div>
          </Field>
        )}
        {(can.manageJobs(me.role) ? stations.list.length > 0 : myStations.length > 0) && (
          <Field label={t("Stations")} hint={can.manageJobs(me.role) ? t("Jobs at these stations land on their Jobs tab.") : undefined}>
            <div className="chips">
              {(can.manageJobs(me.role) ? stations.list : stations.list.filter((s) => myStations.includes(s.id))).map((s) => (
                <Chip key={s.id} on={myStations.includes(s.id)} onClick={can.manageJobs(me.role) ? () => a.setStationMember(s.id, p.id, !myStations.includes(s.id)) : undefined}>{s.name}</Chip>
              ))}
            </div>
          </Field>
        )}
        {isAdmin && (
          <Field label={t("Holiday allowance · {used} of {total} used this year", { used, total: p.holiday_allowance })}>
            <div className="row gap">
              <input type="number" min={0} max={60} placeholder={String(p.holiday_allowance)} value={allow} onChange={(e) => setAllow(e.target.value)} />
              <Btn tone="soft" disabled={!allow} onClick={async () => { await a.updateProfile(p.id, { holiday_allowance: Number(allow) }); setAllow(""); }}>{t("Set")}</Btn>
            </div>
          </Field>
        )}
        {(isAdmin || p.id === me.id) && <motion.div className="card flat" variants={list} initial="hidden" animate="show"><TimeSheet userId={p.id} /></motion.div>}
      </div>
    </Sheet>
  );
}
