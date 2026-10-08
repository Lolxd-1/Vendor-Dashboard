import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_COMMISSION_PCT,
  commissionOf,
  isValidCommissionPct,
  loadCommissionPct,
  round2,
  saveCommissionPct,
} from "../commission";

beforeEach(() => localStorage.clear());

describe("commission math (TC6)", () => {
  it("takes the percentage of the gross, rounded to paise", () => {
    expect(commissionOf(110, 10)).toBe(11);
    expect(commissionOf(89.1, 10)).toBe(8.91);
    expect(commissionOf(45.55, 5)).toBe(2.28);
    expect(commissionOf(0, 10)).toBe(0);
  });

  it("round2 rounds half up the way a person expects", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(10)).toBe(10);
  });
});

describe("commission setting per shop (TC7)", () => {
  it("defaults to 10% when nothing is stored", () => {
    expect(DEFAULT_COMMISSION_PCT).toBe(10);
    expect(loadCommissionPct("SHOP1")).toBe(10);
  });

  it("remembers a saved value for that shop only", () => {
    expect(saveCommissionPct("SHOP1", 5)).toBe(true);
    expect(loadCommissionPct("SHOP1")).toBe(5);
    expect(loadCommissionPct("SHOP2")).toBe(10);
    expect(localStorage.getItem("qv_commission_pct:SHOP1")).toBe("5");
  });

  it("falls back to 10% for a corrupt stored value", () => {
    for (const bad of ["abc", "", "  ", "150", "-3"]) {
      localStorage.setItem("qv_commission_pct:SHOP1", bad);
      expect(loadCommissionPct("SHOP1")).toBe(10);
    }
  });

  it("rejects invalid input and leaves the stored value unchanged", () => {
    saveCommissionPct("SHOP1", 7.5);
    for (const bad of [-1, 101, NaN, Infinity]) {
      expect(saveCommissionPct("SHOP1", bad)).toBe(false);
    }
    expect(loadCommissionPct("SHOP1")).toBe(7.5);
  });

  it("validates the 0–100 range inclusive", () => {
    expect(isValidCommissionPct(0)).toBe(true);
    expect(isValidCommissionPct(100)).toBe(true);
    expect(isValidCommissionPct(100.01)).toBe(false);
  });
});
