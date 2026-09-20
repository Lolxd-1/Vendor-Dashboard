import type { Order } from "../../types/order";
import { COLS, center, line, row, wrap, money, formatDateTime } from "./receiptFormat";

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

// Exported from billTemplates.ts so it is unit-testable and reusable by both slips.
export type PaymentLabel = { headline: string; collect: number | null };

export const paymentLabel = (
  order: Pick<Order, "isSettled" | "paymentMethod" | "invoiceAmount" | "totalAmount">
): PaymentLabel => {
  if (order.isSettled === true) {
    return { headline: "PAID", collect: null };
  }
  if (order.paymentMethod && /cod|cash|on[\s-]?delivery/i.test(order.paymentMethod)) {
    return { headline: "COD - COLLECT", collect: order.invoiceAmount ?? order.totalAmount ?? 0 };
  }
  if (order.paymentMethod) {
    return { headline: `PAYMENT: ${order.paymentMethod.toUpperCase()}`, collect: null };
  }
  return { headline: "PAYMENT: UNCONFIRMED", collect: null };
};

// ─── 1. COUNTER MAIN BILL — full record, with prices + tax ───
export const buildCounterBill = (order: Order, prepTime?: number): string => {
  const shop = getShop(order);
  const L: string[] = [];
  const billNo = shortId(order.orderId);
  const dateStr = formatDateTime(order.creationTime);
  const items = order.orderItem || [];
  const totalQty = items.reduce((a, i) => a + (i.itemCount || 0), 0);
  const subTotal = order.amountExcludingDeliveryFee ?? order.totalAmount ?? 0;
  const payment = paymentLabel(order);

  L.push(center("*** QuickVerse ***"));
  L.push(center(shop.name));
  if (shop.address) wrap(shop.address, COLS).forEach((w) => L.push(center(w)));
  if (shop.gstin) L.push(center(`GSTIN: ${shop.gstin}`));
  if (shop.fssai) L.push(center(`FSSAI: ${shop.fssai}`));
  L.push(line());
  L.push(row(`Order: ${order.orderId}`, payment.headline));
  L.push(row(`Bill No.: ${billNo}`, order.fulfillmentOption || "Delivery"));
  L.push(`Date: ${dateStr}`);
  if (prepTime) L.push(`Prep Time: ${prepTime} min`);
  L.push(`Name: ${order.customerName || "--"}`);
  L.push(`Mob: +${order.customerMobile || "--"}`);
  L.push(line());
  L.push(row("Item", "Qty Price Amount"));
  L.push(line("-"));

  items.forEach((it) => {
    const amt = it.itemPrice ? it.itemPrice * it.itemCount : 0;
    const right = `${it.itemCount} ${it.itemPrice ? money(it.itemPrice) : "--"} ${it.itemPrice ? money(amt) : "--"}`;
    const nameLines = wrap(it.name || "Item", COLS - right.length - 2);
    nameLines.forEach((nl, idx) => {
      if (idx === nameLines.length - 1) L.push(row(nl, right));
      else L.push(nl);
    });
  });

  L.push(line());
  L.push(row(`Total Qty: ${totalQty}`, `Sub Total ${money(subTotal)}`));
  // GST split note — 5% restaurant rate, shown as 2.5 + 2.5 per Rule 46.
  const cgst = subTotal ? (subTotal * 2.5) / 102.5 : 0;
  const sgst = cgst;
  if (subTotal) {
    L.push(row("CGST 2.5% (incl)", money(cgst)));
    L.push(row("SGST 2.5% (incl)", money(sgst)));
  }
  L.push(row("Grand Total", `Rs ${money(order.invoiceAmount || subTotal)}`));
  if (payment.collect !== null) L.push(center(`*** COLLECT Rs ${money(payment.collect)} ***`));
  L.push(`Paid via ${order.paymentMethod || "Online"}`);
  L.push(line());
  L.push(center("Tax to be paid u/s 9(5) by ECO"));
  L.push(line());
  L.push(center(`Order ID: ${order.orderId}`));
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

  L.push(center("*** KITCHEN KOT - QuickVerse ***"));
  L.push(center(shop.name));
  L.push(line("="));
  L.push(center(`ORDER: ${order.orderId}`));
  L.push(center(`${formatDateTime(order.creationTime)}  ${order.fulfillmentOption || "Delivery"}`));
  const payment = paymentLabel(order);
  L.push(center(payment.headline));
  if (payment.collect !== null) L.push(center(`*** COLLECT Rs ${money(payment.collect)} ***`));
  if (prepTime || order.preparationTime) L.push(center(`Prep: ${prepTime ?? order.preparationTime} min`));
  L.push(line("="));

  items.forEach((it, idx) => {
    const amt = it.itemPrice ? it.itemPrice * it.itemCount : null;
    L.push(`${idx + 1}. ${it.name}`);
    L.push(row(`   x ${it.itemCount}${amt !== null ? `  Rs ${money(amt)}` : ""}`, it.itemPrice ? `@ ${money(it.itemPrice)}` : ""));
  });

  L.push(line());
  L.push(row(`Total Qty: ${totalQty}`, `Rs ${money(order.amountExcludingDeliveryFee ?? order.totalAmount)}`));
  L.push(`Customer: ${order.customerName || "--"}`);
  L.push(line());
  L.push(center(`Match Bill No.: ${shortId(order.orderId)}`));
  L.push("");
  L.push("");
  L.push("");
  return L.join("\n");
};
