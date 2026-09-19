# orchestrate-kit

A plan-then-delegate build system for Claude Code, portable to opencode. One strong model (Opus, max effort) reads your codebase and writes an exhaustive plan. Cheap executor agents then build it one task at a time. A deterministic script checks every result, and a git-backed checklist lets any later session, or another tool, resume exactly where the last one stopped.

## How it works

```
you ──▶ Opus orchestrator ── recon (haiku scouts) ──▶ PLAN.md + one brief per task ──▶ you approve
              │
              └─ per task: checkpoint ─▶ executor (haiku/sonnet/opus) ─▶ orch.sh gate ─▶ [x] or fix loop
              └─ at the end: verify-all vs baseline ─▶ acceptance walk ─▶ final review ─▶ report
```

- **The brain plans once, in depth.** Recon, acceptance criteria, a failure pre-mortem (inputs, concurrency, security, data, performance, compatibility, operations), frozen contracts, a test matrix, and a task graph with exact write-sets. The plan is written for zero-context engineers, so cheap models can execute it.
- **Executors are narrow by construction.** An executor gets a two-line dispatch pointing at its brief. It can't spawn agents, browse, or load skills. It follows Karpathy-style rules (think first, minimum code, surgical edits, verifiable goals) plus reuse-before-write and no test weakening. It returns at most 10 lines.
- **Gates, not trust.** `orch.sh gate` re-runs the task's Verify block itself and fails the task on any of:
  - files changed outside the write-set;
  - uncommitted work;
  - rewritten history or a switched branch;
  - an executor commit that edits its own brief.

  It also flags skipped tests, debug output, suppressions, and deleted tests. It uses no model tokens; full logs stay on disk.
- **Sequential by default.** Parallel writers run only when eight explicit safety checks pass, at most three at a time, each in its own git worktree.
- **Resumable.** `.orchestrator/STATE.md` is a checklist that is written *before* each dispatch and committed to git, and `LEDGER.md` records every ruling. The skill's rules are designed to survive context compaction.

## Install (about a minute)

Requirements: git, bash (macOS, Linux, or Git Bash on Windows), and Claude Code or opencode. Python or Node is optional; the installer uses one of them to merge settings.

```bash
unzip orchestrate-kit.zip
cd /path/to/your-project            # the repository root
bash /path/to/orchestrate-kit/install.sh .
git add .claude .opencode CLAUDE.md AGENTS.md && git commit -m "chore: add orchestrate kit"
```

The installer:
- copies the skill and agents;
- merges its keys into `.claude/settings.json` without overwriting yours;
- adds a short marked block to `CLAUDE.md` and `AGENTS.md` (skip with `--no-pointers`);
- creates `.worktreeinclude` if you have `.env` files;
- runs a 34-check self-test of the helper script.

Anything it replaces is backed up to `.orchestrate-kit-backup/`. Commit the kit before the first run: gates count uncommitted files as unfinished work, and worktrees only see committed files.

**Manual install.** The kit folder contains hidden directories, so use `ls -a`.
1. Copy `.claude/skills/orchestrate/`, `.claude/agents/orch-*.md`, and `.opencode/agents/orch-*.md` into your project.
2. Add the keys from `.claude/skills/orchestrate/assets/settings.json` to your `.claude/settings.json`.
3. Optionally paste `assets/POINTER.md` into `CLAUDE.md` and `AGENTS.md`.

## Use

```bash
claude --model opus
```

```
/orchestrate Add per-user rate limiting: 100 req/min per API key, 429 with Retry-After, use our Redis client
```

The skill sets max effort while it runs. It sizes the work first: a one-file fix is done directly with no subagents. For anything bigger, it explores, plans, and then stops to show you a summary of at most 15 lines (goal, acceptance criteria, tasks by wave, top risks, assumptions). Reply "go", or say "run autonomously" in your first message to skip that pause. The orchestrator still stops for anything destructive, security-sensitive, or leaving the repo (push, deploy, paid APIs). It never pushes, merges into your default branch, or opens a PR on its own.

Useful at any time:
- `/orchestrate status`
- `bash .claude/skills/orchestrate/scripts/orch.sh status`
- `/tasks`, to confirm which model each subagent actually runs on

## When the usage limit hits

Nothing is lost. Every dispatch is recorded in `STATE.md` and committed first, and every finished task is committed with its gate result. After the limit resets, type `continue` in the same session, or start a new one and run `/orchestrate resume`. The resume protocol:
1. reads the checklist and the git log;
2. re-gates any task that was in flight, keeping partial work instead of starting over;
3. continues from `NEXT ACTION`.

Finished tasks are never redone.

## Switching tools

- **opencode** finds the skill in `.claude/skills/` automatically and the agents in `.opencode/agents/`.
  - opencode can't choose a model per dispatch, so the executor comes in three tiers: `orch-executor-lite`, `orch-executor`, and `orch-executor-deep`.
  - A different provider: `ORCH_OC_HAIKU=… ORCH_OC_SONNET=… ORCH_OC_OPUS=… bash .claude/skills/orchestrate/scripts/sync-opencode.sh`.
  - The generated files use the opencode V2 agent format; on V1, delete their `permissions` and `steps` fields.
  - opencode has no per-agent worktree isolation, so runs there are sequential.
- **Other agents** (Codex, Gemini CLI, Cursor, and similar) read the `AGENTS.md` pointer.
  - Everything lives in plain files and git, so any agent that can read markdown and run bash can continue a run.
  - Without subagents, the orchestrator does each task itself under the executor's rules and still gates each one.
