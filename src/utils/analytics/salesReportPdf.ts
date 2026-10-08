// "Sales & Settlement Report" PDF for the selected period, drawn in the browser from the
// same AnalyticsReport the page shows, so paper and screen always agree. Vector text and
// tables (crisp at any zoom); jsPDF is fetched only when the vendor clicks Download.
import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import { bucketOf, type AnalyticsReport, type OrderBucket } from "./report";
import { commissionOf, orderGross, round2 } from "./commission";
import { addDays, parseOrderTime, payoutDateOf, type DateRange } from "./period";
import { compactInr, dayLabel, deltaPct, hourLabel, pctText, rangeLabel, rs, ymd } from "./format";

export interface ReportMeta {
  shopName: string;
  periodLabel: string;
  isSettlementWeek: boolean;
}

export const reportFileName = (r: DateRange): string =>
  `QuickVerse_Sales_Report_${ymd(r.start)}_to_${ymd(addDays(r.end, -1))}.pdf`;

// The PDF's built-in fonts cover Latin-1 only: map the symbols we use, mark anything else.
export const pdfText = (s: string): string =>
  s
    .replace(/₹\s?/g, "Rs ")
    .replace(/[–—−]/g, "-")
    .replace(/≈/g, "~")
    .replace(/•/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\xFF]/g, "?");

type RGB = [number, number, number];
const NAVY: RGB = [30, 64, 175];
const BLUE: RGB = [42, 120, 214];
const PALE: RGB = [191, 219, 254];
const INK: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];
const LINE: RGB = [226, 232, 240];
const SOFT: RGB = [244, 246, 250];
const WHITE: RGB = [255, 255, 255];
const GOOD: RGB = [0, 99, 0];
const BAD: RGB = [208, 59, 59];
const WARN: RGB = [236, 131, 90];

const STATUS_LABEL: Record<OrderBucket, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
  open: "In progress / other",
};

const SEGMENT_ROWS = [
  ["champions", "Champions", "3+ orders, active in 30 days", "Reward them"],
  ["repeat", "Repeat", "2 orders, active in 30 days", "Nudge a 3rd order"],
  ["new", "New", "1 order in the last 30 days", "Win the 2nd order"],
  ["atRisk", "At risk", "Last order 31-60 days ago", "Send an offer"],
  ["lapsed", "Lapsed", "No order for 60+ days", "Try to win back"],
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
const stamp = (d: Date) => `${dayLabel(d)} ${d.getFullYear()}, ${clock(d)}`;
const pretty = (s: string) => (s.length <= 3 ? s : s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " "));
const signed = (d: number | null) => (d === null ? "No earlier data" : `${d >= 0 ? "+" : "-"}${pctText(Math.abs(d))} vs prev. period`);

const niceTop = (max: number) => {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => raw <= m * p) ?? 10) * p;
  return step * Math.ceil(max / step);
};

