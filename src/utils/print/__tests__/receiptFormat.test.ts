import { describe, it, expect } from "vitest";
import { line, center, row, wrap, money, formatDateTime } from "../receiptFormat";

describe("receiptFormat", () => {
  // TC1
  it("line() returns exactly 42 dashes by default", () => {
    expect(line()).toBe("-".repeat(42));
    expect(line()).toHaveLength(42);
  });

  it("line(ch) repeats the given character 42 times", () => {
    expect(line("=")).toBe("=".repeat(42));
    expect(line("=")).toHaveLength(42);
  });

  // TC2
  it("center() centres short text within 42 columns", () => {
    const result = center("Bill");
    expect(result).toBe(" ".repeat(19) + "Bill");
    expect(result).toHaveLength(23);
  });

  it("center() with a 60-char string returns exactly 42 chars and does not throw", () => {
    const longText = "X".repeat(60);
    expect(() => center(longText)).not.toThrow();
    const result = center(longText);
    expect(result).toHaveLength(42);
    expect(result).toBe("X".repeat(42));
  });

  // TC3
  it('row("a","b") is exactly 42 chars', () => {
    const result = row("a", "b");
    expect(result).toHaveLength(42);
    expect(result).toBe("a" + " ".repeat(40) + "b");
  });

  it("row() truncates to exactly 42 chars when left+right exceed 42", () => {
    const left = "a".repeat(25);
    const right = "b".repeat(25);
    const result = row(left, right);
    expect(result).toHaveLength(42);
    expect(result).toBe((left + " " + right).slice(0, 42));
  });

  // TC4
  it("wrap() splits on spaces with no line exceeding the given width", () => {
    const result = wrap("alpha beta gamma", 10);
    expect(result).toEqual(["alpha beta", "gamma"]);
    result.forEach((l) => expect(l.length).toBeLessThanOrEqual(10));
  });

  // TC5 (edge) - documents current behaviour only; wrap() is out of scope to change.
  it("wrap() with width 0 terminates and returns an array instead of hanging", () => {
    const result = wrap("anything", 0);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(["anything"]);
  });

  it("wrap() with a negative width terminates and returns an array instead of hanging", () => {
    const result = wrap("anything", -5);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(["anything"]);
  });

  // TC6
  it('wrap("", 10) returns an array with a single empty string', () => {
    expect(wrap("", 10)).toEqual([""]);
  });

  // TC7
  it('money() returns "--" for undefined, null, and NaN', () => {
    expect(money(undefined)).toBe("--");
    expect(money(null)).toBe("--");
    expect(money(NaN)).toBe("--");
  });

  it("money() formats a number to 2 decimal places", () => {
    expect(money(12.5)).toBe("12.50");
  });

  // TC8
  it("formatDateTime(undefined) returns a string and does not throw", () => {
    expect(() => formatDateTime(undefined)).not.toThrow();
    expect(typeof formatDateTime(undefined)).toBe("string");
  });

  it('formatDateTime("garbage") returns the input unchanged', () => {
    expect(formatDateTime("garbage")).toBe("garbage");
  });
});
