import { describe, it, expect } from "vitest";
import { COLS, line, center, row } from "../receiptFormat";

describe("receiptFormat", () => {
  it("COLS is 36", () => {
    expect(COLS).toBe(36);
  });

  it("line() returns 36 dashes by default", () => {
    expect(line()).toBe("-".repeat(36));
    expect(line()).toHaveLength(36);
  });

  it("line(ch) repeats the given character 36 times", () => {
    expect(line("=")).toBe("=".repeat(36));
  });

  it("center() left-pads short text based on remaining width", () => {
    const result = center("AB");
    expect(result).toBe(" ".repeat(17) + "AB");
    expect(result).toHaveLength(19);
  });

  it("center() truncates text longer than COLS instead of throwing", () => {
    const longText = "X".repeat(50);
    expect(() => center(longText)).not.toThrow();
    const result = center(longText);
    expect(result).toBe(longText.slice(0, 36));
    expect(result).toHaveLength(36);
  });

  it("row() pads left+right to exactly COLS characters", () => {
    const result = row("a", "b");
    expect(result).toHaveLength(36);
    expect(result).toBe("a" + " ".repeat(34) + "b");
  });

  it("row() truncates to COLS instead of overflowing when left+right exceed COLS", () => {
    const left = "a".repeat(30);
    const right = "b".repeat(30);
    const result = row(left, right);
    expect(result).toHaveLength(36);
    expect(result).toBe((left + " " + right).slice(0, 36));
  });
});
