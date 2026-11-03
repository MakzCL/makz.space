export type Role = "developer" | "boss" | "manager" | "office" | "assistant" | "support" | "operator";

export interface Profile {
  id: string;
  full_name: string;
  employee_code: string;
  role: Role;
  avatar_url: string | null;
  holiday_allowance: number;
  /** False until approved by an admin or joined through an invite link. */
  active: boolean;
  /** Set when someone was removed from SK Factory (history is kept; they can be restored). */
  removed_at?: string | null;
  removed_by?: string | null;
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
  /** Sub-assembly MO: the order it feeds (MFG-02). */
  parent_id: string | null;
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
  /** Production location (null = default). */
  location_id: string | null;
  /** Quantity completed so far (partial completions). */
  produced: number;
  /** Make-to-stock priority (make-to-order MOs follow their sales order). */
  rank: number | null;
}

export interface Station {
  id: string;
  name: string;
  sort: number;
  in_default: boolean;
  /** Resource rate (null when this role may not see costs). */
  cost_per_hour: number | null;
  created_at: string;
}
/** One step to make a product: setup once per MO + minutes per unit at a station, plus a fixed cost. */
export interface ProductOperation {
  id: string;
  product_id: string;
  station_id: string | null;
  name: string;
  setup_minutes: number;
  unit_minutes: number;
  fixed_cost: number | null;
  sort: number;
  /** Operations with the same step run in parallel (MFG-07). */
  step: number | null;
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
  /** Kortana: quote or sales order; open / done / cancelled. */
  kind: "quote" | "order";
  status: "open" | "done" | "cancelled";
  delivery: DeliveryState;
  delivery_deadline: string | null;
  customer_id: string | null;
  prices_include_tax: boolean;
  /** Ships from here (null = default location). */
  location_id: string | null;
  /** Values of the custom order fields. */
  custom: Record<string, string>;
  /** Priority: lower goes first (Sell → arrows). */
  rank: number | null;
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
  /** VAT rate copied onto the line when it was added (0.2 = 20 %); null = no tax. */
  tax_rate: number | null;
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
export interface Customer {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  /** Default tax for their orders (e.g. zero-rated export); null = company default. */
  tax_rate_id: string | null;
  notes: string;
  archived: boolean;
  created_at: string;
  /** Price list that sets this customer's default prices; null = item sale prices. */
  price_list_id: string | null;
}
export interface PriceList { id: string; name: string; currency: string; notes: string; archived: boolean; created_at: string }
export interface PriceListItem { id: string; price_list_id: string; item_id: string; /** quantity break: applies from this quantity */ min_qty: number; price: number; created_at: string }
/** Additional cost on a purchase order (freight, duty…), spread over its lines when received. Hidden without Buy/Costs. */
export interface PoCost { id: string; po_id: string; label: string; amount: number; allocate: "value" | "quantity"; created_by: string | null; created_at: string }
export interface TaxRate {
  id: string;
  name: string;
  /** Fraction: 0.2 = 20 %. */
  rate: number;
  is_default: boolean;
  archived: boolean;
  created_at: string;
}
export interface ItemSupplier {
  id: string;
  item_id: string;
  supplier_id: string;
  supplier_sku: string;
  unit_cost: number | null;
  lead_days: number | null;
  preferred: boolean;
  created_at: string;
  /** Unit the supplier sells in (e.g. "box"); empty = same as stock unit. */
  purchase_unit: string;
  /** Stock units in one purchase unit (box of 100 → 100). */
  units_per_purchase: number;
}
export interface AuditEntry {
  id: number;
  at: string;
  user_id: string | null;
  table_name: string;
  row_id: string | null;
  action: "insert" | "update" | "delete";
  changes: Record<string, unknown>;
}
/** Kortana sections, plus "costs" = may see costs, stock value and margins (ADMIN-03). */
export interface Location {
  id: string;
  name: string;
  kind: "warehouse" | "production" | "partner" | "transit" | "wip";
  address: string;
  is_default: boolean;
  archived: boolean;
  /** Partner locations: the contract manufacturer (supplier) holding this stock. */
  supplier_id: string | null;
  created_at: string;
}
/** Stock of one item at one location (Σ over locations = stock_items.quantity). */
export interface StockLevel {
  item_id: string;
  location_id: string;
  quantity: number;
  bin: string;
  updated_at: string;
}
export interface StockTransfer {
  id: string;
  number: string;
  from_location: string;
  to_location: string;
  status: "draft" | "in_transit" | "received" | "cancelled";
  expected_date: string | null;
  notes: string;
  created_by: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  created_at: string;
}
export interface TransferLine {
  id: string;
  transfer_id: string;
  item_id: string;
  quantity: number;
  created_at: string;
}
/** Materials picked to the production floor for one MO. On floor = picked − used_from_wip − returned. */
export interface MoMaterial {
  job_id: string;
  item_id: string;
  picked: number;
  used_from_wip: number;
  returned: number;
}
/** Warehouse work assigned to someone (WH-02/03). source_id = PO, order or transfer; count tasks list items. */
export interface WhTask {
  id: string;
  number: string;
  kind: "receive" | "pick" | "ship" | "transfer" | "count";
  source_id: string | null;
  location_id: string | null;
  items: string[];
  assigned_to: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  due_date: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  done_at: string | null;
  done_by: string | null;
}
/** Manual demand forecast (PLAN-03/04): replaces the automatic forecast for that week or month. */
export interface ForecastOverride {
  id: string;
  item_id: string;
  location_id: string | null;
  period: "week" | "month";
  period_start: string;
  quantity: number;
  note: string;
  created_by: string | null;
  created_at: string;
}
/** Materials a contractor uses per piece on an outsourced PO line; consumed at their location on receipt. */
export interface PoMaterial {
  id: string;
  po_line_id: string;
  item_id: string;
  quantity_per: number;
  consumed: number;
  created_at: string;
}
export interface Lot {
  id: string;
  item_id: string;
  code: string;
  expiry: string | null;
  created_by: string | null;
  created_at: string;
}
export interface LotLevel {
  lot_id: string;
  location_id: string;
  quantity: number;
}
export type KimeraSection = "sell" | "make" | "buy" | "stock" | "items" | "plan" | "tickets" | "insights" | "settings" | "costs";
export interface KimeraAccess {
  role: Role;
  sections: KimeraSection[];
  updated_by: string | null;
  updated_at: string;
}
export interface CompanySettings {
  id: number;
  base_currency: string;
  default_lead_days: number;
  /** Labour cost per person-hour (actual MO labour from logged time). */
  labour_rate: number;
  work_hours_per_day: number;
  /** Extra fields shown on every sales order (SALES-09). */
  order_fields: { key: string; label: string; type: "text" | "number" | "date" | "select"; options?: string[]; required?: boolean }[];
  /** Raise orders for sub-assemblies automatically when an MO is created (MFG-02). */
  auto_sub_mos: boolean;
  company_name: string;
  company_address: string;
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

export type ItemKind = "material" | "product" | "part" | "service" | "kit";

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
  /** null when this person's role may not see costs (Settings → Access → Costs). */
  avg_cost: number | null;
  sale_price: number | null;
  supplier_id: string | null;
  supplier_code: string;
  barcode: string | null;
  /** none | batch (lot codes, expiry, FEFO) | serial (one lot per piece). */
  tracking: "none" | "batch" | "serial";
  lead_days: number | null;
  notes: string;
  archived: boolean;
  /** Keep at least this many ready: a build is raised automatically below it (0 = off). */
  make_min: number;
  /** Build this many at a time. */
  make_batch: number;
  /** Variant family (CAT-02) and this item's option values, e.g. {"Kolor":"Czarny"}. */
  family_id: string | null;
  variant: Record<string, string>;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface ProductFamily {
  id: string;
  name: string;
  /** Option names, e.g. ["Kolor", "Rozmiar"]. */
  options: string[];
  category: string;
  created_at: string;
}

export interface Stocktake {
  id: string;
  number: string;
  location_id: string | null;
  status: "counting" | "posted" | "cancelled";
  note: string;
  created_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface StocktakeLine {
  id: string;
  stocktake_id: string;
  item_id: string;
  counted: number | null;
  system_at_post: number | null;
  note: string;
  counted_by: string | null;
  counted_at: string | null;
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
  /** outsourced = buying finished work from a contractor who uses our materials at partner_location_id. */
  kind: "standard" | "outsourced";
  partner_location_id: string | null;
  /** Receiving location (null = default). */
  location_id: string | null;
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
  /** null when hidden from this role (needs Buy or Costs). Per stock unit. */
  unit_cost: number | null;
  created_at: string;
  /** Purchase unit for showing/sending the PO in the supplier's units; quantity stays in stock units. */
  purchase_unit: string;
  units_per_purchase: number;
}

export type MoveReason = "adjust" | "count" | "receive" | "consume" | "produce" | "import" | "opening" | "ship" | "return" | "transfer" | "pick";

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
  location_id: string | null;
  /** Batch / serial (tracked items). */
  lot_id: string | null;
  /** Document the movement came from: po_line / order_line / job / return / adjustment / transfer_line / count. */
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
  customers: Customer;
  tax_rates: TaxRate;
  item_suppliers: ItemSupplier;
  kimera_access: KimeraAccess;
  locations: Location;
  stock_levels: StockLevel;
  stock_transfers: StockTransfer;
  transfer_lines: TransferLine;
  mo_materials: MoMaterial;
  po_materials: PoMaterial;
  wh_tasks: WhTask;
  product_families: ProductFamily;
  stocktakes: Stocktake;
  stocktake_lines: StocktakeLine;
  forecast_overrides: ForecastOverride;
  product_operations: ProductOperation;
  lots: Lot;
  lot_levels: LotLevel;
  issue_comments: IssueComment;
  job_steps: JobStep;
  suppliers: Supplier;
  bom_lines: BomLine;
  purchase_orders: PurchaseOrder;
  po_lines: PoLine;
  price_lists: PriceList;
  price_list_items: PriceListItem;
  po_costs: PoCost;
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
  "stations", "station_members", "products", "orders", "order_lines", "order_returns", "company_settings", "customers", "tax_rates", "item_suppliers", "kimera_access", "locations", "stock_levels", "stock_transfers", "transfer_lines", "mo_materials", "po_materials", "wh_tasks", "product_families", "stocktakes", "stocktake_lines", "forecast_overrides", "product_operations", "lots", "lot_levels", "issue_comments", "job_steps",
  "suppliers", "bom_lines", "purchase_orders", "po_lines", "stock_movements", "price_lists", "price_list_items", "po_costs",
  "notifications", "conversations", "conversation_members", "messages", "message_reactions",
  "events", "event_attendees", "calls", "call_participants",
];

export type DB = { [K in TableName]: Tables[K][] };
