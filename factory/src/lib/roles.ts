import type { Role } from "./types";

export type Tab = "home" | "jobs" | "chat" | "time" | "team" | "requests" | "insights" | "issues" | "stock";

export const ROLE_META: Record<Role, { label: string; gateway: string; blurb: string; hue: string }> = {
  boss:      { label: "Owner",      gateway: "Command",    blurb: "Full control, live floor, insights",   hue: "#ff4d4a" },
  manager:   { label: "Manager",   gateway: "Floor lead", blurb: "Plan jobs, run the team, approve",      hue: "#ffb547" },
  office:    { label: "Office",    gateway: "Office",     blurb: "Timesheets, absences, stock, news",     hue: "#9b8cff" },
  assistant: { label: "Assistant", gateway: "Support",    blurb: "Jobs, stock keeping, help the line",    hue: "#4fd1ff" },
  operator:  { label: "Operator",  gateway: "Line",       blurb: "Clock in, run jobs, team up",           hue: "#3ddc97" },
};

export const ROLE_ORDER: Role[] = ["boss", "manager", "office", "assistant", "operator"];

export const TABS_FOR: Record<Role, Tab[]> = {
  boss:      ["home", "jobs", "chat", "team", "insights", "requests"],
  manager:   ["home", "jobs", "chat", "team", "requests", "issues"],
  office:    ["home", "chat", "team", "requests", "time"],
  assistant: ["home", "jobs", "chat", "time", "issues"],
  operator:  ["home", "jobs", "chat", "time", "issues"],
};

/** Stock, sales, purchasing and planning moved to Kimera (kimera.makz.space). */
export const KIMERA_URL = "https://kimera.makz.space";
export const tabsFor = (r: Role, _desktop?: boolean): Tab[] => TABS_FOR[r];

export const can = {
  manageJobs: (r: Role) => r === "boss" || r === "manager",
  admin: (r: Role) => r === "boss" || r === "manager" || r === "office",
  editStock: (r: Role) => r !== "operator",
  changeRoles: (r: Role) => r === "boss",
  postNews: (r: Role) => r === "boss" || r === "manager" || r === "office",
  /** Which roles this person may hand out through an invite link (only the boss makes links). */
  linkRoles: (r: Role): Role[] => r === "boss" ? ["operator", "assistant", "office", "manager", "boss"] : [],
};
