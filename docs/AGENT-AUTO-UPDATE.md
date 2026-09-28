# Print Agent Auto-Update & Release Signing — Runbook

Applies to: print agent **v1.4.0+**, dashboard branches **prod-v1.3** / **prod-v1.1** (repo `Lolxd-1/Vendor-Dashboard`),
installer branch **v1.4.0** (repo `Lolxd-1/QuickVerse-Dashboard`).

This document is written so that an AI agent (or a human) can release, verify, troubleshoot and recover the
print-agent auto-update system **without guessing**. Read section 0 before changing anything.

---

## 0. Rules for an AI agent (read first)

MUST:
1. After ANY change to `print-agent/agent.ps1` or `print-agent/updater.ps1`, bump `$AGENT_VERSION` in
   `print-agent/agent.ps1` **and** `REQUIRED_AGENT_VERSION` in `src/utils/print/printAgent.ts` to the same value,
   then run `tools/agent-release/Publish-AgentRelease.ps1`, then `npm test`. (Tests fail if you forget.)
2. Keep `print-agent/*` shipped files identical in both repos (`tests/repo-parity.test.ts` enforces it).
3. Make sure the branch Vercel deploys to **production** contains `public/agent/`. Shops download from the live site.
4. Keep dashboard slip text printable by the *previous* agent too: the dashboard goes live instantly, agents update
   up to ~12 hours later.
5. After a push, run the live check in section 6.2.

NEVER:
1. Never print, log, paste, commit, or upload the **private key** (`agent-signing-key.xml`, contains `<D>`, `<P>`, `<Q>` …)
   anywhere except the private backup repo in section 4. Tests fail if key material appears in the repo.
2. Never make `github.com/Lolxd-1/signinkey` public.
3. Never hand-edit files in `public/agent/` — they are generated and signed.
4. Never remove `public/agent/** -text` from `.gitattributes` (git would rewrite line endings → hashes break → every
   shop rejects the release).
5. Never change `$PUBLIC_KEY_XML` in `updater.ps1` except through the key procedures in section 9.
6. Never use `Invoke-Expression`/in-memory execution of downloaded code, and never add antivirus exclusions.

---

## 1. What this system does

Every shop PC runs the print agent (`C:\QuickVerse\print-agent\agent.ps1`, HTTP on `127.0.0.1:1818`).
Twice a day the updater checks `https://vendor-dashboard-quickverse.vercel.app/agent/` for a newer agent and installs it
**only if it is signed with the QuickVerse release key**. On any problem it keeps (or restores) the agent that was
already printing. Result: fix a bug here → push → every shop is fixed at its next check, nobody touches the PCs.

```
 Your laptop                               Vercel (prod branch)                 Shop PC (x N)
 ───────────                               ────────────────────                 ─────────────
 edit print-agent/agent.ps1                /agent/manifest.json   ◄── GET ──  updater.ps1 (08:00 + 23:30,
 bump version                              /agent/manifest.sig                 or at boot if the PC was off)
 Publish-AgentRelease.ps1 ── signs ──►     /agent/agent.ps1                     1 verify signature (public key)
   (private key)            public/agent/  /agent/updater.ps1                   2 verify SHA-256 + parse
 git push ────────────────────────────────►                                     3 backup, swap, restart agent
                                                                                4 healthy? else ROLLBACK
```

---

## 2. Components and files

### Repo `Vendor-Dashboard` (this repo — source of truth)
| Path | Role |
|---|---|
| `print-agent/agent.ps1` | The print agent. `$AGENT_VERSION = "x.y.z"` on its own line is the release version. |
| `print-agent/updater.ps1` | The updater that runs on shop PCs. Embeds the release **public** key in `$PUBLIC_KEY_XML`. |
| `print-agent/update-agent.vbs` | Hidden launcher the scheduled task runs (no console window). |
| `print-agent/tests/Test-Updater.ps1` | End-to-end updater test (real processes; see section 11). |
| `tools/agent-release/New-AgentSigningKey.ps1` | ONE-TIME key creation. Refuses to overwrite an existing key. |
| `tools/agent-release/Publish-AgentRelease.ps1` | Builds + signs `public/agent/`. |
| `public/agent/{agent.ps1,updater.ps1,manifest.json,manifest.sig}` | The published, signed release (generated). Served at `/agent/`. |
| `.gitattributes` | `public/agent/** -text` — git stores these bytes exactly. |
| `tests/agent-release.test.ts` | Verifies the release with Node crypto + runs `Test-Updater.ps1`. |
| `files/Install-QuickVerse.ps1` | Shop installer (also in the other repo). |
| `src/utils/print/printAgent.ts` | `REQUIRED_AGENT_VERSION` — dashboard warns if a shop's agent differs. |

