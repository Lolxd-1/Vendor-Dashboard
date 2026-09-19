#!/usr/bin/env bash
# install.sh: add the orchestrate kit to a project without clobbering anything.
# usage: bash install.sh [project-dir] [--no-pointers] [--no-test]
set -u
KIT=$(cd "$(dirname "$0")" && pwd)
TARGET=.; POINTERS=1; TEST=1
for a in "$@"; do
  case $a in
    --no-pointers) POINTERS=0 ;;
    --no-test) TEST=0 ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    -*) echo "unknown option: $a" >&2; exit 2 ;;
    *) TARGET=$a ;;
  esac
done
[ -d "$TARGET" ] || { echo "not a directory: $TARGET" >&2; exit 2; }
TARGET=$(cd "$TARGET" && pwd)
[ "$TARGET" != "$KIT" ] || { echo "run this from your project, not from inside the kit: bash /path/to/orchestrate-kit/install.sh ." >&2; exit 2; }
SKILL=.claude/skills/orchestrate
STAMP=$(date +%Y%m%d%H%M%S)-$$
BACKED=0
BACKUP="$TARGET/.orchestrate-kit-backup/$STAMP"

say() { printf '%s\n' "$*"; }
backup() {  # backup <relative path>, only when it exists
  if [ -e "$TARGET/$1" ]; then
    mkdir -p "$BACKUP/$(dirname "$1")" && cp -R "$TARGET/$1" "$BACKUP/$1" && BACKED=1
  fi
}
install_file() {  # install_file <relative path>: copy from the kit, backing up a different existing file
  if [ -f "$TARGET/$1" ] && ! cmp -s "$KIT/$1" "$TARGET/$1"; then backup "$1"; fi
  mkdir -p "$TARGET/$(dirname "$1")" && cp "$KIT/$1" "$TARGET/$1"
}

if top=$(git -C "$TARGET" rev-parse --show-toplevel 2> /dev/null); then
  [ "$(cd "$top" && pwd -P)" = "$(cd "$TARGET" && pwd -P)" ] \
    || say "WARNING: $TARGET is not the repository root ($top). Install at the root so the kit's paths resolve."
else
  say "WARNING: $TARGET is not a git repository. The orchestrator needs git: run 'git init' and make a first commit."
fi

# 1. Skill (replaced as a unit) and agents.
if [ -d "$TARGET/$SKILL" ]; then
  if ! diff -rq "$KIT/$SKILL" "$TARGET/$SKILL" > /dev/null 2>&1; then backup "$SKILL"; fi
  rm -rf "${TARGET:?}/$SKILL"
