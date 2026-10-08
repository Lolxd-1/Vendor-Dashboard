import { describe, expect, it, vi } from "vitest";
import type { Order } from "../../../types/order";

// Real jsPDF, except save(): under Node it would write a file to disk.
const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));
vi.mock("jspdf", async (importOriginal) => {
  const mod = await importOriginal<typeof import("jspdf")>();
  return {
    ...mod,
    jsPDF: function (...args: ConstructorParameters<typeof mod.jsPDF>) {
      const doc = new mod.jsPDF(...args);
      doc.save = saveMock as unknown as typeof doc.save;
      return doc;
    },
  };
});
import { presetRange, settlementWeekOf } from "../period";
import { buildReport } from "../report";
import { buildSalesReportPdf, downloadSalesReportPdf, pdfText, reportFileName } from "../salesReportPdf";

const order = (id: string, state: string, creationTime: string, gross: number, extra: Partial<Order> = {}) =>
  ({
    orderId: id,
    state,
    creationTime,
    amountExcludingDeliveryFee: gross,
    customerId: 0,
    customerName: `Customer ${id}`,
    orderItem: [{ id: 1, name: "Chicken Shawarma Combo", itemCount: 1 }],
    paymentMethod: "COD",
    isSettled: false,
    ...extra,
  }) as unknown as Order;

const NOW = new Date(2026, 9, 8, 15);
const WEEK = settlementWeekOf(NOW);
const ORDERS = [
  order("1952034839600505", "COMPLETED", "2026-10-05 10:00:00", 110, { customerId: 1, isSettled: true }),
  order("5075472670776885", "COMPLETED", "2026-10-06 19:30:00", 89.1, { customerId: 2, paymentMethod: "QR_CODE" }),
  order("5509702345373439", "CANCELLED", "2026-10-06 20:00:00", 256, { customerId: 3 }),
  order("4476755985228596", "REJECTED", "2026-10-07 21:00:00", 83, { customerId: 4 }),
  order("6355225790592262", "READY_FOR_PICKUP", "2026-10-08 12:00:00", 236, { customerId: 5 }),
  order("7053171418783246", "COMPLETED", "2026-10-07 19:10:00", 45.55, {
    customerId: 1,
    orderItem: [{ id: 2, name: "Chicken Biryani (half)", itemCount: 2 }],
  }),
  order("3661973532775142", "COMPLETED", "2026-09-29 12:00:00", 200, { customerId: 1 }),
];
const META = { shopName: "Saffron", periodLabel: "Settlement week", isSettlementWeek: true };

// jsPDF writes text uncompressed by default, so the raw file can be searched.
const pdfOf = async (report = buildReport(ORDERS, WEEK, 10, NOW)) => (await buildSalesReportPdf(report, META)).output();

describe("pdfText", () => {
  it("maps symbols the PDF fonts lack and marks other scripts", () => {
    expect(pdfText("₹339 — lost – sales ≈ “ok” • it’s…")).toBe(`Rs 339 - lost - sales ~ "ok" - it's...`);
    expect(pdfText("राम")).toBe("???");
    expect(pdfText("Café · 12")).toBe("Café · 12");
  });
});

describe("reportFileName", () => {
  it("names the file by the period's first and last day", () => {
    expect(reportFileName(WEEK)).toBe("QuickVerse_Sales_Report_2026-10-05_to_2026-10-11.pdf");
  });
});

describe("buildSalesReportPdf", () => {
  it("states the payout exactly as the page does", async () => {
    const pdf = await pdfOf();
    for (const text of [
      "Sales & Settlement Report",
      "Saffron",
      "Settlement week: Mon 5 Oct - Sun 11 Oct 2026",
      "Mon 12 Oct 2026",
      "Rs 244.65", // gross
      "Rs 24.47", // commission at 10%
      "Rs 220.18", // net payout
      "Net payout to vendor",
      "Marked settled by QuickVerse: 1 of 3 completed orders.",
    ]) {
      expect(pdf).toContain(text);
    }
  });

  it("includes the order summary, items, customers, insights and every order in the annexure", async () => {
    const pdf = await pdfOf();
    for (const text of [
      "Order summary",
      "Cancelled",
      "Rejected",
      "Daily sales",
      "Top items",
      "Chicken Shawarma Combo",
      "Customers",
      "Key insights",
      "Annexure A - Order details",
      "1952034839600505",
      "6355225790592262",
      "Ready for", // "Ready for pickup" wraps inside the narrow status column
      "Cash on delivery", // payment mix uses the page's names
      "QR code",
      "Completed orders total \\(3\\)", // PDF strings escape parentheses
    ]) {
      expect(pdf).toContain(text);
    }
    expect(pdf).not.toContain("3661973532775142"); // last week's order is not in this period
  });

  it("never writes characters the PDF fonts cannot show", async () => {
    const pdf = await pdfOf();
    expect(pdf).not.toMatch(/[₹—–≈]/);
  });

  it("numbers every page", async () => {
    const doc = await buildSalesReportPdf(buildReport(ORDERS, WEEK, 10, NOW), META);
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThanOrEqual(2);
    const pdf = doc.output();
    for (let i = 1; i <= pages; i++) expect(pdf).toContain(`Page ${i} of ${pages}`);
  });

  it("handles an empty period", async () => {
    const pdf = await pdfOf(buildReport([], WEEK, 10, NOW));
    expect(pdf).toContain("No items sold in this period.");
    expect(pdf).toContain("No orders in this period.");
    expect(pdf).toContain("Rs 0.00");
  });

  it("monthly reports leave out months that have not happened yet", async () => {
    const pdf = await pdfOf(buildReport(ORDERS, presetRange("THIS_YEAR", NOW), 10, NOW));
    expect(pdf).toContain("Monthly sales");
    expect(pdf).toContain("Oct 2026");
    expect(pdf).not.toContain("Nov 2026");
  });
});

describe("downloadSalesReportPdf", () => {
  it("saves the PDF under the period's file name", async () => {
    await downloadSalesReportPdf(buildReport(ORDERS, WEEK, 10, NOW), META);
    expect(saveMock).toHaveBeenCalledWith("QuickVerse_Sales_Report_2026-10-05_to_2026-10-11.pdf");
  });
});
