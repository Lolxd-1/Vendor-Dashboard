import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// T14: useDashboardStore() / useAuthStore() called with NO selector subscribes to the ENTIRE
// store, so every field change re-renders every one of those consumers. Every call must select
// only the slice(s) it needs, e.g. `useDashboardStore((s) => s.acceptedOrders)`.
const NO_SELECTOR_CALL = /\b(useDashboardStore|useAuthStore)\(\s*\)/;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("no whole-store zustand subscription remains in src/ (T14 TC1)", () => {
  const sourceFiles = collectSourceFiles(srcRoot);

  it("sanity check: the walk found source files, so the assertion below isn't vacuous", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it("no file calls useDashboardStore() or useAuthStore() with zero arguments", () => {
    const offenders = sourceFiles
      .filter((file) => NO_SELECTOR_CALL.test(readFileSync(file, "utf-8")))
      .map((file) => path.relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });
});
