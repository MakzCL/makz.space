import type { DB, Job, Profile, Role } from "./types";
import { ymd } from "./time";

const uid = () => crypto.randomUUID();
const iso = (d: Date) => d.toISOString();
const at = (day: Date, h: number, m = 0) => { const x = new Date(day); x.setHours(h, m, 0, 0); return x; };
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const STAFF: [string, Role, string][] = [
  ["Adam Nowak", "boss", "BS-001"],
  ["Sarah Mitchell", "manager", "MG-004"],
  ["Priya Shah", "office", "OF-007"],
  ["Tom Baker", "assistant", "AS-011"],
  ["Karol Kuklinski", "operator", "OP-020"],
  ["Ola Wisniewska", "operator", "OP-021"],
  ["James Carter", "operator", "OP-022"],
  ["Liam O'Connor", "operator", "OP-023"],
];

const JOBS: [string, string, string, number, number][] = [
  ["Control board rev C — SMT placement", "Place & inspect 240 boards, panel of 6. Check fiducials before run.", "Aerotek", 1, 240],
  ["Wire harness loom — HX-40", "Build looms to drawing HX-40/3. Label every 10th.", "Northline Rail", 1, 60],
  ["Reflow batch — PSU modules", "Profile B, 245°C peak. Log oven temps every hour.", "Voltix", 2, 180],
  ["Conformal coating — sensor PCBs", "Mask connectors. 2 coats, UV check after cure.", "Marisense", 2, 120],
  ["Final test & QC — LED drivers", "Functional test on jig 3, record serials.", "Lumora", 3, 300],
  ["Cable crimping — M12 leads", "Pull-test 1 in 25. Crimp height 1.45mm.", "Aerotek", 3, 500],
  ["Enclosure fit-out — gateway units", "Fit PCB, gland, gasket. Torque 0.8Nm.", "Northline Rail", 4, 80],
  ["Rework — returned units RMA-118", "Replace U4, reflash, retest.", "Voltix", 2, 14],
  ["Through-hole insertion — relay boards", "Wave solder after insertion. Inspect joints.", "Marisense", 4, 150],
  ["Box build — control cabinet", "Two-person lift for chassis. Follow build pack.", "Aerotek", 5, 6],
];