- **After editing an agent** in `.claude/agents/`, re-run `sync-opencode.sh` so the opencode copies match.

## Where the tokens go

| Role | Model | Why |
|---|---|---|
| Orchestrator | Opus, max effort | Plans once and rules on problems. Its output tokens are the most expensive, so it writes each brief once and dispatches by file path. |
| Scouts | Haiku | Read-only mapping. Notes go to `.orchestrator/recon/`, and each returns at most 10 lines. |
| Executors | Haiku if the brief contains the code, Sonnet from a prose brief, Opus for cross-file work or a third attempt | Model is chosen per task. Fix rounds 1 and 2 resume the same executor while its context is still cached. |
| Reviewers | Sonnet for high-risk tasks; Opus for plan review and large final diffs | Clean-context review, with findings written to a file. The fix executor reads that file instead of having the findings pasted into its prompt. |
| Checks | none | `orch.sh` runs tests and scans; only a 30-line tail comes back. |

Default behavior is sequential because parallel agents multiply token use and create conflicts. There is at most one fix task per review round, and never one fix agent per finding.

## Tuning

- **Models and turn limits:** `model`, `effort`, and `maxTurns` in `.claude/agents/*.md`. The routing table in `SKILL.md` decides the per-dispatch model.
- **Python projects that want parallel waves:** add `.venv` to `worktree.symlinkDirectories` only if the project isn't installed in editable mode. An editable install makes worktree tests import the main checkout.
- **Longer log tails:** `ORCH_TAIL=80` (the full log path is always printed).
- **Optional hardening:** add `"env": {"CLAUDE_CODE_SUBAGENT_MODEL": "sonnet"}` to project settings. Any subagent started without a model then defaults to Sonnet instead of your session model. This also affects your other agents in this project.

## Troubleshooting

- **Every gate fails with DIRTY.** Your test commands generate files. `orch.sh baseline` lists them; add patterns to `.git/info/exclude`.
- **An executor reports "wrong base" in a worktree.** Set `"worktree": {"baseRef": "head"}` in `.claude/settings.json`; the default branches from `origin/<default>`.
- **Permission prompts during long runs.** The installer's allow rule covers `orch.sh`; auto mode covers most test commands. Add allow rules for your test runner if needed.
- **Something odd on your machine.** Run `bash .claude/skills/orchestrate/scripts/selftest.sh`. It passes on GNU bash 5, Apple bash 3.2, and GNU, BWK (macOS-style), BusyBox, and mawk awk.

## What's inside

```
install.sh                                  installer (merge, never clobber)
.claude/skills/orchestrate/SKILL.md         the orchestrator playbook (about 3k tokens, survives compaction)
  references/planning.md                    recon, PM lens, pre-mortem, contracts, decomposition, briefs, tests
  references/parallelism.md                 safety checks, worktree protocol, merge-back
  references/failure-modes.md               MAST and coding-agent failure modes, each mapped to a guard; recovery
  assets/PLAN.md TASK.md STATE.md           templates
  assets/settings.json POINTER.md           what the installer merges
  scripts/orch.sh                           init, status, checkpoint, base, baseline, gate, verify, verify-all, slop
  scripts/selftest.sh                       34 checks in a throwaway repo
  scripts/sync-opencode.sh                  regenerates .opencode/agents/ from .claude/agents/
  evals/evals.json                          trigger and behavior test prompts (skill-creator format)
.claude/agents/orch-executor.md             executor rules
.claude/agents/orch-scout.md                read-only recon
.claude/agents/orch-reviewer.md             plan, task, rereview, and final review modes
.opencode/agents/*.md                       generated opencode V2 agents, including executor tiers
```

A run creates `.orchestrator/`, containing `PLAN.md`, `STATE.md`, `LEDGER.md`, `tasks/`, `reports/`, `recon/`, and git-ignored `logs/`. When a run finishes, you can delete it or keep it; the next run archives it.

## Built on

The rules come from published evidence and battle-tested skills rather than invention:

- **Why multi-agent systems fail.** MAST, Cemri et al., UC Berkeley, NeurIPS 2025, "Why Do Multi-Agent LLM Systems Fail?": 14 failure modes from 1,642 traces. Each mode maps to a guard in `references/failure-modes.md`. https://arxiv.org/abs/2503.13657
- **When to use multiple agents.** Anthropic, "Building multi-agent systems: when and how to use them": token cost, splitting work by context rather than role, and verifiers that stop early. https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
- **Keeping parallel writes safe.** Cognition, "Don't Build Multi-Agents" and "Multi-Agents: What's Actually Working": implicit decisions, single-threaded writes, clean-context review. https://cognition.com/blog/dont-build-multi-agents and https://cognition.com/blog/multi-agents-working
- **Controller and implementer patterns.** obra/superpowers (subagent-driven-development, writing-plans, verification-before-completion, test-driven-development): ledgers that survive compaction, dispatch by path, status contracts, fix-round caps, one batch fix per review. https://github.com/obra/superpowers
- **Coding discipline.** Guidelines derived from Andrej Karpathy's observations on LLM coding pitfalls: think before coding, simplicity first, surgical changes, goal-driven execution. https://github.com/forrestchang/andrej-karpathy-skills
- **Harness behavior.** Claude Code docs (subagents, skills, worktrees), Claude Code issues #41368, #57768, #55708, and #40259, and the opencode V2 docs (agents, tools, skills).
