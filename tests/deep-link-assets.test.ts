import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

// A refresh or deep link on /vendor/dashboard resolves "./assets/x.js" to
// /vendor/assets/x.js; Vercel's SPA rewrite answers that with index.html, the
// browser refuses HTML as a module, and the kiosk shows a blank dashboard
// with no orders and no ring.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("deep links load the app's assets", () => {
  it("TC-DL1: vite builds with an absolute base", () => {
    const config = typeof viteConfig === "function" ? viteConfig({ command: "build", mode: "production" }) : viteConfig;
    expect((config as { base?: string }).base).toBe("/");
  });

  it("TC-DL2: index.html references no relative asset paths", () => {
    const html = readFileSync(path.join(repoRoot, "index.html"), "utf-8");
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    // Only root-absolute ("/x") or full URLs resolve the same on every route.
    expect(refs.filter((r) => !r.startsWith("/") && !r.includes("://"))).toEqual([]);
  });
});
