import { describe, it, expect } from "vitest";
import { COLS, line, center, row } from "../receiptFormat";

describe("receiptFormat", () => {
  it("COLS is 42", () => {
    expect(COLS).toBe(42);
  });

  it("line() returns 42 dashes by default", () => {
    expect(line()).toBe("-".repeat(42));
    expect(line()).toHaveLength(42);
  });

  it("line(ch) repeats the given character 42 times", () => {
    expect(line("=")).toBe("=".repeat(42));
  });

  it("center() left-pads short text based on remaining width", () => {
    const result = center("AB");
    expect(result).toBe(" ".repeat(20) + "AB");
    expect(result).toHaveLength(22);
  });

  it("center() truncates text longer than COLS instead of throwing", () => {
    const longText = "X".repeat(50);
    expect(() => center(longText)).not.toThrow();
    const result = center(longText);
    expect(result).toBe(longText.slice(0, 42));
    expect(result).toHaveLength(42);
  });

  it("row() pads left+right to exactly COLS characters", () => {
    const result = row("a", "b");
    expect(result).toHaveLength(42);
    expect(result).toBe("a" + " ".repeat(40) + "b");
  });

  it("row() truncates to COLS instead of overflowing when left+right exceed COLS", () => {
    const left = "a".repeat(30);
    const right = "b".repeat(30);
    const result = row(left, right);
    expect(result).toHaveLength(42);
    expect(result).toBe((left + " " + right).slice(0, 42));
  });
});