export const buildSalesReportPdf = async (report: AnalyticsReport, meta: ReportMeta): Promise<jsPDF> => {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const CW = W - 2 * M;
  const k = report.kpis;
  const prev = report.previousKpis;
  const pct = report.commissionPct;
  let y = 0;

  const font = (size: number, style: "normal" | "bold" = "normal", color: RGB = INK) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const write = (s: string, x: number, at: number, align: "left" | "right" | "center" = "left") =>
    doc.text(pdfText(s), x, at, { align });
  const ensure = (h: number) => {
    if (y + h > H - 18) {
      doc.addPage();
      y = 18;
    }
  };
  const section = (title: string, sub?: string) => {
    ensure(24);
    font(11, "bold", NAVY);
    write(title, M, y);
    if (sub) {
      font(7.5, "normal", MUTED);
      write(sub, W - M, y, "right");
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, y + 2, W - M, y + 2);
    y += 6;
  };
  type Cell = string | { content: string; colSpan: number; styles: { halign: "right" } };
  const clean = (rows: Cell[][] | undefined) =>
    rows?.map((r) => r.map((c) => (typeof c === "string" ? pdfText(c) : { ...c, content: pdfText(c.content) })));
  const table = (opts: Omit<UserOptions, "head" | "body" | "foot"> & { head?: Cell[][]; body: Cell[][]; foot?: Cell[][] }) => {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 18, top: 18 },
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 } },
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: "bold", fontSize: 7.5 },
      footStyles: { fillColor: [232, 238, 252], textColor: INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: SOFT },
      showFoot: "lastPage",
      ...opts,
      head: clean(opts.head),
      body: clean(opts.body),
      foot: clean(opts.foot),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  };
  const right = (...cols: number[]) => Object.fromEntries(cols.map((c) => [c, { halign: "right" as const }]));

  // ── Header band ───────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 34, "F");
  doc.setFillColor(...BLUE);
  doc.rect(0, 34, W, 1.2, "F");
  font(20, "bold", WHITE);
  write("QuickVerse", M, 15);
  font(10, "normal", PALE);
  write("Sales & Settlement Report", M, 22);
  font(12, "bold", WHITE);
  write(meta.shopName, W - M, 13, "right");
  font(8.5, "normal", PALE);
  write(`${meta.periodLabel}: ${rangeLabel(report.range)}`, W - M, 19.5, "right");
  write(`Generated ${stamp(report.generatedAt)}`, W - M, 25, "right");
  y = 43;

  // ── Key facts strip ───────────────────────────────────────────
  const payout = payoutDateOf(report.range);
  const facts = [
    ["Period", rangeLabel(report.range)],
    ["Payout date", meta.isSettlementWeek ? `${dayLabel(payout)} ${payout.getFullYear()}` : "Not a settlement week"],
    ["Commission rate", `${pct}%`],
    ["Sales basis", "Completed orders only"],
  ];
  doc.setFillColor(...SOFT);
  doc.roundedRect(M, y, CW, 15, 2, 2, "F");
  facts.forEach(([label, value], i) => {
    const x = M + 4 + (i * CW) / 4;
    font(6.5, "bold", MUTED);
    write(label.toUpperCase(), x, y + 5.5);
    font(8.5, "bold", INK);
    write(value, x, y + 11);
  });
  y += 21;

  // ── KPI cards ─────────────────────────────────────────────────
  const cards: { label: string; value: string; sub: string; tone?: RGB; hero?: boolean }[] = [
    { label: "Net payout", value: rs(k.net), sub: signed(deltaPct(k.net, prev.net)), hero: true },
    { label: "Gross sales", value: rs(k.gross), sub: signed(deltaPct(k.gross, prev.gross)) },
    { label: `Commission (${pct}%)`, value: rs(k.commission), sub: "On completed orders" },
    { label: "Avg order value", value: rs(k.aov), sub: signed(deltaPct(k.aov, prev.aov)) },
    { label: "Total orders", value: String(k.orders), sub: signed(deltaPct(k.orders, prev.orders)) },
    { label: "Completed", value: String(k.completed), sub: `${pctText(k.completionRate)} of orders`, tone: GOOD },
    { label: "Cancelled", value: String(k.cancelled), sub: `${pctText(k.cancelRate)} of orders`, tone: BAD },
    { label: "Rejected", value: String(k.rejected), sub: `${pctText(k.rejectRate)} of orders`, tone: WARN },
  ];
  const cw = (CW - 3 * 4) / 4;
  const ch = 19;
  cards.forEach((c, i) => {
    const x = M + (i % 4) * (cw + 4);
    const top = y + Math.floor(i / 4) * (ch + 4);
    if (c.hero) {
      doc.setFillColor(...NAVY);
      doc.roundedRect(x, top, cw, ch, 2, 2, "F");
    } else {
      doc.setDrawColor(...LINE);
      doc.setFillColor(...WHITE);
      doc.roundedRect(x, top, cw, ch, 2, 2, "FD");
      if (c.tone) {
        doc.setFillColor(...c.tone);
        doc.rect(x, top + 3, 0.9, ch - 6, "F");
      }
    }
    font(6.5, "bold", c.hero ? PALE : MUTED);
    write(c.label.toUpperCase(), x + 3.5, top + 5.5);
    font(12.5, "bold", c.hero ? WHITE : INK);
    write(c.value, x + 3.5, top + 12);
    font(6.5, "normal", c.hero ? PALE : MUTED);
    write(c.sub, x + 3.5, top + 16.5);
  });
  y += 2 * (ch + 4) + 5;

  // ── Payout statement ──────────────────────────────────────────
  const completed = report.orders.filter((o) => bucketOf(o.state) === "completed");
  const settled = completed.filter((o) => o.isSettled === true).length;
  section("Payout statement", meta.isSettlementWeek ? `Mon-Sun week, paid ${dayLabel(payout)} ${payout.getFullYear()}` : "Selected period");
  table({
    alternateRowStyles: {},
    styles: { font: "helvetica", fontSize: 9, textColor: INK, cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 } },
    footStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: "bold", fontSize: 10.5 },
    columnStyles: { 1: { halign: "right", cellWidth: 50 } },
    body: [
      [`Gross sales from ${k.completed} completed order${k.completed === 1 ? "" : "s"} (item value)`, rs(k.gross)],
      [`Less: QuickVerse commission @ ${pct}%`, `- ${rs(k.commission)}`],
    ],
    foot: [["Net payout to vendor", rs(k.net)]],
  });
  font(7.5, "normal", MUTED);
  write(
    `Marked settled by QuickVerse: ${settled} of ${k.completed} completed orders. Delivery fee, platform fee and GST are not vendor income and are excluded.`,
    M,
    y - 3
  );
  y += 4;

  // ── Order summary ─────────────────────────────────────────────
  const counts: Record<OrderBucket, number> = { completed: k.completed, cancelled: k.cancelled, rejected: k.rejected, open: k.open };
  const valueOf = (b: OrderBucket) =>
    round2(report.orders.filter((o) => bucketOf(o.state) === b).reduce((s, o) => s + orderGross(o), 0));
  const buckets = Object.keys(STATUS_LABEL) as OrderBucket[];
  section("Order summary", `${k.orders} orders placed`);
  table({
    columnStyles: right(1, 2, 3),
    head: [["Status", "Orders", "Share", "Order value (items)"]],
    body: buckets.map((b) => [STATUS_LABEL[b], String(counts[b]), k.orders ? pctText(counts[b] / k.orders) : "0%", rs(valueOf(b))]),
    foot: [["Total", String(k.orders), k.orders ? "100%" : "0%", rs(round2(buckets.reduce((s, b) => s + valueOf(b), 0)))]],
  });

  // ── Sales over time: bar chart + table ───────────────────────
  const points = report.series.points.filter((p) => p.start <= report.generatedAt);
  const unit = report.series.grain === "day" ? "Daily" : "Monthly";
  section(`${unit} sales`, "Completed orders");
  const max = Math.max(0, ...points.map((p) => p.gross));
  if (max > 0) {
    ensure(52);
    const top = niceTop(max);
    const x0 = M + 14;
    const plotW = W - M - x0;
    const plotH = 36;
    const base = y + plotH;
    for (let i = 0; i <= 4; i++) {
      const at = base - (plotH * i) / 4;
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.2);
      doc.line(x0, at, W - M, at);
      font(6.5, "normal", MUTED);
      write(compactInr((top * i) / 4), x0 - 2, at + 1, "right");
    }
    const slot = plotW / points.length;
    const bw = Math.min(6, slot * 0.7);
    const every = Math.ceil(points.length / 12);
    points.forEach((p, i) => {
      const h = (p.gross / top) * plotH;
      const x = x0 + i * slot + (slot - bw) / 2;
      if (h > 0) {
        doc.setFillColor(...BLUE);
        doc.rect(x, base - h, bw, h, "F");
      }
      if (i % every === 0) {
        font(6, "normal", MUTED);
        write(report.series.grain === "day" ? dayLabel(p.start).slice(4) : p.label.slice(0, 3), x + bw / 2, base + 4, "center");
      }
    });
    y = base + 10;
  }
  table({
    columnStyles: right(1, 2, 3, 4, 5),
    head: [[report.series.grain === "day" ? "Date" : "Month", "Orders", "Completed", "Gross sales", "Commission", "Net payout"]],
    body: points.map((p) => [
      p.label,
      String(p.orders),
      String(p.completed),
      rs(p.gross),
      rs(round2(p.gross - p.net)),
      rs(p.net),
    ]),
    foot: [["Total", String(k.orders), String(k.completed), rs(k.gross), rs(k.commission), rs(k.net)]],
  });

  // ── Items ─────────────────────────────────────────────────────
  section("Top items", `${report.items.length} items sold`);
  if (report.items.length === 0) {
    font(8, "normal", MUTED);
    write("No items sold in this period.", M, y);
    y += 8;
  } else {
    table({
      columnStyles: { 0: { cellWidth: 8 }, ...right(2, 3, 4, 5) },
      head: [["#", "Item", "Units", "Orders", "Sales", "Share"]],
      body: report.items
        .slice(0, 15)
        .map((it, i) => [String(i + 1), it.name, String(it.units), String(it.orders), `${it.estimated ? "~" : ""}${rs(it.revenue)}`, pctText(it.share)]),
    });
    if (report.items.some((i) => i.estimated)) {
      font(7, "normal", MUTED);
      write("~ Estimated: some orders came without item prices, so their total was split by each item's usual price.", M, y - 3);
      y += 4;
    }
    if (report.pairs.length > 0) {
      table({
        columnStyles: right(1),
        head: [["Frequently bought together", "Orders"]],
        body: report.pairs.map((p) => [`${p.a} + ${p.b}`, String(p.orders)]),
      });
    }
  }

  // ── Customers ─────────────────────────────────────────────────
  const c = report.customers;
  section("Customers", "New = first-ever order with this shop");
  table({
    columnStyles: right(1, 2),
    head: [["Customers", "Count", "Sales"]],
    body: [
      ["Unique customers", String(c.unique), rs(round2(c.newSales + c.returningSales))],
      ["New customers", String(c.newCount), rs(c.newSales)],
      ["Returning customers", String(c.returningCount), rs(c.returningSales)],
      ["Repeat rate (2+ orders in period)", pctText(c.repeatRate), ""],
    ],
  });
  table({
    columnStyles: right(1),
    head: [["Segment (as of period end)", "Customers", "Rule", "Suggested action"]],
    body: SEGMENT_ROWS.map(([key, label, rule, action]) => [label, String(c.segments[key]), rule, action]),
  });
  if (c.top.length > 0) {
    table({
      columnStyles: right(1, 2),
      head: [["Top customers", "Orders", "Spend", "Last order"]],
      body: c.top.map((t) => [t.name || "Customer", String(t.orders), rs(t.spend), dayLabel(t.lastOrder)]),
    });
  }

  // ── Payments and operations ───────────────────────────────────
  section("Payments & operations");
  const paid = report.payments.reduce((s, p) => s + p.gross, 0);
  if (report.payments.length > 0) {
    table({
      columnStyles: right(1, 2, 3),
      head: [["Payment method", "Orders", "Sales", "Share"]],
      body: report.payments.map((p) => [pretty(p.method), String(p.orders), rs(p.gross), paid ? pctText(p.gross / paid) : "0%"]),
    });
  }
  const peak = report.heatmap.cells.flat().indexOf(report.heatmap.max);
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  table({
    columnStyles: right(1),
    head: [["Operations", "Value"]],
    body: [
      ["Median time to accept an order", report.timing.medianAcceptMin === null ? "-" : `${report.timing.medianAcceptMin} min`],
      ["Median preparation time", report.timing.medianPrepMin === null ? "-" : `${report.timing.medianPrepMin} min`],
      [
        "Busiest hour",
        report.heatmap.max > 0
          ? `${DAYS[Math.floor(peak / 24)]} ${hourLabel(peak % 24)} (${report.heatmap.max} orders)`
          : "-",
      ],
    ],
  });

  // ── Insights ──────────────────────────────────────────────────
  section("Key insights");
  for (const insight of report.insights) {
    const lines = doc.splitTextToSize(pdfText(insight.text), CW - 6) as string[];
    ensure(lines.length * 4 + 3);
    doc.setFillColor(...(insight.tone === "good" ? GOOD : insight.tone === "warn" ? WARN : BLUE));
    doc.circle(M + 1.2, y - 1.1, 1, "F");
    font(8.5, "normal", INK);
    doc.text(lines, M + 5, y);
    y += lines.length * 4 + 2.5;
  }
  y += 3;
  ensure(14);
  font(7, "normal", MUTED);
  const note = doc.splitTextToSize(
    pdfText(
      `Figures are computed from QuickVerse order data for the selected period. Only completed orders count toward sales and payout; commission is shown at ${pct}% as set on the vendor dashboard. Actual bank credit may differ for adjustments, refunds or taxes.`
    ),
    CW
  ) as string[];
  doc.text(note, M, y);

  // ── Annexure: every order ─────────────────────────────────────
  doc.addPage();
  y = 18;
  section("Annexure A - Order details", `${report.orders.length} orders, oldest first`);
  table({
    styles: { font: "helvetica", fontSize: 6.8, textColor: INK, cellPadding: { top: 1.3, bottom: 1.3, left: 1.5, right: 1.5 } },
    headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: "bold", fontSize: 6.8 },
    columnStyles: { 0: { cellWidth: 7 }, ...right(4, 7, 8, 9) },
    head: [["#", "Order ID", "Date & time", "Customer", "Items", "Payment", "Status", "Order value", "Commission", "Net"]],
    body: [...report.orders].reverse().map((o, i) => {
      const b = bucketOf(o.state);
      const g = orderGross(o);
      const fee = commissionOf(g, pct);
      const t = parseOrderTime(o.creationTime);
      const units = o.orderItem?.length ? o.orderItem.reduce((s, it) => s + (it.itemCount || 0), 0) : Number(o.totalItemCount) || 0;
      return [
        String(i + 1),
        String(o.orderId ?? ""),
        t ? stamp(t) : "",
        (o.customerName || "").trim() || "-",
        String(units),
        pretty((o.paymentMethod || "").trim().toUpperCase()) || "-",
        b === "open" ? pretty(String(o.state || "").trim().toUpperCase()) || "-" : STATUS_LABEL[b],
        rs(g),
        b === "completed" ? rs(fee) : "-",
        b === "completed" ? rs(round2(g - fee)) : "-",
      ];
    }),
    foot: [
      [
        { content: `Completed orders total (${k.completed})`, colSpan: 7, styles: { halign: "right" } },
        rs(k.gross),
        rs(k.commission),
        rs(k.net),
      ],
    ],
  });

  // ── Footer on every page ──────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, H - 12, W - M, H - 12);
    font(7, "normal", MUTED);
    write(`QuickVerse · Sales & Settlement Report · ${meta.shopName}`, M, H - 7);
    write(`Page ${i} of ${pages}`, W - M, H - 7, "right");
  }
  return doc;
};

export const downloadSalesReportPdf = async (report: AnalyticsReport, meta: ReportMeta): Promise<void> => {
  const doc = await buildSalesReportPdf(report, meta);
  doc.save(reportFileName(report.range));
};