fi
mkdir -p "$TARGET/.claude/skills" && cp -R "$KIT/$SKILL" "$TARGET/$SKILL"
chmod +x "$TARGET/$SKILL"/scripts/*.sh
for f in "$KIT"/.claude/agents/orch-*.md "$KIT"/.opencode/agents/orch-*.md; do
  install_file "${f#"$KIT"/}"
done
say "installed: $SKILL/, .claude/agents/orch-*.md, .opencode/agents/orch-*.md"

# 2. Settings: merge, never overwrite.
SETTINGS="$TARGET/.claude/settings.json"
HAS_PKG=0; [ -f "$TARGET/package.json" ] && HAS_PKG=1
MERGE_PY='
import json, sys
path, tpl_path, has_pkg = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
try:
    cur = json.load(open(path))
except FileNotFoundError:
    cur = {}
tpl = json.load(open(tpl_path))
notes = []
wt = cur.setdefault("worktree", {})
if "baseRef" not in wt:
    wt["baseRef"] = "head"; notes.append("worktree.baseRef = head")
elif wt["baseRef"] != "head":
    notes.append("WARNING: worktree.baseRef is %r; parallel waves need \"head\" (left unchanged)" % wt["baseRef"])
if has_pkg:
    links = wt.setdefault("symlinkDirectories", [])
    for d in tpl["worktree"]["symlinkDirectories"]:
        if d not in links:
            links.append(d); notes.append("worktree.symlinkDirectories += " + d)
allow = cur.setdefault("permissions", {}).setdefault("allow", [])
for rule in tpl["permissions"]["allow"]:
    if rule not in allow:
        allow.append(rule); notes.append("permissions.allow += " + rule)
with open(path, "w") as fh:
    json.dump(cur, fh, indent=2); fh.write("\n")
print("settings: " + ("; ".join(notes) if notes else "already up to date"))
'
# shellcheck disable=SC2016 # JavaScript source, not shell
MERGE_JS='
const fs = require("fs");
const [path, tplPath, hasPkg] = process.argv.slice(1);
const cur = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
const tpl = JSON.parse(fs.readFileSync(tplPath, "utf8"));
const notes = [];
const wt = (cur.worktree = cur.worktree || {});
if (!("baseRef" in wt)) { wt.baseRef = "head"; notes.push("worktree.baseRef = head"); }
else if (wt.baseRef !== "head") notes.push(`WARNING: worktree.baseRef is "${wt.baseRef}"; parallel waves need "head" (left unchanged)`);
if (hasPkg === "1") {
  const links = (wt.symlinkDirectories = wt.symlinkDirectories || []);
  for (const d of tpl.worktree.symlinkDirectories) if (!links.includes(d)) { links.push(d); notes.push("worktree.symlinkDirectories += " + d); }
}
const perms = (cur.permissions = cur.permissions || {});
const allow = (perms.allow = perms.allow || []);
for (const r of tpl.permissions.allow) if (!allow.includes(r)) { allow.push(r); notes.push("permissions.allow += " + r); }
fs.writeFileSync(path, JSON.stringify(cur, null, 2) + "\n");
console.log("settings: " + (notes.length ? notes.join("; ") : "already up to date"));
'
before=$(mktemp 2> /dev/null || mktemp -t orchkit)
[ -f "$SETTINGS" ] && cp "$SETTINGS" "$before"
mkdir -p "$TARGET/.claude"
merged=0
for py in python3 python; do
  if command -v "$py" > /dev/null 2>&1 && "$py" -c 'import sys; sys.exit(sys.version_info[0] < 3)' 2> /dev/null; then
    "$py" -c "$MERGE_PY" "$SETTINGS" "$KIT/$SKILL/assets/settings.json" "$HAS_PKG" 2> /dev/null && merged=1
    break
  fi
done
if [ "$merged" = 0 ] && command -v node > /dev/null 2>&1; then
  node -e "$MERGE_JS" "$SETTINGS" "$KIT/$SKILL/assets/settings.json" "$HAS_PKG" 2> /dev/null && merged=1
fi
if [ -s "$before" ] && ! cmp -s "$before" "$SETTINGS"; then
  mkdir -p "$BACKUP/.claude" && cp "$before" "$BACKUP/.claude/settings.json" && BACKED=1
fi
rm -f "$before"
if [ "$merged" = 0 ]; then
  if [ -f "$SETTINGS" ]; then
    say "settings: could not merge automatically (no python or node, or invalid JSON)."
    say "  add the keys from $SKILL/assets/settings.json to .claude/settings.json by hand"
  else
    cp "$KIT/$SKILL/assets/settings.json" "$SETTINGS" && say "settings: created .claude/settings.json"
  fi
fi

# 3. Pointer block in CLAUDE.md and AGENTS.md (replaced in place on reinstall).
upsert_block() {
  f=$1; blk="$KIT/$SKILL/assets/POINTER.md"
  if [ -f "$f" ] && grep -q 'orchestrate-kit:start' "$f"; then
    awk -v blk="$blk" '
      /orchestrate-kit:start/ { while ((getline line < blk) > 0) print line; close(blk); skip = 1; next }
      /orchestrate-kit:end/ { skip = 0; next }
      !skip { print }
    ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  else
    if [ -s "$f" ]; then
      if [ -n "$(tail -c 1 "$f")" ]; then printf '\n\n' >> "$f"; else printf '\n' >> "$f"; fi
    fi
    cat "$blk" >> "$f"
  fi
  say "pointer: ${f#"$TARGET"/}"
}
if [ "$POINTERS" = 1 ]; then
  claude_md="$TARGET/CLAUDE.md"
  if [ ! -f "$claude_md" ] && [ -f "$TARGET/.claude/CLAUDE.md" ]; then claude_md="$TARGET/.claude/CLAUDE.md"; fi
  upsert_block "$claude_md"
  upsert_block "$TARGET/AGENTS.md"
fi

# 4. Carry gitignored env files into worktrees, only if the project has them.
if [ ! -f "$TARGET/.worktreeinclude" ]; then
  envs=""
  for e in .env .env.local; do [ -f "$TARGET/$e" ] && envs="$envs$e
"; done
  if [ -n "$envs" ]; then printf '%s' "$envs" > "$TARGET/.worktreeinclude" && say "created .worktreeinclude"; fi
fi

if [ "$BACKED" = 1 ]; then
  say "backups of replaced files: ${BACKUP#"$TARGET"/}"
  ex=$(git -C "$TARGET" rev-parse --git-path info/exclude 2> /dev/null) && {
    case $ex in /*|[A-Za-z]:*) ;; *) ex="$TARGET/$ex" ;; esac
    grep -qxF '/.orchestrate-kit-backup/' "$ex" 2> /dev/null || printf '/.orchestrate-kit-backup/\n' >> "$ex"
  }
fi

# 5. Prove the helper works on this machine.
if [ "$TEST" = 1 ]; then
  bash "$TARGET/$SKILL/scripts/selftest.sh" 2>&1 | tail -n 3
fi

add=".claude .opencode"
for f in CLAUDE.md AGENTS.md .worktreeinclude; do [ -f "$TARGET/$f" ] && add="$add $f"; done
cat <<EOF

Next steps:
  1. Commit the kit (gates treat uncommitted files as DIRTY, and worktrees see only committed files):
       git add $add && git commit -m "chore: add orchestrate kit"
  2. Start Claude Code at the repository root on Opus:  claude --model opus
  3. Run:  /orchestrate <what you want built>     Resume any time with:  /orchestrate resume
  opencode: the skill and agents load automatically; ask it to use the orchestrate skill.
EOF
