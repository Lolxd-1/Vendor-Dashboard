import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExportFileName, downloadOrdersCsv, ordersToCsv } from "../exportOrders";
import type { Order } from "../../types/order";

// Minimal RFC 4180 parser, so the tests check what Excel will actually see as cells.
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

const makeOrder = (over: Partial<Order> = {}): Order => ({
  orderId: "ORD-1001",
  campusId: "C1",
  shopId: 7,
  customerId: 99,
  customerName: "Ravi Kumar",
  customerMobile: 919876543210,
  customerAddress: "Hostel A, Room 12",
  state: "COMPLETED",
  creationTime: "2026-10-02 20:57:10",
  acceptedDate: "2026-10-02 20:58:00",
  readyDate: null,
  preparationTime: 15,
  orderItem: [
    { id: 1, name: "Veg Biryani", itemCount: 2, itemPrice: 120 },
    { id: 2, name: "Coke", itemCount: 1 },
  ],
  totalItemCount: 3,
  productCount: 2,
  totalAmount: 300,
  invoiceAmount: 290,
  amountExcludingDeliveryFee: 260,
  deliveryFee: 30,
  platformFee: 5,
  packagingCharge: 10,
  gstAmount: 12.5,
  fulfillmentOption: "Delivery",
  productImageURLs: "",
  stateLabel: "Completed",
  orderDescription: "",
  orderLink: "",
  paymentMethod: "Online",
  isSettled: true,
  deliveryPartnerDetails: { name: "Suresh", mobileNumber: 918888777766 } as Order["deliveryPartnerDetails"],
  ...over,
});

const rowsOf = (orders: Order[]) => parseCsv(ordersToCsv(orders).slice(1));
const cellOf = (orders: Order[], header: string, rowIdx = 1) => {
  const rows = rowsOf(orders);
  return rows[rowIdx][rows[0].indexOf(header)];
};

