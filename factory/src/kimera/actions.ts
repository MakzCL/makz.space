import { useMemo } from "react";
import { useToast } from "../components/Toast";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import type { DeliveryState, Issue, Job, Order, OrderLine, TableName } from "../lib/types";

/** Back-office actions (Kimera). Every call refreshes what it touched and toasts on failure. */
export function useKimera() {
  const { backend: B, refresh } = useStore();
  const toast = useToast();
  return useMemo(() => {
    const run = async <T,>(fn: () => Promise<T>, tables: TableName[], okMsg?: string): Promise<T | null> => {
      try {
        const r = await fn();
        await Promise.all(tables.map((x) => refresh(x)));
        if (okMsg) toast(okMsg, "ok");
        return r;
      } catch (e) {
        toast(e instanceof Error ? t(e.message) : t("Something went wrong"), "error");
        return null;
      }
    };
    return {
      createOrder: (kind: Order["kind"], f: Partial<Order>) =>
        run(() => B.insert("orders", { order_number: "", kind, source: "manual", currency: "GBP", ordered_at: kind === "order" ? new Date().toISOString() : null, ...f }), ["orders"]),
      updateOrder: (id: string, patch: Partial<Order>) => run(() => B.update("orders", id, patch), ["orders"]),
      deleteOrder: (id: string) => run(() => B.remove("orders", id), ["orders", "order_lines"], t("Deleted")),
      addLine: (row: Partial<OrderLine>) => run(() => B.insert("order_lines", row), ["order_lines"]),
      updateLine: (id: string, patch: Partial<OrderLine>) => run(() => B.update("order_lines", id, patch), ["order_lines"]),
      removeLine: (id: string) => run(() => B.remove("order_lines", id), ["order_lines"]),
      makeLine: (lineId: string) =>
        run(() => B.rpc<string>("create_mo", { p_sku: null, p_title: null, p_qty: null, p_due: null, p_line: lineId, p_route: null }), ["jobs"], t("Manufacturing order created")),
      createMo: (sku: string, title: string, qty: number, due: string | null, route: string[] | null) =>
        run(() => B.rpc<string>("create_mo", { p_sku: sku, p_title: title, p_qty: qty, p_due: due, p_line: null, p_route: route?.length ? route : null }), ["jobs"], t("Manufacturing order created")),
      setDelivery: (id: string, s: DeliveryState) => run(() => B.rpc<string>("set_delivery", { p_order: id, p_state: s }), ["orders", "stock_items", "stock_movements"]),
      convertQuote: (id: string) => run(() => B.rpc<string>("convert_quote", { p_order: id }), ["orders"], t("Quote turned into a sales order")),
      updateJob: (id: string, patch: Partial<Job>) => run(() => B.update("jobs", id, patch), ["jobs"]),
      deleteJob: (id: string) => run(() => B.remove("jobs", id), ["jobs"], t("Deleted")),
      updateTicket: (id: string, patch: Partial<Issue>) => run(() => B.update("issues", id, patch), ["issues", "issue_comments"]),
      comment: (issueId: string, body: string, me: string) =>
        run(() => B.insert("issue_comments", { issue_id: issueId, author_id: me, body, kind: "comment" }), ["issue_comments"]),
    };
  }, [B, refresh, toast]);
}
