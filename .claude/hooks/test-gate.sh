#!/usr/bin/env bash
#
# test-gate.sh — PreToolUse gate: code changes need test changes.
# Garth's standing rule (2026-07-16): "tests for all the code we write."
# Ported from doxa-cns / openclaw for doxa-discord-bot.
#
# A doxa-discord-bot PR merge — via mcp__github__merge_pull_request OR a Bash
# `gh pr merge` — is blocked when the chunk (merge-base(origin/main, tip)..tip,
# across HEAD and all worktree tips, PLUS the PR's real file list via
# `gh pr diff` when a PR number is resolvable — a local worktree tip alone
# can't be trusted to be the PR actually being merged) adds or modifies
# hand-authored code while changing NO test file. The escape hatch is an
# EXPLICIT logged waiver in the shared attestation ledger:
# scripts/attest-review.sh "waived-tests: <reason>".
#
# What counts as CODE: src/**/*.{ts,js} (the bot's TypeScript source; dist/ is
# build output and never counts, .test.ts files are excluded from CODE below
# since they ARE the test signal).
#
# What counts as a TEST change: src/**/*.test.{ts,js} (colocated, this repo
# has no tests/ directory yet) or tests/**.
#
# FAIL-OPEN: any uncertainty allows. Only the confirmed case blocks: code
# changed, zero test changes, zero waiver for the tip.
#
# Exit codes: 0 = allow, 2 = block (stderr shown to the model).

payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

repo="$(printf '%s' "$payload" | jq -r '.tool_input.repo // empty' 2>/dev/null)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
remote_head_sha=""    # PR's real head SHA, when resolvable
remote_changed=""     # PR's real changed-file list (gh pr diff), when resolvable

if [ -n "$repo" ]; then
  # MCP merge tool: gate only this repo.
  [ "$repo" = "doxa-discord-bot" ] || exit 0

  # Resolve the PR's REAL file list + head SHA via gh, the same defence
  # kg-save-gate.sh's MCP branch already uses — a local worktree tip cannot
  # be trusted to be the PR actually being merged.
  mcp_owner="$(printf '%s' "$payload" | jq -r '.tool_input.owner // empty' 2>/dev/null)"
  mcp_pr="$(printf '%s' "$payload" | jq -r '(.tool_input.pullNumber // empty) | if type == "number" then floor else . end' 2>/dev/null)"
  if [ -n "$mcp_owner" ] && [ -n "$mcp_pr" ] && command -v gh >/dev/null 2>&1; then
    case "$mcp_pr" in
      ''|*[!0-9]*) : ;;
      *)
        remote_head_sha="$(gh pr view "$mcp_pr" --repo "$mcp_owner/$repo" --json headRefOid -q .headRefOid 2>/dev/null)"
        remote_changed="$(gh pr diff "$mcp_pr" --repo "$mcp_owner/$repo" --name-only 2>/dev/null)"
        ;;
    esac
  fi