describe("ordersToCsv", () => {
  it("starts with a UTF-8 BOM and uses CRLF line endings", () => {
    const csv = ordersToCsv([makeOrder()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3); // header, 1 order, trailing ""
  });

  it("writes the header and one row per order, every row the same width", () => {
    const rows = rowsOf([makeOrder(), makeOrder({ orderId: "ORD-1002" }), makeOrder({ orderId: "ORD-1003" })]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual([
      "Order ID", "Date & Time", "Status", "Customer Name", "Customer Phone", "Customer Address",
      "Items", "Total Item Count", "Order Amount (₹)", "Packaging Charge (₹)", "GST (₹)",
      "Delivery Fee (₹)", "Platform Fee (₹)", "Invoice Amount (₹)", "Total Amount (₹)",
      "Payment Method", "Settled", "Fulfillment", "Accepted At", "Ready At",
      "Preparation Time (min)", "Delivery Partner", "Delivery Partner Phone",
    ]);
    rows.forEach((r) => expect(r).toHaveLength(rows[0].length));
  });

  it("fills every field from the order", () => {
    const rows = rowsOf([makeOrder()]);
    expect(rows[1]).toEqual([
      "ORD-1001", "2026-10-02 08:57 PM", "COMPLETED", "Ravi Kumar", '="919876543210"', "Hostel A, Room 12",
      "2 x Veg Biryani @ ₹120; 1 x Coke", "3", "260", "10", "12.5",
      "30", "5", "290", "300",
      "Online", "Yes", "Delivery", "2026-10-02 08:58 PM", "",
      "15", "Suresh", '="918888777766"',
    ]);
  });

  it("keeps long numeric IDs and phones as text, so Excel cannot round them", () => {
    expect(cellOf([makeOrder({ orderId: "1234567890123456789" })], "Order ID")).toBe('="1234567890123456789"');
    expect(cellOf([makeOrder({ orderId: "0042" })], "Order ID")).toBe('="0042"');
  });

  it("escapes commas, quotes and line breaks without shifting columns", () => {
    const order = makeOrder({ customerName: 'Ravi "RK", Kumar', customerAddress: "Line 1\nLine 2" });
    const rows = rowsOf([order]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(rows[0].length);
    expect(cellOf([order], "Customer Name")).toBe('Ravi "RK", Kumar');
    expect(cellOf([order], "Customer Address")).toBe("Line 1\nLine 2");
  });

  it.each(["=HYPERLINK(\"http://x\")", "+91 123", "-1+2", "@SUM(A1)", "\tcmd"])(
    "neutralises a formula-looking text %j",
    (name) => {
      expect(cellOf([makeOrder({ customerName: name })], "Customer Name")).toBe(`'${name}`);
    },
  );

  it("formats the old Java-Map address string like the order details modal", () => {
    const addr = "{addressLine1=Hostel A, addressLine2=Room 12, city=Pune, state=MH, pincode=411001}";
    expect(cellOf([makeOrder({ customerAddress: addr })], "Customer Address")).toBe("Hostel A, Room 12, Pune, MH, 411001");
  });

  it("formats the object address shape", () => {
    const addr = { addressLine1: "Hostel B", city: "Pune", pincode: "411002" } as unknown as string;
    expect(cellOf([makeOrder({ customerAddress: addr })], "Customer Address")).toBe("Hostel B, Pune, 411002");
  });

  it("leaves missing optional fields blank (never 'undefined' or 'null')", () => {
    const order = makeOrder({
      customerName: undefined as unknown as string,
      customerMobile: undefined as unknown as number,
      customerAddress: null as unknown as string,
      orderItem: undefined as unknown as Order["orderItem"],
      packagingCharge: undefined,
      gstAmount: undefined,
      platformFee: undefined,
      isSettled: undefined as unknown as boolean,
      acceptedDate: undefined,
      readyDate: null,
      deliveryPartnerDetails: null,
    });
    const csv = ordersToCsv([order]);
    expect(csv).not.toMatch(/undefined|null|NaN/);
    expect(rowsOf([order])[1]).toHaveLength(rowsOf([order])[0].length);
  });

  it("shows Settled = No when false and keeps an unparseable date as-is", () => {
    expect(cellOf([makeOrder({ isSettled: false })], "Settled")).toBe("No");
    expect(cellOf([makeOrder({ creationTime: "not a date" })], "Date & Time")).toBe("not a date");
  });

  it("with no orders still writes the header row", () => {
    expect(rowsOf([])).toHaveLength(1);
  });
});

describe("buildExportFileName", () => {
  const now = new Date(2026, 9, 2, 22, 30);

  it("names the file after the selected filters", () => {
    expect(buildExportFileName({ status: "COMPLETED", timeRange: "THIS_MONTH" }, now))
      .toBe("QuickVerse_Orders_COMPLETED_THIS_MONTH_2026-10-02.csv");
  });

  it("uses ALL when no filter is selected", () => {
    expect(buildExportFileName({}, now)).toBe("QuickVerse_Orders_ALL_ALL_2026-10-02.csv");
  });

  it("includes the custom date range", () => {
    const name = buildExportFileName(
      { timeRange: "CUSTOM", from: new Date(2026, 8, 1), to: new Date(2026, 8, 30) },
      now,
    );
    expect(name).toBe("QuickVerse_Orders_ALL_CUSTOM_2026-09-01_to_2026-09-30_2026-10-02.csv");
  });
});

describe("downloadOrdersCsv", () => {
  afterEach(() => vi.restoreAllMocks());

  it("downloads a CSV blob with the filter-based file name", async () => {
    let blob: Blob | undefined;
    const createSpy = vi.fn((b: Blob) => { blob = b; return "blob:test"; });
    const revokeSpy = vi.fn();
    Object.assign(URL, { createObjectURL: createSpy, revokeObjectURL: revokeSpy });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers();

    downloadOrdersCsv([makeOrder()], { status: "COMPLETED", timeRange: "TODAY" });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const clicked = clickSpy.mock.contexts[0] as HTMLAnchorElement | undefined;
    expect(clicked?.href).toBe("blob:test");
    expect(clicked?.download).toMatch(/^QuickVerse_Orders_COMPLETED_TODAY_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(clicked?.isConnected).toBe(false); // anchor removed again
    expect(blob?.type).toBe("text/csv;charset=utf-8");
    expect(await blob?.text()).toContain("ORD-1001");

    vi.advanceTimersByTime(1000);
    expect(revokeSpy).toHaveBeenCalledWith("blob:test");
    vi.useRealTimers();
  });
});
