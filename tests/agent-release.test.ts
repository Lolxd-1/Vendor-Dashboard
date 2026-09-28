import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The signed print-agent release every shop's updater.ps1 pulls from
// https://vendor-dashboard-quickverse.vercel.app/agent/ (public/agent here).
// Verified with Node's crypto - an independent implementation from the
// PowerShell that signs it and the PowerShell that checks it on a shop PC.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = (f: string) => path.join(repoRoot, "public/agent", f);
const src = (f: string) => path.join(repoRoot, "print-agent", f);
const lf = (b: Buffer) => b.toString("utf-8").replace(/\r\n/g, "\n");

const publicKeyOf = (updaterPath: string) => {
  const xml = /^\$PUBLIC_KEY_XML = '(<RSAKeyValue>.*<\/RSAKeyValue>)'/m.exec(readFileSync(updaterPath, "utf-8"))?.[1];
  if (!xml) throw new Error(`no public key in ${updaterPath}`);
  const n = /<Modulus>(.+)<\/Modulus>/.exec(xml)![1];
  const e = /<Exponent>(.+)<\/Exponent>/.exec(xml)![1];
  const b64url = (s: string) => Buffer.from(s, "base64").toString("base64url");
  return { xml, key: createPublicKey({ key: { kty: "RSA", n: b64url(n), e: b64url(e) }, format: "jwk" }) };
};
const versionOf = (text: string) => /^\$AGENT_VERSION = "([^"]+)"/m.exec(text)?.[1];

describe("signed agent release in public/agent", () => {
  const manifestBytes = readFileSync(pub("manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf-8")) as { version: string; files: Record<string, string> };

  it("manifest.sig verifies against the public key the shipped updater trusts", () => {
    const sig = Buffer.from(readFileSync(pub("manifest.sig"), "ascii").trim(), "base64");
    expect(verify("sha256", manifestBytes, publicKeyOf(src("updater.ps1")).key, sig)).toBe(true);
    // ...and one flipped byte does not.
    const tampered = Buffer.from(manifestBytes);
    tampered[20] ^= 1;
    expect(verify("sha256", tampered, publicKeyOf(src("updater.ps1")).key, sig)).toBe(false);
  });

  it("every published file matches its signed SHA-256; only agent.ps1 + updater.ps1", () => {
    expect(Object.keys(manifest.files).sort()).toEqual(["agent.ps1", "updater.ps1"]);
    for (const [name, sha] of Object.entries(manifest.files)) {
      expect(createHash("sha256").update(readFileSync(pub(name))).digest("hex"), name).toBe(sha);
    }
  });

  it("the published updater trusts the same key (an update can never lock shops out)", () => {
    expect(publicKeyOf(pub("updater.ps1")).xml).toBe(publicKeyOf(src("updater.ps1")).xml);
  });

  it("one version everywhere: manifest = published agent = dashboard's REQUIRED_AGENT_VERSION", () => {
    expect(versionOf(readFileSync(pub("agent.ps1"), "utf-8"))).toBe(manifest.version);
    const required = /REQUIRED_AGENT_VERSION = "([^"]+)"/.exec(readFileSync(path.join(repoRoot, "src/utils/print/printAgent.ts"), "utf-8"))?.[1];
    expect(required).toBe(manifest.version);
  });

  it("published files are the current print-agent sources (else run tools/agent-release/Publish-AgentRelease.ps1)", () => {
    for (const f of ["agent.ps1", "updater.ps1"]) {
      expect(lf(readFileSync(pub(f))) === lf(readFileSync(src(f))), `public/agent/${f} is stale - re-publish`).toBe(true);
    }
  });

  it("git stores public/agent byte-exact (no CRLF conversion that would break the hashes on Vercel)", () => {
    expect(readFileSync(path.join(repoRoot, ".gitattributes"), "utf-8")).toMatch(/^public\/agent\/\*\* -text$/m);
  });

  it("no private key material anywhere in the repo's agent/release files", () => {
    const dirs = ["public/agent", "print-agent", "tools/agent-release"].map((d) => path.join(repoRoot, d));
    for (const d of dirs) {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (!existsSync(p) || !/\.(ps1|json|sig|xml|vbs|bat)$/.test(f)) continue;
        expect(readFileSync(p, "utf-8"), p).not.toMatch(/<(P|Q|D|DP|DQ|InverseQ)>/);
      }
    }
  });
});

describe.skipIf(process.platform !== "win32")("updater end to end (real processes, isolated ports)", () => {
  it(
    "Test-Updater.ps1 passes",
    () => {
      let status = 0;
      let output = "";
      try {
        output = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "print-agent/tests/Test-Updater.ps1")], { encoding: "utf-8" });
      } catch (err) {
        const failure = err as { status?: number | null; stdout?: string; message: string };
        status = failure.status ?? 1;
        output = failure.stdout ?? failure.message;
      }
      expect(status, output).toBe(0);
    },
    // Boots real agents, waits out a real rollback (~90s locally).
    300_000
  );
});