### Repo `QuickVerse-Dashboard` (what shops download for a fresh install)
Mirrors `print-agent/{agent.ps1,updater.ps1,update-agent.vbs,start-agent.bat,start-agent.vbs}`,
`files/Install-QuickVerse.ps1`, `files/tests/Test-Installer.ps1`, `Start-Setup.bat`. Branch per agent version (`v1.4.0`, …).
It may lag: a fresh install self-updates at the installer's first check.

### On a shop PC (`C:\QuickVerse\print-agent\`)
| File / task | Meaning |
|---|---|
| `agent.ps1`, `updater.ps1`, `update-agent.vbs`, `start-agent.vbs/.bat` | Installed files. |
| `update.log` | One line per check/update/rollback (trimmed at 256 KB). **First place to look.** |
| `previous\agent.ps1`, `previous\updater.ps1` | Files before the last update (manual recovery). |
| `update-failed.txt` | A version that failed its health check here; it is skipped until a newer release. |
| `update-staging\` | Temporary download folder; deleted after every run. |
| Task **"QuickVerse Agent Updater"** | `wscript.exe update-agent.vbs`, daily 08:00 + 23:30, `StartWhenAvailable`, 10-min limit. |
| Task **"QuickVerse Print Agent"** | Starts the agent at logon. **Only created when the installer runs as Administrator.** Without it the Startup-folder shortcut (`start-agent.vbs`) starts the agent — the updater handles both. |

---

## 3. What happens on a shop PC during a check (`updater.ps1`)

1. Single-instance lock (`Local\QuickVerseAgentUpdater<port>`). Another run in progress → exit 2.
2. Refuses non-https update URLs (exit 6). Forces TLS 1.2 on.
3. Reads installed version from `agent.ps1` (`$AGENT_VERSION`).
4. Downloads `manifest.json` + `manifest.sig` (cache-busting `?t=`). Network error → exit 5.
   If the body is not JSON (Vercel returns the dashboard HTML for a missing file) → "no release published", exit 5.
5. Verifies `manifest.sig` = RSA PKCS#1 v1.5 / SHA-256 signature over the **exact bytes** of `manifest.json`,
   with `$PUBLIC_KEY_XML`. Mismatch → exit 3, nothing downloaded or changed.
6. Manifest must list `agent.ps1` and only files from `{agent.ps1, updater.ps1}` (no paths) → else exit 3.
7. Published version ≤ installed → "up to date", exit 0. Version listed in `update-failed.txt` → skipped, exit 0.
8. Downloads each file, checks SHA-256 against the manifest, checks it parses as PowerShell, checks the downloaded
   `agent.ps1` declares the manifest version. Any failure → exit 3, nothing changed.
9. Backs up current files to `previous\`. Calls `/status` once (the agent is single-threaded, so an in-flight print
   finishes first), stops the agent (`Stop-ScheduledTask` + stops `powershell.exe` running this folder's `agent.ps1`
   by full path, or by relative path from `start-agent.vbs`). Can't stop it → exit 5, nothing swapped.
10. Copies the new `agent.ps1`, starts the agent (`Start-ScheduledTask`; fallback: hidden `powershell -File agent.ps1`).
11. Waits up to 30 s for `/status` to report the new version:
    - healthy → replaces `updater.ps1` (if in the manifest), clears `update-failed.txt`, "UPDATED to vX", exit 0;
    - not healthy → restores `previous\agent.ps1`, writes the version to `update-failed.txt`, restarts, "ROLLED BACK", exit 4.

Printing is unavailable for ~6 s during a swap. A print in that window gets "helper unreachable" and the dashboard opens
its browser-print fallback. That is why checks run at 08:00 and 23:30.

**Exit codes:** 0 ok / up to date / updated · 2 busy · 3 rejected · 4 rolled back · 5 network/other failure · 6 config refused.

---

## 4. The keys

| | Where | Who needs it |
|---|---|---|
| **Private key** (3072-bit RSA, .NET XML) | `C:\Users\omkar\.quickverse\agent-signing-key.xml` on the release laptop. **Backup:** private repo `https://github.com/Lolxd-1/signinkey` → `agent-signing-key.xml`. Keep one more offline copy (USB / password manager). | Only `Publish-AgentRelease.ps1`. |
| **Public key** | `$PUBLIC_KEY_XML` in `print-agent/updater.ps1` (and every installed `updater.ps1`). | Every shop PC, to verify. Safe to publish. |

Security model: to push a malicious update an attacker needs **both** the private key **and** the ability to publish
files on the Vercel production site. The private key backup and the deploy both live under the same GitHub account,
so that account **must** have 2-factor authentication.

