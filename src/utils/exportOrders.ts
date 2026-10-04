// Order History → "Export" button. Turns the orders the page has already loaded
// (i.e. exactly what the selected filters returned) into a CSV that opens in Excel.
// One row per order.
import type { Order } from "../types/order";

type Cell = string | number | null | undefined;

// ─── Address: same rules as parseAddress in OrderDetailsModal ────
// Handles both the new object shape and the old Java-Map string "{addressLine1=.., city=..}".
const ADDRESS_KEYS = ["addressLine1", "addressLine2", "addressLine3", "city", "state", "pincode"];

const formatAddress = (addr: unknown): string => {
  if (!addr) return "";
  if (typeof addr === "string") {
    if (addr.startsWith("{") && addr.endsWith("}")) {
      const addrObj: Record<string, string> = {};
      addr.slice(1, -1).split(", ").forEach((p) => {
        const firstEqual = p.indexOf("=");
        if (firstEqual > -1) addrObj[p.substring(0, firstEqual).trim()] = p.substring(firstEqual + 1).trim();
      });
      const lines = ADDRESS_KEYS.map((k) => addrObj[k]).filter(Boolean);
      return lines.length > 0 ? lines.join(", ") : addr;
    }
    return addr;
  }
  if (typeof addr === "object") {
    const obj = addr as Record<string, unknown>;
    return ADDRESS_KEYS.map((k) => obj[k]).filter(Boolean).join(", ");
  }
  return String(addr);
};

// ─── Date: "2026-10-02 08:57 PM" (unambiguous in every Excel locale) ──
const pad = (n: number) => String(n).padStart(2, "0");

const formatDateTime = (value?: string | null): string => {
  if (!value) return "";
  const d = new Date(value.replace(" ", "T"));
  if (isNaN(d.getTime())) return value;
  const h = d.getHours();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h >= 12 ? "PM" : "AM"}`;
};

// ─── Long digit strings (phones, numeric IDs) ────────────────────
// Excel would show 919876543210 as 9.19877E+11 and drop leading zeros.
// ="919876543210" makes it keep the value as text.
const digitsAsText = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value);
  return /^\d+$/.test(s) ? `="${s}"` : s;
};

const formatItems = (items: Order["orderItem"] | undefined): string =>
  (items || [])
    .map((it) => `${it.itemCount} x ${it.name}${it.itemPrice ? ` @ ₹${it.itemPrice}` : ""}`)
    .join("; ");

const yesNo = (v: boolean | undefined | null) => (v === true ? "Yes" : v === false ? "No" : "");

// ─── CSV cell escaping ───────────────────────────────────────────
// Text starting with = + - @ (or tab/CR) would run as a formula in Excel; prefix it with '.
// Our own ="<digits>" wrapper from digitsAsText is the one allowed exception.
const escapeCell = (value: Cell): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value;
  if (/^[=+\-@\t\r]/.test(s) && !/^="\d+"$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS: { header: string; value: (o: Order) => Cell }[] = [
  { header: "Order ID", value: (o) => digitsAsText(o.orderId) },
  { header: "Date & Time", value: (o) => formatDateTime(o.creationTime) },
  { header: "Status", value: (o) => o.state },
  { header: "Customer Name", value: (o) => o.customerName },
  { header: "Customer Phone", value: (o) => digitsAsText(o.customerMobile) },
  { header: "Customer Address", value: (o) => formatAddress(o.customerAddress) },
  { header: "Items", value: (o) => formatItems(o.orderItem) },
  { header: "Total Item Count", value: (o) => o.totalItemCount },
  { header: "Order Amount (₹)", value: (o) => o.amountExcludingDeliveryFee },
  { header: "Packaging Charge (₹)", value: (o) => o.packagingCharge },
  { header: "GST (₹)", value: (o) => o.gstAmount },
  { header: "Delivery Fee (₹)", value: (o) => o.deliveryFee },
  { header: "Platform Fee (₹)", value: (o) => o.platformFee },
  { header: "Invoice Amount (₹)", value: (o) => o.invoiceAmount },
  { header: "Total Amount (₹)", value: (o) => o.totalAmount },
  { header: "Payment Method", value: (o) => o.paymentMethod },
  { header: "Settled", value: (o) => yesNo(o.isSettled) },
  { header: "Fulfillment", value: (o) => o.fulfillmentOption },
  { header: "Accepted At", value: (o) => formatDateTime(o.acceptedDate) },
  { header: "Ready At", value: (o) => formatDateTime(o.readyDate) },
  { header: "Preparation Time (min)", value: (o) => o.preparationTime },
  { header: "Delivery Partner", value: (o) => o.deliveryPartnerDetails?.name },
  { header: "Delivery Partner Phone", value: (o) => digitsAsText(o.deliveryPartnerDetails?.mobileNumber) },
];

export const ordersToCsv = (orders: Order[]): string => {
  const lines = [
    COLUMNS.map((c) => escapeCell(c.header)).join(","),
    ...orders.map((o) => COLUMNS.map((c) => escapeCell(c.value(o))).join(",")),
  ];
  // BOM so Excel reads UTF-8 (₹, Hindi/Marathi names) correctly.
  return String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";
};

const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface ExportFilters {
  status?: string;
  timeRange?: string;
  from?: Date | null;
  to?: Date | null;
}

// e.g. QuickVerse_Orders_COMPLETED_THIS_MONTH_2026-10-02.csv
//      QuickVerse_Orders_ALL_CUSTOM_2026-09-01_to_2026-09-30_2026-10-02.csv
export const buildExportFileName = (filters: ExportFilters, now: Date = new Date()): string => {
  const parts = ["QuickVerse_Orders", filters.status || "ALL", filters.timeRange || "ALL"];
  if (filters.timeRange === "CUSTOM" && filters.from && filters.to) {
    parts.push(`${ymd(filters.from)}_to_${ymd(filters.to)}`);
  }
  parts.push(ymd(now));
  return `${parts.join("_")}.csv`;
};

export const downloadOrdersCsv = (orders: Order[], filters: ExportFilters): void => {
  const blob = new Blob([ordersToCsv(orders)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildExportFileName(filters);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
