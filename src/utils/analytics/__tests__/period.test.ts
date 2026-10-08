import { describe, expect, it } from "vitest";
import {
  addDays,
  inRange,
  parseOrderTime,
  payoutDateOf,
  presetRange,
  previousRange,
  settlementWeekOf,
  weekdayIndex,
} from "../period";

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms);

describe("settlement week (Mon 00:00 → next Mon 00:00, paid the Monday after)", () => {
  it("TC1: a Thursday belongs to the Monday-start week and is paid next Monday", () => {
    const week = settlementWeekOf(at(2026, 10, 8, 15));
    expect(week.start).toEqual(at(2026, 10, 5));
    expect(week.end).toEqual(at(2026, 10, 12));
    expect(payoutDateOf(week)).toEqual(at(2026, 10, 12));
  });

  it("TC2: Sunday 23:59:59 is still in the week; Monday 00:00 starts the next one", () => {
    expect(settlementWeekOf(at(2026, 10, 11, 23, 59, 59, 999)).start).toEqual(at(2026, 10, 5));
    expect(settlementWeekOf(at(2026, 10, 12)).start).toEqual(at(2026, 10, 12));
    expect(settlementWeekOf(at(2026, 10, 5)).start).toEqual(at(2026, 10, 5));
  });

  it("weekdayIndex counts Monday as 0 and Sunday as 6", () => {
    expect(weekdayIndex(at(2026, 10, 5))).toBe(0);
    expect(weekdayIndex(at(2026, 10, 11))).toBe(6);
  });

  it("a week spanning two years works", () => {
    const week = settlementWeekOf(at(2027, 1, 1, 10)); // Friday
    expect(week.start).toEqual(at(2026, 12, 28));
    expect(week.end).toEqual(at(2027, 1, 4));
  });
});

describe("presetRange (TC3)", () => {
  const now = at(2026, 10, 8, 15, 30);

  it("TODAY and YESTERDAY are whole calendar days", () => {
    expect(presetRange("TODAY", now)).toEqual({ start: at(2026, 10, 8), end: at(2026, 10, 9) });
    expect(presetRange("YESTERDAY", now)).toEqual({ start: at(2026, 10, 7), end: at(2026, 10, 8) });
  });

  it("LAST_30_DAYS is 30 days including today", () => {
    expect(presetRange("LAST_30_DAYS", now)).toEqual({ start: at(2026, 9, 9), end: at(2026, 10, 9) });
  });

  it("THIS_MONTH, LAST_MONTH, THIS_YEAR are calendar-aligned", () => {
    expect(presetRange("THIS_MONTH", now)).toEqual({ start: at(2026, 10, 1), end: at(2026, 11, 1) });
    expect(presetRange("LAST_MONTH", now)).toEqual({ start: at(2026, 9, 1), end: at(2026, 10, 1) });
    expect(presetRange("THIS_YEAR", now)).toEqual({ start: at(2026, 1, 1), end: at(2027, 1, 1) });
  });

  it("LAST_MONTH in January is the previous December", () => {
    expect(presetRange("LAST_MONTH", at(2027, 1, 15))).toEqual({ start: at(2026, 12, 1), end: at(2027, 1, 1) });
  });
});

describe("previousRange (TC4)", () => {
  const now = at(2026, 10, 8, 15);

  it("a running week compares with the same days of last week", () => {
    const week = settlementWeekOf(now);
    expect(previousRange(week, now)).toEqual({ start: at(2026, 9, 28), end: at(2026, 10, 1, 15) });
  });

  it("a finished week compares with the whole week before", () => {
    const week = settlementWeekOf(at(2026, 9, 30));
    expect(previousRange(week, now)).toEqual({ start: at(2026, 9, 21), end: at(2026, 9, 28) });
  });

  it("a running month compares with the same days of last month", () => {
    expect(previousRange(presetRange("THIS_MONTH", now), now)).toEqual({ start: at(2026, 9, 1), end: at(2026, 9, 8, 15) });
  });

  it("a finished custom range compares with the same number of days just before it", () => {
    const r = { start: at(2026, 9, 10), end: at(2026, 9, 13) };
    expect(previousRange(r, now)).toEqual({ start: at(2026, 9, 7), end: at(2026, 9, 10) });
  });

  it("never overlaps the current range (31st → 1st month shift)", () => {
    const oct = presetRange("THIS_MONTH", now);
    const prev = previousRange(oct, at(2026, 10, 31, 12));
    expect(prev.start).toEqual(at(2026, 9, 1));
    expect(prev.end.getTime()).toBeLessThanOrEqual(oct.start.getTime());
  });
});

describe("parseOrderTime (TC5)", () => {
  it("reads the backend format as local time", () => {
    expect(parseOrderTime("2026-09-20 18:01:57.678")).toEqual(at(2026, 9, 20, 18, 1, 57, 678));
    expect(parseOrderTime("2026-09-20T08:15:02")).toEqual(at(2026, 9, 20, 8, 15, 2));
  });

  it("returns null for empty or unreadable values", () => {
    expect(parseOrderTime("")).toBeNull();
    expect(parseOrderTime(null)).toBeNull();
    expect(parseOrderTime(undefined)).toBeNull();
    expect(parseOrderTime("garbage")).toBeNull();
  });
});

describe("inRange and addDays", () => {
  it("is half-open: start included, end excluded", () => {
    const r = { start: at(2026, 10, 5), end: at(2026, 10, 12) };
    expect(inRange(at(2026, 10, 5), r)).toBe(true);
    expect(inRange(at(2026, 10, 11, 23, 59, 59, 999), r)).toBe(true);
    expect(inRange(at(2026, 10, 12), r)).toBe(false);
    expect(inRange(at(2026, 10, 4, 23, 59), r)).toBe(false);
  });

  it("addDays moves calendar days across month ends", () => {
    expect(addDays(at(2026, 10, 30), 3)).toEqual(at(2026, 11, 2));
    expect(addDays(at(2026, 3, 1), -1)).toEqual(at(2026, 2, 28));
  });
});