Restoring the key on a new/reinstalled laptop:
```powershell
git clone https://github.com/Lolxd-1/signinkey.git $env:TEMP\signinkey
New-Item -ItemType Directory "$env:USERPROFILE\.quickverse" -Force | Out-Null
Copy-Item $env:TEMP\signinkey\agent-signing-key.xml "$env:USERPROFILE\.quickverse\agent-signing-key.xml"
Remove-Item $env:TEMP\signinkey -Recurse -Force
# Proof it is the right key: this refuses to run if updater.ps1's public key does not match it.
powershell -ExecutionPolicy Bypass -File tools\agent-release\Publish-AgentRelease.ps1
```

---

## 5. Releasing a new agent version (exact steps)

```powershell
# 1. Change print-agent/agent.ps1 (and/or print-agent/updater.ps1).
# 2. Bump the version in BOTH places (same value, must be higher than the live one):
#      print-agent/agent.ps1         $AGENT_VERSION = "1.4.1"
#      src/utils/print/printAgent.ts REQUIRED_AGENT_VERSION = "1.4.1"
#    Also update the version labels: print-agent/start-agent.bat, Start-Setup.bat,
#    files/Install-QuickVerse.ps1 ($ExpectedAgentVersion + header comments).
# 3. Sign + publish into public/agent/:
powershell -ExecutionPolicy Bypass -File tools\agent-release\Publish-AgentRelease.ps1
# 4. Test (includes the ~90 s end-to-end updater test on Windows):
npm test
powershell -ExecutionPolicy Bypass -File files\tests\Test-Installer.ps1
# 5. Commit everything including public/agent/, push to the Vercel production branch (and prod-v1.3 line).
# 6. Mirror shipped files to ../QuickVerse-Dashboard (new branch vX.Y.Z), push.
# 7. Live check (section 6.2).
```
Versions compare as `[System.Version]` (`1.4.10` > `1.4.9`). Never reuse or lower a version.

---

## 6. Verifying a release

### 6.1 Locally (before push)
`npm test` → `tests/agent-release.test.ts` checks: signature valid (Node crypto), hashes match, only allowed files,
published updater trusts the same key, one version everywhere, `public/agent` not stale, `.gitattributes` rule present,
no private-key material in the repo, and runs `Test-Updater.ps1`.

### 6.2 Live (after Vercel deploys)
```powershell
# From the repo root. Verifies the LIVE release exactly like a shop would. Changes nothing.
powershell -ExecutionPolicy Bypass -File print-agent\updater.ps1 -CheckOnly
# Expect: "CHECK OK: v1.4.x published and verified (signature + 2 file hashes)"
```
On a shop PC: `powershell -ExecutionPolicy Bypass -File C:\QuickVerse\print-agent\updater.ps1 -CheckOnly`
Force an update right now on a shop PC: run the same without `-CheckOnly`, or `Start-ScheduledTask "QuickVerse Agent Updater"`.

---

## 7. Installing at a shop

1. Download the `QuickVerse-Dashboard` branch zip for the current version, extract.
2. Right-click `Start-Setup.bat` → **Run as administrator** (needed for the at-logon agent task; without admin it still
   works through the Startup shortcut).
3. The installer: stops any running agent → copies files → registers both tasks → starts the agent → runs the first
   update check. Expect `up to date (installed v1.4.x, published v1.4.x)` or `UPDATED to v…`.
4. Check `http://127.0.0.1:1818/status` shows the version, and Task Scheduler shows "QuickVerse Agent Updater" (next run 08:00).

---

## 8. Troubleshooting (`C:\QuickVerse\print-agent\update.log`)

| Log line | Meaning | Action |
|---|---|---|
| `up to date (installed vX, published vX)` | Normal. | None. |
| `UPDATED to vX - agent healthy` | Normal update. | None. |
| `check failed (network): …` | PC offline / firewall / proxy blocks Vercel. Old agent keeps printing. | Fix internet; next check retries. |
| `no release published at … (got a web page…)` | `/agent/manifest.json` missing on the live site (wrong Vercel production branch, or not deployed). | Ensure the production branch contains `public/agent/`; redeploy. |
| `REJECTED: manifest signature does not match…` | Published release not signed by the key this PC trusts, or tampered. | Re-publish with the correct key. If you did not publish: **treat as an attack**, see 9.3. |
| `REJECTED: <file> does not match its signed SHA-256` | File changed after signing (hand edit, or line endings rewritten by git). | Re-run Publish; confirm `.gitattributes`. |
| `REJECTED: … does not parse` / `version does not match` | Broken release. | Fix, bump version, publish. |
| `ROLLED BACK - vOld is printing again` | New version did not start within 30 s. That version is now skipped on this PC. | Fix the agent, publish a **higher** version. |
| `ROLLBACK: restored … but it did not answer` | Neither version starts — PC-level problem. | Visit/remote in; run `start-agent.bat` to see the error. |
| `could not stop the running agent - update postponed` | Agent stuck. | Next check retries; reboot the PC if it repeats. |
| `REFUSED: …` | Misconfigured updater (http URL or no key). | Reinstall from the current installer branch. |

