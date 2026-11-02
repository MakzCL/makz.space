export type Role = "boss" | "manager" | "office" | "assistant" | "support" | "operator";

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
  /** Teams-style status the person picks. */
  status: PresenceStatus;
  status_note: string;
  last_seen_at: string | null;
}

export type PresenceStatus = "available" | "busy" | "dnd" | "away";

export interface AppNotification {
  id: string;
  user_id: string;
  kind: "news" | "job_new" | "job_given" | "invite" | "message" | "call" | "meeting" | "reminder" | string;
  title: string;
  body: string;
  link: NotifyLink;
  read_at: string | null;
  pushed_at: string | null;
  created_at: string;
}
export interface NotifyLink { tab?: string; job_id?: string; conversation_id?: string; call_id?: string; event_id?: string }

export interface Conversation {
  id: string;
  kind: "direct" | "group" | "channel";
  name: string;
  topic: string;
  direct_key: string | null;
  created_by: string | null;
  last_message_at: string;
  created_at: string;
}
export interface ConversationMember {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "owner" | "member";
  last_read_at: string;
  muted: boolean;
  joined_at: string;
  created_at: string;
}
export interface Attachment { path?: string; name?: string; type?: string; size?: number; w?: number; h?: number; call_id?: string }
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  kind: "text" | "system" | "call";
  body: string;
  attachments: Attachment[];
  reply_to: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}
export interface Reaction { id: string; message_id: string; conversation_id: string; user_id: string; emoji: string; created_at: string }
export interface CalEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  online: boolean;
  organizer_id: string | null;
  reminded: boolean;
  created_at: string;
}
export interface EventAttendee { id: string; event_id: string; user_id: string; response: "pending" | "accepted" | "tentative" | "declined"; created_at: string }
export interface Call {
  id: string;
  conversation_id: string | null;
  event_id: string | null;
  started_by: string | null;
  kind: "voice" | "video";
  status: "ringing" | "active" | "ended";
  started_at: string;
  ended_at: string | null;
  created_at: string;
}
export interface CallParticipant { id: string; call_id: string; user_id: string; joined_at: string; left_at: string | null; created_at: string }

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
  /** Shopify line price per unit. */
  unit_price: number | null;
  /** Materials have been taken off stock for this job. */
  stock_booked: boolean;
  /** Sales order line this manufacturing order is for. */
  order_line_id: string | null;
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
  total_price: number | null;
  currency: string;
  /** Kimera: quote or sales order; open / done / cancelled. */
  kind: "quote" | "order";
  status: "open" | "done" | "cancelled";
  delivery: DeliveryState;
  delivery_deadline: string | null;
  source: "shopify" | "manual";
  stock_out: boolean;
  tracking: string;
  packed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_by: string | null;
  created_at: string;
}
export type DeliveryState = "not_shipped" | "packed" | "partially_shipped" | "shipped" | "delivered";
export interface OrderLine {
  id: string;
  order_id: string;
  item_id: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_price: number | null;
  sort: number;
  shopify_line_id: number | null;
  /** Quantity that has left (ship_lines) and come back (return_lines). */
  shipped: number;
  returned: number;
  created_at: string;
}
export interface OrderReturn {
  id: string;
  order_id: string;
  order_line_id: string;
  quantity: number;
  restock: boolean;
  reason: string;
  created_by: string | null;
  created_at: string;
}
export interface CompanySettings {
  id: number;
  base_currency: string;
  default_lead_days: number;
  updated_at: string;
}
export interface IssueComment {
  id: string;
  issue_id: string;
  author_id: string | null;
  /** Comment text, or for events "status:<s>" / "assign:<uuid>". */
  body: string;
  kind: "comment" | "event";
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
  /** Ticket number (TK-n). */
  number: number;
  assignee_id: string | null;
  updated_at: string;
  resolved_at: string | null;
  created_at: string;
}

export type ItemKind = "material" | "product" | "part" | "service";

export interface StockItem {
  id: string;
  sku: string;
  name: string;
  kind: ItemKind;
  category: string;
  location: string;
  unit: string;
  /** In stock now (changes only through stock functions). */
  quantity: number;
  /** Reorder point. */
  min_quantity: number;
  avg_cost: number;
  sale_price: number | null;
  supplier_id: string | null;
  supplier_code: string;
  lead_days: number | null;
  notes: string;
  archived: boolean;
  /** Keep at least this many ready: a build is raised automatically below it (0 = off). */
  make_min: number;
  /** Build this many at a time. */
  make_batch: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  notes: string;
  created_at: string;
}

export interface BomLine {
  id: string;
  product_id: string;
  material_id: string;
  quantity: number;
  notes: string;
  created_at: string;
}

export type PoStatus = "draft" | "ordered" | "partial" | "received" | "cancelled";

export interface PurchaseOrder {
  id: string;
  number: string;
  supplier_id: string | null;
  status: PoStatus;
  /** Supplier currency (null = base currency) and its value in base currency, fixed when ordered. */
  currency: string | null;
  fx_rate: number;
  expected_date: string | null;
  ordered_at: string | null;
  received_at: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
}

export interface PoLine {
  id: string;
  po_id: string;
  item_id: string;
  quantity: number;
  received: number;
  unit_cost: number;
  created_at: string;
}

export type MoveReason = "adjust" | "count" | "receive" | "consume" | "produce" | "import" | "opening" | "ship" | "return";

export interface StockMovement {
  id: string;
  item_id: string;
  delta: number;
  after: number;
  reason: MoveReason;
  ref: string;
  note: string;
  unit_cost: number | null;
  user_id: string | null;
  /** Manufacturing order that booked this movement (consume / produce). */
  job_id: string | null;
  /** Document the movement came from: po_line / order_line / job / return / adjustment. */
  source_type: string | null;
  source_id: string | null;
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
  order_lines: OrderLine;
  order_returns: OrderReturn;
  company_settings: CompanySettings;
  issue_comments: IssueComment;
  job_steps: JobStep;
  suppliers: Supplier;
  bom_lines: BomLine;
  purchase_orders: PurchaseOrder;
  po_lines: PoLine;
  stock_movements: StockMovement;
  notifications: AppNotification;
  conversations: Conversation;
  conversation_members: ConversationMember;
  messages: Message;
  message_reactions: Reaction;
  events: CalEvent;
  event_attendees: EventAttendee;
  calls: Call;
  call_participants: CallParticipant;
}

export type TableName = keyof Tables;

export const TABLES: TableName[] = [
  "profiles", "shifts", "breaks", "jobs", "work_sessions", "participants",
  "invites", "issues", "stock_items", "absences", "announcements", "join_links",
  "stations", "station_members", "products", "orders", "order_lines", "order_returns", "company_settings", "issue_comments", "job_steps",
  "suppliers", "bom_lines", "purchase_orders", "po_lines", "stock_movements",
  "notifications", "conversations", "conversation_members", "messages", "message_reactions",
  "events", "event_attendees", "calls", "call_participants",
];

export type DB = { [K in TableName]: Tables[K][] };
