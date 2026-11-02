import { useMemo } from "react";
import { useToast } from "../components/Toast";
import { t } from "../lib/i18n";
import { opKey } from "../lib/actions";
import { useStore } from "../lib/store";
import type { CompanySettings, Customer, DeliveryState, Issue, ItemSupplier, Job, Order, OrderLine, TableName, TaxRate } from "../lib/types";

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
      setDelivery: (id: string, s: DeliveryState) => run(() => B.rpc<string>("set_delivery", { p_order: id, p_state: s }), ["orders", "order_lines", "stock_items", "stock_movements"]),
      /** lines = [{ line, qty }] or null for everything still to ship. */
      shipLines: (id: string, lines: { line: string; qty: number }[] | null, key = opKey()) =>
        run(() => B.rpc<string>("ship_lines", { p_order: id, p_lines: lines, p_key: key }), ["orders", "order_lines", "stock_items", "stock_movements"], t("Shipment booked")),
      unshipLines: (id: string, lines: { line: string; qty: number }[] | null, key = opKey()) =>
        run(() => B.rpc<string>("unship_lines", { p_order: id, p_lines: lines, p_key: key }), ["orders", "order_lines", "stock_items", "stock_movements"], t("Shipment undone — stock returned")),
      returnLines: (id: string, lines: { line: string; qty: number; restock: boolean }[], reason: string, key = opKey()) =>
        run(() => B.rpc<number>("return_lines", { p_order: id, p_lines: lines, p_reason: reason, p_key: key }), ["orders", "order_lines", "order_returns", "stock_items", "stock_movements"], t("Return booked")),
      convertQuote: (id: string) => run(() => B.rpc<string>("convert_quote", { p_order: id }), ["orders"], t("Quote turned into a sales order")),
      updateJob: (id: string, patch: Partial<Job>) => run(() => B.update("jobs", id, patch), ["jobs"]),
      deleteJob: (id: string) => run(() => B.remove("jobs", id), ["jobs"], t("Deleted")),
      completeMo: (id: string) => run(() => B.rpc<string>("complete_mo", { p_job: id }), ["jobs", "stock_items", "stock_movements"], t("Manufacturing order done — stock updated")),
      reopenMo: (id: string) => run(() => B.rpc<string>("reopen_mo", { p_job: id }), ["jobs", "stock_items", "stock_movements"], t("Reopened — materials returned to stock")),
      saveCustomer: (c: Partial<Customer>) =>
        run(() => c.id ? B.update("customers", c.id, c) : B.insert("customers", c), ["customers", "orders"], t("Customer saved")),
      saveTaxRate: (r: Partial<TaxRate>) =>
        run(() => r.id ? B.update("tax_rates", r.id, r) : B.insert("tax_rates", r), ["tax_rates"], t("Saved")),
      saveSettings: (patch: Partial<CompanySettings>) => run(() => B.update("company_settings", 1 as unknown as string, patch), ["company_settings"], t("Saved")),
      saveItemSupplier: (r: Partial<ItemSupplier>) =>
        run(() => r.id ? B.update("item_suppliers", r.id, r) : B.insert("item_suppliers", r), ["item_suppliers"]),
      removeItemSupplier: (id: string) => run(() => B.remove("item_suppliers", id), ["item_suppliers"]),
      activity: (table?: string | null, row?: string | null) =>
        run(() => B.rpc<AuditRow[]>("recent_activity", { p_table: table ?? null, p_row: row ?? null, p_limit: 300 }), []),
      updateTicket: (id: string, patch: Partial<Issue>) => run(() => B.update("issues", id, patch), ["issues", "issue_comments"]),
      comment: (issueId: string, body: string, me: string) =>
        run(() => B.insert("issue_comments", { issue_id: issueId, author_id: me, body, kind: "comment" }), ["issue_comments"]),
    };
  }, [B, refresh, toast]);
}

export type AuditRow = import("../lib/types").AuditEntry;
