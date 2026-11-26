/**
 * Spending cap for Cloudflare Realtime (the call server and the TURN relay share one bill: the first 1,000 GB
 * sent out each month are free, then $0.05 per GB). Cloudflare has no hard spending limit for this, so SEND
 * enforces one itself from Cloudflare's own usage numbers:
 *
 * - Usage = SFU + TURN egress over the last 31 days (a rolling window, so any billing month is covered
 *   whatever day it starts on), read from Cloudflare's analytics API every few minutes.
 * - "soft": past the free allowance, no new calls go through the call server; "global" channels connect
 *   people directly instead (free).
 * - "hard": close to the budget, calls still on the call server are moved to direct calls and the relay is no
 *   longer handed out (people on networks that block direct connections can't connect media until it resets).
 * - If usage can't be read for a while, the call server is treated as over budget (fail closed); the relay,
 *   which costs little, keeps working.
 *
 * Configure with SEND_CF_ANALYTICS_TOKEN (Account Analytics: Read) and SEND_CF_ACCOUNT_ID. SEND_MEDIA_BUDGET_USD
 * sets the monthly spend (default 5). Without the token nothing is capped (local development).
 */
const GB = 1e9;
const FREE_GB = 1000;
const USD_PER_GB = 0.05;
/** Room for usage that hasn't shown up in analytics yet (it lags) and calls in progress: about 20 minutes of a 10-person call. */
const MARGIN_GB = 30;
const POLL_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;

export type BudgetLevel = "ok" | "soft" | "hard";
export interface BudgetStatus {
  configured: boolean; level: BudgetLevel; used_gb: number | null; free_gb: number; budget_usd: number;
  soft_gb: number; hard_gb: number; checked_at: number | null; error: string | null;
}

const env = process.env;
const token = env.SEND_CF_ANALYTICS_TOKEN || "";
const account = env.SEND_CF_ACCOUNT_ID || "";
const budgetUsd = Math.max(0, Number(env.SEND_MEDIA_BUDGET_USD ?? 5) || 0);
const capGb = FREE_GB + budgetUsd / USD_PER_GB;

export const budget: BudgetStatus = {
  configured: !!(token && account), level: "ok", used_gb: null, free_gb: FREE_GB, budget_usd: budgetUsd,
  soft_gb: FREE_GB, hard_gb: Math.max(FREE_GB, capGb - MARGIN_GB), checked_at: null, error: null,
};

/** Pure: which level a usage figure falls in. */
export function levelFor(usedGb: number, softGb = budget.soft_gb, hardGb = budget.hard_gb): BudgetLevel {
  return usedGb >= hardGb ? "hard" : usedGb >= softGb ? "soft" : "ok";
}

const QUERY = `query($a:String!,$s:Date!,$e:Date!){viewer{accounts(filter:{accountTag:$a}){
 sfu:callsUsageAdaptiveGroups(limit:1,filter:{date_geq:$s,date_leq:$e}){sum{egressBytes}}
 turn:callsTurnUsageAdaptiveGroups(limit:1,filter:{date_geq:$s,date_leq:$e}){sum{egressBytes}}}}}`;

async function fetchUsedGb(): Promise<number> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(), start = new Date(end.getTime() - 30 * 86400_000);
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { a: account, s: day(start), e: day(end) } }), signal: AbortSignal.timeout(15000),
  });
  const data: any = await r.json().catch(() => null);
  if (!r.ok || !data?.data || data.errors?.length) throw new Error(`analytics ${r.status}: ${JSON.stringify(data?.errors ?? data).slice(0, 160)}`);
  const acc = data.data.viewer.accounts[0];
  if (!acc) throw new Error("analytics: account not visible to this token");
  const bytes = (acc.sfu?.[0]?.sum?.egressBytes ?? 0) + (acc.turn?.[0]?.sum?.egressBytes ?? 0);
  return Math.round((bytes / GB) * 100) / 100;
}

type Listener = (level: BudgetLevel, prev: BudgetLevel) => void;
const listeners: Listener[] = [];
export const onBudgetChange = (fn: Listener) => { listeners.push(fn); };

export async function checkBudget() {
  if (!budget.configured) return budget;
  const prev = budget.level;
  try {
    budget.used_gb = await fetchUsedGb();
    budget.checked_at = Date.now(); budget.error = null;
    budget.level = levelFor(budget.used_gb);
  } catch (e) {
    budget.error = (e as Error).message;
    console.error("[budget]", budget.error);
    // Fail closed for the call server once the last good reading is too old.
    if (!budget.checked_at || Date.now() - budget.checked_at > STALE_MS) budget.level = budget.level === "hard" ? "hard" : "soft";
  }
  if (budget.level !== prev) {
    console.log(`[budget] ${prev} -> ${budget.level} (${budget.used_gb ?? "?"} GB of ${budget.hard_gb} GB)`);
    for (const fn of listeners) { try { fn(budget.level, prev); } catch (e) { console.error("[budget] listener", e); } }
  }
  return budget;
}

/** May a new call use the call server (SFU)? */
export const sfuAllowed = () => !budget.configured || budget.level === "ok";
/** May the relay (TURN) be handed out? */
export const relayAllowed = () => !budget.configured || budget.level !== "hard";

if (budget.configured && env.NODE_ENV !== "test") {
  void checkBudget();
  setInterval(() => void checkBudget(), POLL_MS).unref();
}