---

## 9. Emergencies

### 9.1 A bad release is live (kill switch)
Shops that fail the health check roll back automatically. For a release that *starts* but misbehaves:
republish the last good code with a **higher** version number (e.g. v1.4.0 code as v1.4.2) → shops move to it at the
next check. Never lower the version — the updater ignores lower versions.

### 9.2 The private key is LOST (laptop dead, no copy)
1. First restore it from `github.com/Lolxd-1/signinkey` (section 4). If that works, nothing else to do.
2. If every copy is gone: **nothing breaks** — every shop keeps printing with its current agent, and the updater keeps
   rejecting anything you publish (they can no longer be updated remotely). To recover:
   - `tools\agent-release\New-AgentSigningKey.ps1` (creates a new key, writes the new public key into `updater.ps1`;
     it refuses to run while an old key file exists — move the old file away first if present);
   - bump the version, Publish, test, push;
   - **re-run the installer once at every shop** (they need the new `updater.ps1` with the new public key);
   - push the new key to the private `signinkey` repo (replace the file) + a new offline copy.

### 9.3 The private key LEAKED (or the `signinkey` repo was exposed)
Same as 9.2 (new key, publish, reinstall at every shop) — but do it immediately, and also: rotate the GitHub password,
confirm 2FA, review recent pushes to the Vercel production branch and Vercel deployment history for anything you did
not publish. Until shops are reinstalled, the old key could sign an update that they would accept — only someone who
can also deploy to the Vercel site can deliver it.

### 9.4 Planned key rotation without visiting shops (advanced — do not do casually)
Possible because a release signed with the OLD key can ship an `updater.ps1` containing the NEW public key.
`Publish-AgentRelease.ps1` deliberately refuses this (it requires updater key == signing key) to prevent accidental
lock-out. Doing it needs a one-off, reviewed change to the publish script and a full E2E test of the transition.

---

## 10. Invariants (do not break)

- Task name `QuickVerse Print Agent`, port `1818`, install dir `C:\QuickVerse\print-agent` are the updater defaults.
- `$AGENT_VERSION = "x.y.z"` must stay a single line starting at column 0 (updater + publish read it by regex).
- `$PUBLIC_KEY_XML = '<RSAKeyValue>…'` must stay a single line starting at column 0.
- `manifest.json` written without BOM; signature covers its exact bytes.
- `ALLOWED_FILES` in `updater.ps1` = `agent.ps1`, `updater.ps1`. Shipping another file needs updater + publish + tests changes.
- The updater never runs downloaded code in memory; the new agent is started through the normal task / hidden launch.
- `agent.ps1` is started from its own folder; the updater identifies it by full path or relative `-File "agent.ps1"`.

---

## 11. Tests

| Test | What it proves |
|---|---|
| `tests/agent-release.test.ts` | The committed release is valid, signed with the trusted key, current, byte-exact-safe, key-free. Runs `Test-Updater.ps1`. |
| `print-agent/tests/Test-Updater.ps1` | 30 end-to-end checks with real agents, a real scheduled task and a local HTTP server on ports 18191/18192: up-to-date, no network, http refused, HTML-not-manifest, unsigned, wrong key, tampered file, path in manifest, unparsable file, version mismatch, crash → rollback, known-bad skipped, check-only, concurrent run, happy path (incl. self-update and a real `/print` call), VBS-started agent, missing task. Never touches the real agent on 1818 (asserted). Aborts if an agent started by relative path is running on the machine. |
| `print-agent/tests/Test-Agent.ps1` | The agent itself (run by `tests/repo-parity.test.ts` in the sibling repo). |
| `files/tests/Test-Installer.ps1` | Installer static checks incl. stopping the old agent before copying and registering the updater task. |
| `tests/repo-parity.test.ts` | Shipped files identical in both repos. |

## 12. Version pins (change together)
`print-agent/agent.ps1` (`$AGENT_VERSION` + header), `src/utils/print/printAgent.ts` (`REQUIRED_AGENT_VERSION`),
`print-agent/start-agent.bat`, `Start-Setup.bat`, `files/Install-QuickVerse.ps1` (`$ExpectedAgentVersion` + header).
