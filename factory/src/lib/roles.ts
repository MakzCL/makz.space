import type { KimeraSection, Role } from "./types";

export type Tab = "home" | "jobs" | "chat" | "time" | "team" | "requests" | "insights" | "issues" | "stock";

export const ROLE_META: Record<Role, { label: string; gateway: string; blurb: string; hue: string }> = {
  developer: { label: "Developer", gateway: "Command",    blurb: "Full control — same access as the owner", hue: "#c084fc" },
  boss:      { label: "Owner",      gateway: "Command",    blurb: "Full control, live floor, insights",   hue: "#ff4d4a" },
  manager:   { label: "Manager",   gateway: "Floor lead", blurb: "Plan jobs, run the team, approve",      hue: "#ffb547" },
  office:    { label: "Office",    gateway: "Office",     blurb: "Timesheets, absences, stock, news",     hue: "#9b8cff" },
  support:   { label: "Support",   gateway: "Support",    blurb: "Jobs, chat and shifts",               hue: "#5ec2b7" },
  assistant: { label: "Assistant", gateway: "Support",    blurb: "Jobs, stock keeping, help the line",    hue: "#4fd1ff" },
  operator:  { label: "Operator",  gateway: "Line",       blurb: "Clock in, run jobs, team up",           hue: "#3ddc97" },
};

export const ROLE_ORDER: Role[] = ["developer", "boss", "manager", "office", "assistant", "support", "operator"];

/** Owner-level roles: Owner and Developer have identical, full access. */
export const isOwner = (r: Role) => r === "boss" || r === "developer";

export const TABS_FOR: Record<Role, Tab[]> = {
  developer: ["home", "jobs", "chat", "team", "insights", "requests"],
  boss:      ["home", "jobs", "chat", "team", "insights", "requests"],
  manager:   ["home", "jobs", "chat", "team", "requests", "issues"],
  office:    ["home", "chat", "team", "requests", "time"],
  assistant: ["home", "jobs", "chat", "time", "issues"],
  support:   ["home", "jobs", "chat", "time", "issues"],
  operator:  ["home", "jobs", "chat", "time", "issues"],
};

/** Stock, sales, purchasing and planning moved to Kortana (kortana.makz.space; the old kimera.makz.space forwards there). */
export const KIMERA_URL = "https://kortana.makz.space";
export const TROTAN_URL = "https://trotan.makz.space";
export const tabsFor = (r: Role, _desktop?: boolean): Tab[] => TABS_FOR[r];

export const can = {
  /** Remove (or restore) someone from SK Factory — mirrors can_remove_staff() in the database. */
  removeStaff: (me: Role, them: Role) => isOwner(me) || ((me === "manager" || me === "office") && !isOwner(them)) || (me === "assistant" && (them === "operator" || them === "support")),
  manageJobs: (r: Role) => isOwner(r) || r === "manager",
  admin: (r: Role) => isOwner(r) || r === "manager" || r === "office",
  editStock: (r: Role) => r !== "operator" && r !== "support",
  changeRoles: (r: Role) => isOwner(r),
  postNews: (r: Role) => isOwner(r) || r === "manager" || r === "office",
  /** Which roles this person may hand out through an invite link (only the boss makes links). */
  linkRoles: (r: Role): Role[] => isOwner(r) ? ["operator", "support", "assistant", "office", "manager", "boss", "developer"] : [],
  /** Roles this admin may give: owner, managers and office; only the owner hands out or takes away Owner. */
  assignRoles: (r: Role): Role[] => isOwner(r) ? ROLE_ORDER : (r === "manager" || r === "office") ? ROLE_ORDER.filter((x) => !isOwner(x)) : [],
};

/** Kortana sections, in menu order. */
export const KIMERA_SECTIONS: KimeraSection[] = ["sell", "make", "buy", "stock", "items", "plan", "tickets", "insights", "settings", "costs"];
/** Used until the owner saves a choice (matches the database seed). */
export const KIMERA_DEFAULT: Record<Role, KimeraSection[]> = {
  developer: KIMERA_SECTIONS, boss: KIMERA_SECTIONS,
  manager: KIMERA_SECTIONS, office: KIMERA_SECTIONS,
  assistant: ["sell", "make", "buy", "stock", "items", "plan", "tickets"], // no costs by default
  support: ["sell", "make", "buy", "stock", "items", "plan", "tickets"],
  operator: [],
};
/** What this role may open in Kortana. Owner and Developer always see everything. */
export function kimeraSections(role: Role, rows: { role: Role; sections: KimeraSection[] }[]): KimeraSection[] {
  if (isOwner(role)) return KIMERA_SECTIONS;
  const row = rows.find((r) => r.role === role);
  return row ? KIMERA_SECTIONS.filter((x) => row.sections.includes(x)) : KIMERA_DEFAULT[role];
}
/** May this role see costs, stock value and margins? (Settings → Access → Costs) */
export const canSeeCosts = (role: Role, rows: { role: Role; sections: KimeraSection[] }[]) => kimeraSections(role, rows).includes("costs");
