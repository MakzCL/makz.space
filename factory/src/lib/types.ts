export type Role = "boss" | "manager" | "office" | "assistant" | "operator";

export interface Profile {
  id: string;
  full_name: string;
  employee_code: string;
  role: Role;
  avatar_url: string | null;
  holiday_allowance: number;
  /** False until approved by an admin or joined through an invite link. */
  active: boolean;
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
  /** Shopify order this job came from (one job per order line). */
  order_id: string | null;
  sku: string | null;
  /** Stations the job passes through, in order; empty = a plain job. */
  route: string[];
  /** Index into route of the station working on it now. */
  stage: number;
  station_id: string | null;
  shopify_line_id: number | null;
}

export interface Station {
  id: string;
  name: string;
  sort: number;
  in_default: boolean;
  created_at: string;
}

export interface StationMember {
  id: string;
  station_id: string;
  user_id: string;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  route: string[];
  estimate_minutes: number | null;
  created_at: string;
}

export interface Order {
  id: string;
  shopify_id: number | null;
  order_number: string;
  customer: string;
  company: string;
  email: string;
  phone: string;
  ship_to: string;
  shipping_method: string;
  note: string;
  ordered_at: string | null;
  created_at: string;
}

export interface JobStep {
  id: string;
  job_id: string;
  station_id: string | null;
  stage: number;
  completed_by: string | null;
  completed_at: string;
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

export type JobLinkRole = Role;

export interface JoinLink {
  id: string;
  code: string;
  pin: string;
  role: Role;
  created_by: string;
  expires_at: string;
  max_uses: number | null;
  uses: number;
  failed: number;
  revoked: boolean;
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
  join_links: JoinLink;
  stations: Station;
  station_members: StationMember;
  products: Product;
  orders: Order;
  job_steps: JobStep;
}

export type TableName = keyof Tables;

export const TABLES: TableName[] = [
  "profiles", "shifts", "breaks", "jobs", "work_sessions", "participants",
  "invites", "issues", "stock_items", "absences", "announcements", "join_links",
  "stations", "station_members", "products", "orders", "job_steps",
];

export type DB = { [K in TableName]: Tables[K][] };
