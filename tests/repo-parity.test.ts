import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// print-agent/ and files/ are intentionally duplicated into the sibling QuickVerse-Dashboard repo
// (vendors download from there; this repo builds the dashboard) - see T11. Restructuring into a
// single source of truth was declined, so this test exists to make drift between the two copies
// loud instead of silent.
const SHARED_PATHS = [
  "print-agent/agent.ps1",
  "print-agent/package.json",
  "print-agent/start-agent.bat",
  "print-agent/start-agent.vbs",
  "print-agent/tests/Test-Agent.ps1",
  "files/Install-QuickVerse.ps1",
  "files/Install-VendorDashboard.ps1",
  "files/tests/Test-Installer.ps1",
  "Start-Setup.bat",
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveSecondRepo(fromRoot: string): string | null {
  const candidate = path.resolve(fromRoot, "../QuickVerse-Dashboard");
  return existsSync(candidate) ? candidate : null;
}

const secondRepoPath = resolveSecondRepo(repoRoot);

// Strip a leading UTF-8 BOM and normalise CRLF to LF so the two repos' encodings/line endings
// never register as drift on their own - only real content changes should.
function normalize(content: string): string {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return withoutBom.replace(/\r\n/g, "\n");
}

interface CompareResult {
  equal: boolean;
  firstDiffLine?: number;
}

function compareNormalized(a: string, b: string): CompareResult {
  const linesA = normalize(a).split("\n");
  const linesB = normalize(b).split("\n");
  const max = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < max; i++) {
    if (linesA[i] !== linesB[i]) {
      return { equal: false, firstDiffLine: i + 1 };
    }
  }
  return { equal: true };
}

function compareFiles(pathA: string, pathB: string): CompareResult {
  return compareNormalized(readFileSync(pathA, "utf-8"), readFileSync(pathB, "utf-8"));
}

if (!secondRepoPath) {
  console.warn(
    `repo-parity: sibling repo not found at ${path.resolve(repoRoot, "../QuickVerse-Dashboard")} - skipping parity checks (this checkout only has one repo).`
  );
}

describe("repo parity: print-agent/ and files/ vs ../QuickVerse-Dashboard (T11)", () => {
  describe.skipIf(!secondRepoPath)("parity checks (sibling repo present)", () => {
    it.each(SHARED_PATHS)("TC1: %s is identical (modulo BOM/CRLF) in both repos", (relPath) => {
      const result = compareFiles(
        path.join(repoRoot, relPath),
        path.join(secondRepoPath as string, relPath)
      );
      expect(result.equal, `${relPath} differs at line ${result.firstDiffLine}`).toBe(true);
    });

    it(
      "TC5: Test-Agent.ps1 passes when run inside the second repo",
      () => {
        const testScript = path.join(secondRepoPath as string, "print-agent/tests/Test-Agent.ps1");
        let status = 0;
        let output: string;
        try {
          output = execFileSync(
            "powershell.exe",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", testScript],
            { encoding: "utf-8" }
          );
        } catch (err) {
          const failure = err as { status?: number | null; stdout?: string; message: string };
          status = failure.status ?? 1;
          output = failure.stdout ?? failure.message;
        }
        expect(status, output).toBe(0);
      },
      // Test-Agent.ps1 boots real agent processes and rides out real mutex/timeout windows
      // (~40s locally) - give it headroom on slower machines.
      120_000
    );
  });

  it("TC2: the comparison function detects drift (temp copy only, neither repo touched)", () => {
    const sourcePath = path.join(repoRoot, "print-agent/agent.ps1");
    const dir = mkdtempSync(path.join(tmpdir(), "repo-parity-"));
    try {
      const driftedPath = path.join(dir, "agent.ps1");
      copyFileSync(sourcePath, driftedPath);
      appendFileSync(driftedPath, "# drifted line for TC2\r\n");

      const result = compareFiles(sourcePath, driftedPath);

      expect(result.equal).toBe(false);
      expect(result.firstDiffLine).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC3: the resolver skips cleanly when pointed at a non-existent sibling", () => {
    const bogusRoot = path.join(repoRoot, "no-such-dir-for-T11-test");
    expect(existsSync(bogusRoot)).toBe(false);
    expect(resolveSecondRepo(bogusRoot)).toBeNull();
  });

  it("TC4: normalisation ignores CRLF-vs-LF and a leading BOM", () => {
    const lf = "line one\nline two\n";
    const crlf = "line one\r\nline two\r\n";
    expect(compareNormalized(lf, crlf).equal).toBe(true);

    const withBom = "﻿line one\nline two\n";
    expect(compareNormalized(withBom, lf).equal).toBe(true);
  });
});
