import type { Order } from "../../types/order";
import { COLS, center, line, row, wrap, money, formatDateTime, big } from "./receiptFormat";

interface BillShop {
  name: string;
  address: string;
  gstin: string;
  fssai: string;
}

const getShop = (order: Order): BillShop => {
  const s = order.shopDetails;
  return {
    name: s?.name || sessionStorage.getItem("vendorName") || "Your Store",
    address: s?.address
      ? [s.address.address, s.address.city, s.address.state, s.address.postalCode].filter(Boolean).join(", ")
      : "",
    // Backend does not send these yet — vendor fills once in Printer Settings.
    gstin: localStorage.getItem("qv_gstin") || "",
    fssai: localStorage.getItem("qv_fssai") || "",
  };
};

const shortId = (id: string) => {
  // Bill No. = last 6 digits of real Order ID — same order, short form.
  // e.g. QV-2026-181859 -> 181859. Accurate, never invented.
  if (!id) return "--";
  const digits = String(id).replace(/\D/g, "");
  if (digits.length >= 5) return digits.slice(-6);
  return String(id).slice(-6);
};

// Rider OTP = last 4 digits of the real Order ID.
const riderOtp = (id: string) => {
  const digits = String(id || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : String(id || "--").slice(-4);
};

// Exported from billTemplates.ts so it is unit-testable and reusable by both slips.
export type PaymentLabel = { headline: string; collect: number | null };

// Decided by payment method: COD/cash -> COD (collect the final amount),
// any other method -> PREPAID. No method and not settled -> UNCONFIRMED.
export const paymentLabel = (
  order: Pick<Order, "isSettled" | "paymentMethod" | "invoiceAmount" | "totalAmount">
): PaymentLabel => {
  if (order.paymentMethod && /cod|cash|on[\s-]?delivery/i.test(order.paymentMethod)) {
    return { headline: "COD", collect: order.invoiceAmount ?? order.totalAmount ?? 0 };
  }
  if (order.paymentMethod || order.isSettled === true) {
    return { headline: "PREPAID", collect: null };
  }
  return { headline: "PAYMENT: UNCONFIRMED", collect: null };
};

// Item table laid out like the reference slip: fixed right-aligned
// Qty / Price / Amount columns, the name wraps on the left and the numbers
// sit on the item's first line.
const NAME_W = COLS - 21; // 15 name + 4 qty + 8 price + 9 amount = 36
const itemCols = (name: string, qty: string, price: string, amount: string) =>
  name.padEnd(NAME_W) + qty.padStart(4) + price.padStart(8) + amount.padStart(9);

// The backend sometimes sends an item with no itemPrice. When exactly one line
// is missing it, its amount is whatever the sub total leaves after the priced
// lines (a single-item order: the whole sub total). More than one missing
// line cannot be split honestly, so those stay "--".
const lineAmounts = (items: Order["orderItem"], subTotal: number): (number | null)[] => {
  const amounts = items.map((it) => (it.itemPrice ? it.itemPrice * it.itemCount : null));
  const missing = amounts.filter((a) => a === null).length;
  if (missing === 1) {
    const rest = subTotal - amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
    if (rest > 0) return amounts.map((a) => a ?? rest);
  }
  return amounts;
};

const itemTable = (items: Order["orderItem"], subTotal: number): string[] => {
  const L = [itemCols("Item", "Qty.", "Price", "Amount"), line("-")];
  const amounts = lineAmounts(items, subTotal);
  items.forEach((it, i) => {
    const a = amounts[i];
    const amt = a !== null ? money(a) : "--";
    const price = a !== null && it.itemCount ? money(a / it.itemCount) : "--";
    // A single word longer than the column is cut into pieces, never overflows it.
    const nameLines = wrap(it.name || "Item", NAME_W - 1).flatMap(
      (nl) => nl.match(new RegExp(`.{1,${NAME_W - 1}}`, "g")) || [""]
    );
    nameLines.forEach((nl, idx) => {
      L.push(idx === 0 ? itemCols(nl, String(it.itemCount), price, amt) : nl);
    });
  });
  return L;
};

// Backend sends "DELIVERY"; print it as "Delivery".
const fulfillment = (order: Order) => {
  const f = order.fulfillmentOption || "Delivery";
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
};

// Total Qty + Sub Total, the amount under the Amount column.
const totalsRow = (totalQty: number, subTotal: number) =>
  row(`Total Qty: ${totalQty}`, `Sub Total${money(subTotal).padStart(9)}`);

// ─── 1. COUNTER MAIN BILL — full record, with prices (taxes included) ───
export const buildCounterBill = (order: Order, prepTime?: number): string => {
  const shop = getShop(order);
  const L: string[] = [];
  const billNo = shortId(order.orderId);
  const dateStr = formatDateTime(order.creationTime);
  const items = order.orderItem || [];
  const totalQty = items.reduce((a, i) => a + (i.itemCount || 0), 0);
  const subTotal = order.amountExcludingDeliveryFee ?? order.totalAmount ?? 0;
  const payment = paymentLabel(order);
  const prep = prepTime || order.preparationTime;

  L.push(big("QuickVerse"));
  L.push(center(shop.name));
  if (shop.address) wrap(shop.address, COLS).forEach((w) => L.push(center(w)));
  if (shop.gstin) L.push(center(`GSTIN: ${shop.gstin}`));
  if (shop.fssai) L.push(center(`FSSAI: ${shop.fssai}`));
  L.push(line());
  L.push(center(payment.headline));
  L.push(`Order: ${order.orderId}`);
  L.push(row(`Bill No.: ${billNo}`, fulfillment(order)));
  L.push(`Date: ${dateStr}`);
  if (prep) L.push(`Prep Time: ${prep} min`);
  L.push(line());
  itemTable(items, subTotal).forEach((l) => L.push(l));

  L.push(line());
  L.push(totalsRow(totalQty, subTotal));
  L.push(row("Grand Total", `Rs ${money(order.invoiceAmount || subTotal)}`));
  L.push(line());
  L.push(center(`OTP: ${riderOtp(order.orderId)}`));
  L.push(center("Show this to rider"));
  L.push(line());
  L.push(center("Thanks - Powered by QuickVerse"));
  L.push("");
  L.push("");
  L.push("");
  return L.join("\n");
};

// ─── 2. KITCHEN KOT — confusion-proof, with price + order id ───
export const buildKitchenKOT = (order: Order, prepTime?: number): string => {
  const shop = getShop(order);
  const L: string[] = [];
  const items = order.orderItem || [];
  const totalQty = items.reduce((a, i) => a + (i.itemCount || 0), 0);
  const subTotal = order.amountExcludingDeliveryFee ?? order.totalAmount ?? 0;

  L.push(center("*** KITCHEN KOT - QuickVerse ***"));
  L.push(center(shop.name));
  L.push(line("="));
  L.push(center(`ORDER: ${order.orderId}`));
  L.push(center(`${formatDateTime(order.creationTime)}  ${fulfillment(order)}`));
  if (prepTime || order.preparationTime) L.push(center(`Prep: ${prepTime ?? order.preparationTime} min`));
  L.push(line("="));

  itemTable(items, subTotal).forEach((l) => L.push(l));

  L.push(line());
  L.push(totalsRow(totalQty, subTotal));
  L.push(line());
  L.push(center(`Match Bill No.: ${shortId(order.orderId)}`));
  L.push("");
  L.push("");
  L.push("");
  return L.join("\n");
};
