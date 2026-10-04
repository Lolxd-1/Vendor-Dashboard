// Order History → "Print Items". ONE continuous slip on the counter printer with every
// item from the orders the selected filter returned, merged like one big order:
// same dish + same price = one line, quantities added up. Lines appear in the order
// the dish was first sold (oldest order first). Same layout as the counter bill.
import toast from "react-hot-toast";
import type { Order } from "../../types/order";
import type { ExportFilters } from "../exportOrders";
import { center, line, row, money, formatDateTime, big, BIG } from "./receiptFormat";
import { getShop, lineAmounts, itemTable, totalsRow } from "./billTemplates";
import { printTextDetailed } from "./printAgent";

// Labels match the FilterBar pills, so the slip reads like the screen.
const TIME_LABELS: Record<string, string> = {
  LAST_30_MIN: "Last 30 min",
  LAST_1_HOUR: "Last 1 hour",
  LAST_3_HOUR: "Last 3 hours",
  TODAY: "Today",
  LAST_WEEK: "Last Week",
  LAST_1_MONTH: "Last 1 month",
  THIS_MONTH: "Monthly",
  THIS_YEAR: "Yearly",
  CUSTOM: "Custom",
};

const pad = (n: number) => String(n).padStart(2, "0");
const dmy = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;

const statusLabel = (status?: string) =>
  status ? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ") : "All";

const periodLabel = (f: ExportFilters) => {
  if (!f.timeRange) return "All time";
  if (f.timeRange === "CUSTOM" && f.from && f.to) return `${dmy(f.from)} - ${dmy(f.to)}`;
  return TIME_LABELS[f.timeRange] || f.timeRange;
};

const timeOf = (o: Order) => {
  const t = new Date(String(o.creationTime || "").replace(" ", "T")).getTime();
  return isNaN(t) ? Infinity : t;
};

// Oldest → newest. Orders without a readable time keep their relative order at the end.
const oldestFirst = (orders: Order[]) =>
  orders.map((o, i) => ({ o, i, t: timeOf(o) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.o);

interface Line {
  name: string;
  qty: number;
  unitPrice: number | null; // null = backend sent no price we can work out
}

const mergeItems = (orders: Order[]): Line[] => {
  const lines = new Map<string, Line>();
  for (const order of orders) {
    const items = order.orderItem || [];
    // Same price rules as the bill (fills a single missing price from the sub total).
    const amounts = lineAmounts(items, order.amountExcludingDeliveryFee ?? order.totalAmount ?? 0);
    items.forEach((it, i) => {
      const qty = it.itemCount || 0;
      const a = amounts[i];
      const unitPrice = a !== null && qty ? Math.round((a / qty) * 100) / 100 : null;
      const name = (it.name || "Item").trim();
      const key = `${name.toLowerCase()}|${unitPrice ?? "-"}`;
      const existing = lines.get(key);
      if (existing) existing.qty += qty;
      else lines.set(key, { name, qty, unitPrice });
    });
  }
  return [...lines.values()];
};

export const buildItemsSummary = (orders: Order[], filters: ExportFilters, now: Date = new Date()): string => {
  const sorted = oldestFirst(orders);
  const lines = mergeItems(sorted);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const subTotal = sorted.reduce((s, o) => s + (o.amountExcludingDeliveryFee ?? o.totalAmount ?? 0), 0);
  const grandTotal = sorted.reduce(
    (s, o) => s + (o.invoiceAmount || (o.amountExcludingDeliveryFee ?? o.totalAmount ?? 0)),
    0
  );
  const tableItems = lines.map((l, i) => ({
    id: i,
    name: l.name,
    itemCount: l.qty,
    itemPrice: l.unitPrice ?? undefined,
  }));

  const L: string[] = [];
  L.push(big("QuickVerse"));
  L.push(center(sorted[0] ? getShop(sorted[0]).name : sessionStorage.getItem("vendorName") || "Your Store"));
  L.push(line());
  L.push(center("ITEMS SUMMARY"));
  L.push(`Status: ${statusLabel(filters.status)}`);
  L.push(`Period: ${periodLabel(filters)}`);
  if (sorted.length) {
    L.push(`From: ${formatDateTime(sorted[0].creationTime)}`);
    L.push(`To:   ${formatDateTime(sorted[sorted.length - 1].creationTime)}`);
  }
  L.push(`Orders: ${sorted.length}`);
  L.push(`Printed: ${formatDateTime(now.toISOString())}`);
  L.push(line());
  // Sub total 0: a merged line without a price stays "--" instead of being given a
  // guessed remainder across many orders (missing prices were already filled per order).
  itemTable(tableItems, 0).forEach((l) => L.push(l));
  L.push(line());
  L.push(totalsRow(totalQty, subTotal));
  L.push(row("Grand Total", `Rs ${money(grandTotal)}`));
  L.push(line());
  L.push(center("Powered by QuickVerse"));
  L.push("");
  L.push("");
  L.push("");
  return L.join("\n");
};

// ─── Long slips ───────────────────────────────────────────────────
// The print agent sizes its font so 36 columns fill the 80mm roll: one line is
// ~4mm of paper. A heading line (BIG) is drawn double height.
const MM_PER_LINE = 4;
// Above ~1m of paper, ask first.
export const CONFIRM_ABOVE_LINES = 250;
// Above ~6m, refuse. The agent gives one print 10s to reach the Windows spooler;
// 1,159 lines took 5.5s on a shop-class PC, so this keeps every slip well inside it.
export const MAX_SLIP_LINES = 1500;

export const slipLineCount = (text: string): number =>
  text.split("\n").reduce((n, l) => n + (l.startsWith(BIG) ? 2 : 1), 0);

const paperMetres = (lines: number) => ((lines * MM_PER_LINE) / 1000).toFixed(1);

// The job may already be on paper when either side gave up waiting — never say "failed" then.
// ("printer lookup timed out" is different: nothing was sent, so it stays a plain failure.)
const MAY_STILL_PRINT = /print timed out|did not answer in time/i;

// Same printer path and same honest toasts as a normal bill reprint.
export const printItemsSummary = async (orders: Order[], filters: ExportFilters): Promise<void> => {
  try {
    const text = buildItemsSummary(orders, filters);
    const lines = slipLineCount(text);
    if (lines > MAX_SLIP_LINES) {
      toast.error(
        `This slip would be ${lines} lines (about ${paperMetres(lines)} m of paper) — too long to print in one go. Pick a shorter period, or use Export.`,
        { duration: 8000 }
      );
      return;
    }
    if (
      lines > CONFIRM_ABOVE_LINES &&
      !window.confirm(
        `This slip is long: ${lines} lines, about ${paperMetres(lines)} m of paper (${orders.length} orders).\n\nPrint it?`
      )
    ) {
      toast("Not printed");
      return;
    }
    const out = await printTextDetailed("counter", text);
    if (out.where === "agent") toast.success(`Items summary sent → ${out.printer}`);
    else if (out.where === "browser") toast("Print window opened — confirm to print", { icon: "🖨️" });
    else if (out.error && MAY_STILL_PRINT.test(out.error))
      toast.error(`The slip may still be printing on ${out.printer} — check the printer before printing again.`, {
        duration: 10000,
      });
    else toast.error(`Print failed: ${out.printer}${out.error ? `: ${out.error}` : ""}`, { duration: 6000 });
  } catch (err) {
    toast.error(`Print failed: ${(err as Error)?.message || "unknown error"}`, { duration: 6000 });
  }
};
