import { describe, expect, it } from "vitest";
import { dayLabel, deltaPct, hourLabel, inr, monthLabel, pctText, rangeLabel, rs, ymd } from "../format";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("money and percent formatting (TC8)", () => {
  it("inr uses Indian grouping and drops trailing zeros", () => {
    expect(inr(123456.5)).toBe("₹1,23,456.5");
    expect(inr(0)).toBe("₹0");
    expect(inr(1234.567)).toBe("₹1,234.57");
    expect(inr(-50)).toBe("-₹50");
  });

  it("rs always shows two decimals for the PDF", () => {
    expect(rs(1234)).toBe("Rs 1,234.00");
    expect(rs(8.9)).toBe("Rs 8.90");
  });

  it("pctText shows at most one decimal", () => {
    expect(pctText(0.1234)).toBe("12.3%");
    expect(pctText(0.5)).toBe("50%");
    expect(pctText(0)).toBe("0%");
  });

  it("deltaPct is null when there is nothing to compare with", () => {
    expect(deltaPct(120, 100)).toBeCloseTo(0.2);
    expect(deltaPct(80, 100)).toBeCloseTo(-0.2);
    expect(deltaPct(5, 0)).toBeNull();
  });
});

describe("date labels (TC9)", () => {
  it("dayLabel, monthLabel, ymd", () => {
    expect(dayLabel(at(2026, 10, 5))).toBe("Mon 5 Oct");
    expect(monthLabel(at(2026, 10, 5))).toBe("Oct 2026");
    expect(ymd(at(2026, 10, 5))).toBe("2026-10-05");
  });

  it("rangeLabel shows the last day inclusive", () => {
    expect(rangeLabel({ start: at(2026, 10, 5), end: at(2026, 10, 12) })).toBe("Mon 5 Oct – Sun 11 Oct 2026");
    expect(rangeLabel({ start: at(2026, 10, 8), end: at(2026, 10, 9) })).toBe("Thu 8 Oct 2026");
    expect(rangeLabel({ start: at(2026, 12, 28), end: at(2027, 1, 4) })).toBe("Mon 28 Dec 2026 – Sun 3 Jan 2027");
  });

  it("hourLabel uses a 12-hour clock", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(13)).toBe("1 PM");
    expect(hourLabel(23)).toBe("11 PM");
  });
});