elif [ -n "$cmd" ]; then
  # Bash tool: gate only `gh pr merge` at command position (same matching as
  # review-gate.sh — under-block, never over-block).
  printf '%s' "$cmd" | grep -qE '(^|&&|;)[[:space:]]*(cd[[:space:]]+[^;&|]+(&&|;)[[:space:]]*)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+merge([[:space:];&|>]|$)' || exit 0

  flag_repo="$(printf '%s' "$cmd" | grep -oE '(-R|--repo)([[:space:]]+|=)[^[:space:];&|]+' | head -1 | sed -E 's/^(-R|--repo)([[:space:]]+|=)//')"
  if [ -n "$flag_repo" ]; then
    case "$flag_repo" in
      doxa-discord-bot|*/doxa-discord-bot) ;;
      *) exit 0 ;;
    esac
  else
    hook_cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)"
    cmd_cd="$(printf '%s' "$cmd" | grep -oE '^[[:space:]]*cd[[:space:]]+/[^[:space:];&|]+' | head -1 | sed -E 's#^[[:space:]]*cd[[:space:]]+##')"
    if [ -n "$cmd_cd" ] && [ -d "$cmd_cd" ]; then
      dir="$cmd_cd"
    else
      dir="${hook_cwd:-$dir}"
    fi
    repo_common="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
    proj_common="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
    [ -n "$proj_common" ] || exit 0
    [ "$repo_common" = "$proj_common" ] || exit 0
  fi

  # `gh pr merge <N>` names the PR explicitly — resolve its real file list +
  # head SHA the same way the MCP branch above does.
  cmd_pr="$(printf '%s' "$cmd" | grep -oE 'pr[[:space:]]+merge[[:space:]]+[0-9]+' | grep -oE '[0-9]+$' | head -1)"
  if [ -n "$cmd_pr" ] && command -v gh >/dev/null 2>&1; then
    cmd_pr_repo="${flag_repo:-$(gh repo view "$dir" --json nameWithOwner -q .nameWithOwner 2>/dev/null)}"
    if [ -n "$cmd_pr_repo" ]; then
      remote_head_sha="$(gh pr view "$cmd_pr" --repo "$cmd_pr_repo" --json headRefOid -q .headRefOid 2>/dev/null)"
      remote_changed="$(gh pr diff "$cmd_pr" --repo "$cmd_pr_repo" --name-only 2>/dev/null)"
    fi
  fi
else
  exit 0
fi

cd "$dir" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
ledger="$common/review-attest.jsonl"

test_re='^(src/.+\.test\.(ts|js)|tests/.+)$'
code_re='^src/.+\.(ts|js)$'

# Evaluate HEAD plus every worktree tip; the merge could land any of them.
tips="$(git rev-parse HEAD 2>/dev/null)
$(git worktree list --porcelain 2>/dev/null | sed -n 's/^HEAD //p')"

code_without_tests=""
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  base="$(git merge-base "$sha" origin/main 2>/dev/null)" || continue
  [ "$base" = "$sha" ] && continue   # nothing landing from this tip
  changed="$(git diff --name-only "$base" "$sha" 2>/dev/null)" || continue
  tests="$(printf '%s\n' "$changed" | grep -E "$test_re")"
  code="$(printf '%s\n' "$changed" | grep -vE "$test_re" | grep -E "$code_re")"
  if [ -n "$code" ] && [ -z "$tests" ]; then
    # Waived for this tip? (explicit, logged — never silent)
    if [ -f "$ledger" ] && grep "\"sha\":\"$sha\"" "$ledger" 2>/dev/null | grep -q '"verdict":"waived-tests:'; then
      continue
    fi
    code_without_tests="$code"
  fi
done <<EOF
$tips
EOF

# The PR's real diff (when resolved via gh above) — evaluated directly
# against its own file list rather than a local merge-base, so it still
# catches an MCP/`gh pr merge <N>` merge whose head SHA isn't in the local
# object DB at all.
if [ -z "$code_without_tests" ] && [ -n "$remote_changed" ]; then
  tests="$(printf '%s\n' "$remote_changed" | grep -E "$test_re")"
  code="$(printf '%s\n' "$remote_changed" | grep -vE "$test_re" | grep -E "$code_re")"
  if [ -n "$code" ] && [ -z "$tests" ]; then
    waived=""
    if [ -n "$remote_head_sha" ] && [ -f "$ledger" ] && grep "\"sha\":\"$remote_head_sha\"" "$ledger" 2>/dev/null | grep -q '"verdict":"waived-tests:'; then
      waived="yes"
    fi
    [ -n "$waived" ] || code_without_tests="$code"
  fi
fi

[ -z "$code_without_tests" ] && exit 0

{
  echo "⛔ test gate — this chunk changes code with NO test change:"
  printf '%s\n' "$code_without_tests" | sed 's/^/    /'
  echo "Garth's standing rule (2026-07-16): tests for all the code we write."
  echo "Add or update a test (src/**/*.test.ts colocated, or tests/) pinning the change,"
  echo "or log an explicit waiver:"
  echo "  scripts/attest-review.sh \"waived-tests: <reason>\""
} >&2
exit 2
