export type Role = "boss" | "manager" | "office" | "assistant" | "operator";

export interface Profile {
  id: string;
  full_name: string;
  employee_code: string;
  role: Role;
  avatar_url: string | null;
  holiday_allowance: number;
  created_at: string;
}

export interface Shift {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  created_at: string;
}

export interface Break {
  id: string;
  shift_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export type JobStatus = "open" | "in_progress" | "paused" | "blocked" | "done";

export interface Job {
  id: string;
  code: string;
  title: string;
  description: string;
  customer: string;
  priority: number; // 1 = most urgent
  status: JobStatus;
  assignees: string[];
  estimate_minutes: number | null;
  quantity: number | null;
  due_date: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface WorkSession {
  id: string;
  job_id: string;
  started_by: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface Participant {
  id: string;
  session_id: string;
  job_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  created_at: string;
}

export interface Invite {
  id: string;
  session_id: string;
  job_id: string;
  from_user: string;
  to_user: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  created_at: string;
}

export type Severity = "low" | "medium" | "high" | "critical";

export interface Issue {
  id: string;
  job_id: string | null;
  reported_by: string;
  category: string;
  severity: Severity;
  title: string;
  description: string;
  status: "open" | "acknowledged" | "resolved";
  resolved_by: string | null;
  created_at: string;
}

export interface StockItem {
  id: string;
  sku: string;
  name: string;
  location: string;
  unit: string;
  quantity: number;
  min_quantity: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export type AbsenceKind = "sick" | "day_off" | "holiday";

export interface Absence {
  id: string;
  user_id: string;
  kind: AbsenceKind;
  start_date: string;
  end_date: string;
  note: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_by: string | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  author_id: string;
  body: string;
  pinned: boolean;
  created_at: string;
}

export interface Tables {
  profiles: Profile;
  shifts: Shift;
  breaks: Break;
  jobs: Job;
  work_sessions: WorkSession;
  participants: Participant;
  invites: Invite;
  issues: Issue;
  stock_items: StockItem;
  absences: Absence;
  announcements: Announcement;
}

export type TableName = keyof Tables;

export const TABLES: TableName[] = [
  "profiles", "shifts", "breaks", "jobs", "work_sessions", "participants",
  "invites", "issues", "stock_items", "absences", "announcements",
];

export type DB = { [K in TableName]: Tables[K][] };
