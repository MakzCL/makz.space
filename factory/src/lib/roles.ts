import type { Role } from "./types";

export type Tab = "home" | "jobs" | "time" | "team" | "requests" | "insights" | "issues" | "stock";

export const ROLE_META: Record<Role, { label: string; gateway: string; blurb: string; hue: string }> = {
  boss:      { label: "Boss",      gateway: "Command",    blurb: "Full control, live floor, insights",   hue: "#ff4d4a" },
  manager:   { label: "Manager",   gateway: "Floor lead", blurb: "Plan jobs, run the team, approve",      hue: "#ffb547" },
  office:    { label: "Office",    gateway: "Office",     blurb: "Timesheets, absences, stock, news",     hue: "#9b8cff" },
  assistant: { label: "Assistant", gateway: "Support",    blurb: "Jobs, stock keeping, help the line",    hue: "#4fd1ff" },
  operator:  { label: "Operator",  gateway: "Line",       blurb: "Clock in, run jobs, team up",           hue: "#3ddc97" },
};

export const ROLE_ORDER: Role[] = ["boss", "manager", "office", "assistant", "operator"];

export const TABS_FOR: Record<Role, Tab[]> = {
  boss:      ["home", "jobs", "team", "insights", "requests"],
  manager:   ["home", "jobs", "team", "requests", "issues"],
  office:    ["home", "team", "requests", "stock", "time"],
  assistant: ["home", "jobs", "time", "issues", "stock"],
  operator:  ["home", "jobs", "time", "issues", "stock"],
};

export const can = {
  manageJobs: (r: Role) => r === "boss" || r === "manager",
  admin: (r: Role) => r === "boss" || r === "manager" || r === "office",
  editStock: (r: Role) => r !== "operator",
  changeRoles: (r: Role) => r === "boss",
  postNews: (r: Role) => r === "boss" || r === "manager" || r === "office",
  /** Which roles this person may hand out through an invite link (only the boss makes links). */
  linkRoles: (r: Role): Role[] => r === "boss" ? ["operator", "assistant", "office", "manager", "boss"] : [],
};