export function seedDB(): DB {
  const r = rnd(42);
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);

  const profiles: Profile[] = STAFF.map(([full_name, role, employee_code], i) => ({
    id: uid(), full_name, role, employee_code, avatar_url: null, holiday_allowance: 28, active: true,
    created_at: iso(new Date(now.getTime() - (400 - i * 20) * 864e5)),
  }));
  const P = (name: string) => profiles.find((p) => p.full_name.startsWith(name))!.id;
  const floor = ["Karol", "Ola", "James", "Liam", "Tom"].map(P);

  const db: DB = {
    profiles, shifts: [], breaks: [], jobs: [], work_sessions: [], participants: [], invites: [],
    issues: [], stock_items: [], absences: [], announcements: [], join_links: [],
  };

  // Jobs: first six are live, the rest finished across the last weeks.
  const jobs: Job[] = JOBS.map(([title, description, customer, priority, quantity], i) => ({
    id: uid(), code: `SK-${2410 + i}`, title, description, customer, priority, quantity,
    status: i < 7 ? "open" : "done",
    assignees: i === 0 ? [P("Karol"), P("Ola")] : i === 1 ? [P("Karol"), P("James")] : i === 2 ? [P("Ola"), P("Liam")]
      : i === 3 ? [P("Karol")] : i === 4 ? [P("James"), P("Tom")] : i === 5 ? [P("Liam"), P("Karol")]
      : i === 6 ? [P("Tom"), P("Ola")] : [floor[i % floor.length]!, floor[(i + 1) % floor.length]!],
    estimate_minutes: [480, 360, 300, 240, 420, 300, 240, 180, 360, 600][i]!,
    due_date: ymd(new Date(today.getTime() + (i - 2) * 864e5 * 2)),
    created_by: P("Sarah"), completed_at: null,
    created_at: iso(new Date(today.getTime() - (20 - i) * 864e5)),
  }));
  db.jobs = jobs;

  // 3 weeks of shift history for floor staff.
  for (let back = 21; back >= 1; back--) {
    const day = new Date(today.getTime() - back * 864e5);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (const u of [...floor, P("Sarah"), P("Priya")]) {
      if (r() < 0.08) continue;
      const inAt = at(day, 6, Math.floor(r() * 20));
      const outAt = at(day, 14 + (r() < 0.3 ? 1 + Math.floor(r() * 2) : 0), 15 + Math.floor(r() * 30));
      const s = { id: uid(), user_id: u, clock_in: iso(inAt), clock_out: iso(outAt), created_at: iso(inAt) };
      db.shifts.push(s);
      const b0 = at(day, 10, Math.floor(r() * 30));
      db.breaks.push({ id: uid(), shift_id: s.id, user_id: u, started_at: iso(b0), ended_at: iso(new Date(b0.getTime() + 30 * 6e4)), created_at: iso(b0) });
    }
    // Work sessions on the jobs, often in pairs.
    for (let k = 0; k < 3; k++) {
      const job = jobs[Math.floor(r() * jobs.length)]!;
      const crew = job.assignees.slice(0, r() < 0.55 ? 2 : 1);
      if (job.code === "SK-2419" && crew.length < 2) crew.push(P("Tom"));
      const st = at(day, 7 + k * 2, Math.floor(r() * 40));
      const en = new Date(st.getTime() + (50 + Math.floor(r() * 70)) * 6e4);
      const ws = { id: uid(), job_id: job.id, started_by: crew[0]!, started_at: iso(st), ended_at: iso(en), created_at: iso(st) };
      db.work_sessions.push(ws);
      crew.forEach((u, ci) => {
        const j = new Date(st.getTime() + ci * Math.floor(r() * 25) * 6e4);
        db.participants.push({ id: uid(), session_id: ws.id, job_id: job.id, user_id: u, joined_at: iso(j), left_at: iso(en), created_at: iso(j) });
      });
    }
  }
  for (const j of jobs) {
    if (j.status === "done") {
      const last = db.work_sessions.filter((s) => s.job_id === j.id).sort((a, b) => b.ended_at!.localeCompare(a.ended_at!))[0];
      j.completed_at = last?.ended_at ?? iso(new Date(today.getTime() - 3 * 864e5));
    } else if (db.work_sessions.some((s) => s.job_id === j.id)) j.status = "paused";
  }

  // Today: part of the floor is already in, with one live team job.
  const live = (u: string, h: number, m: number) => {
    const s = { id: uid(), user_id: u, clock_in: iso(at(today, h, m)), clock_out: null, created_at: iso(at(today, h, m)) };
    if (at(today, h, m) < now) db.shifts.push(s);
    return s;
  };
  live(P("Ola"), 6, 2); live(P("James"), 6, 8); live(P("Sarah"), 6, 45); live(P("Tom"), 7, 0); live(P("Adam"), 7, 30);
  const sesStart = new Date(Math.max(at(today, 6, 30).getTime(), now.getTime() - 95 * 6e4));
  if (sesStart < now) {
    const job = jobs[1]!;
    job.status = "in_progress";
    job.assignees = [...new Set([...job.assignees, P("Ola")])];
    const ws = { id: uid(), job_id: job.id, started_by: P("James"), started_at: iso(sesStart), ended_at: null, created_at: iso(sesStart) };
    db.work_sessions.push(ws);
    db.participants.push({ id: uid(), session_id: ws.id, job_id: job.id, user_id: P("James"), joined_at: iso(sesStart), left_at: null, created_at: iso(sesStart) });
    const j2 = new Date(sesStart.getTime() + 20 * 6e4);
    if (j2 < now) db.participants.push({ id: uid(), session_id: ws.id, job_id: job.id, user_id: P("Ola"), joined_at: iso(j2), left_at: null, created_at: iso(j2) });
  }
  jobs[4]!.status = "blocked";

  db.issues = [
    { id: uid(), job_id: jobs[4]!.id, reported_by: P("James"), category: "machine", severity: "high", title: "Test jig 3 failing continuity", description: "Pogo pin 14 intermittent. Swapped cable, no change.", status: "open", resolved_by: null, created_at: iso(new Date(now.getTime() - 50 * 6e4)) },
    { id: uid(), job_id: jobs[0]!.id, reported_by: P("Ola"), category: "material", severity: "medium", title: "Short on 0402 10k resistors", description: "Reel at 300, need ~1400 for the batch.", status: "acknowledged", resolved_by: null, created_at: iso(new Date(now.getTime() - 26 * 3600e3)) },
    { id: uid(), job_id: null, reported_by: P("Liam"), category: "safety", severity: "low", title: "Fume extractor filter due", description: "Bench 2 indicator showing amber.", status: "resolved", resolved_by: P("Sarah"), created_at: iso(new Date(now.getTime() - 4 * 864e5)) },
  ];

  const stock: [string, string, string, string, number, number][] = [
    ["RES-0402-10K", "Resistor 0402 10kΩ 1%", "A1-03", "pcs", 300, 2000],
    ["CAP-0603-100N", "Capacitor 0603 100nF X7R", "A1-07", "pcs", 8400, 2000],
    ["IC-STM32G0", "MCU STM32G030F6P6", "B2-01", "pcs", 412, 150],
    ["CON-M12-4P", "M12 connector 4-pin A-coded", "C1-12", "pcs", 96, 120],
    ["WIRE-0.5-RD", "Wire 0.5mm² red", "D3-02", "m", 640, 200],
    ["WIRE-0.5-BK", "Wire 0.5mm² black", "D3-03", "m", 155, 200],
    ["SOLDER-SAC305", "Solder paste SAC305 500g", "Fridge 1", "jar", 6, 4],
    ["COAT-UR", "Conformal coating urethane 1L", "Flam. cab", "can", 3, 2],
    ["PCB-CTRL-C", "Control board PCB rev C (panel)", "B1-04", "panel", 44, 20],
    ["ENC-GW-200", "Gateway enclosure IP67", "E2-01", "pcs", 82, 40],
    ["GASKET-GW", "Enclosure gasket GW-200", "E2-02", "pcs", 31, 40],
    ["LED-DRV-30W", "LED driver 30W chassis", "E4-05", "pcs", 210, 60],
  ];
  db.stock_items = stock.map(([sku, name, location, unit, quantity, min_quantity]) => ({
    id: uid(), sku, name, location, unit, quantity, min_quantity, updated_by: P("Tom"),
    updated_at: iso(new Date(now.getTime() - r() * 6 * 864e5)), created_at: iso(new Date(now.getTime() - 90 * 864e5)),
  }));

  db.absences = [
    { id: uid(), user_id: P("Liam"), kind: "holiday", start_date: ymd(new Date(today.getTime() + 9 * 864e5)), end_date: ymd(new Date(today.getTime() + 13 * 864e5)), note: "Family trip", status: "pending", decided_by: null, created_at: iso(new Date(now.getTime() - 3600e3)) },
    { id: uid(), user_id: P("Liam"), kind: "sick", start_date: ymd(today), end_date: ymd(today), note: "Flu", status: "approved", decided_by: P("Priya"), created_at: iso(at(today, 5, 40)) },
    { id: uid(), user_id: P("James"), kind: "day_off", start_date: ymd(new Date(today.getTime() + 4 * 864e5)), end_date: ymd(new Date(today.getTime() + 4 * 864e5)), note: "Dentist", status: "pending", decided_by: null, created_at: iso(new Date(now.getTime() - 20 * 3600e3)) },
    { id: uid(), user_id: P("Karol"), kind: "holiday", start_date: ymd(new Date(today.getTime() - 40 * 864e5)), end_date: ymd(new Date(today.getTime() - 36 * 864e5)), note: "", status: "approved", decided_by: P("Priya"), created_at: iso(new Date(today.getTime() - 60 * 864e5)) },
  ];

  db.announcements = [
    { id: uid(), author_id: P("Adam"), body: "Great month everyone — on-time delivery hit 98%. Pizza Friday is on me 🍕", pinned: true, created_at: iso(new Date(now.getTime() - 2 * 864e5)) },
    { id: uid(), author_id: P("Sarah"), body: "Aerotek audit Thursday 10:00. Keep benches tidy and ESD straps on.", pinned: false, created_at: iso(new Date(now.getTime() - 5 * 3600e3)) },
  ];
  db.join_links = [{
    id: uid(), code: "LINE2026", pin: "1234", role: "operator", created_by: P("Priya"), max_uses: 10, uses: 2, failed: 0,
    revoked: false, expires_at: iso(new Date(now.getTime() + 6 * 864e5)), created_at: iso(new Date(now.getTime() - 864e5)),
  }];
  return db;
}
