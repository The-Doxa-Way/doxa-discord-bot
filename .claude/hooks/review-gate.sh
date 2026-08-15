#!/usr/bin/env bash
#
# review-gate.sh — PreToolUse gate on landing a doxa-discord-bot PR merge.
# Ported from doxa-cns / openclaw (Garth 2026-07-16 landing-gates suite).
#
# Garth's standing rule: every chunk lands only after an INDEPENDENT review
# pass (PR bot / /code-review by a non-author session — self-review never
# counts). This hook ENFORCES it instead of remembering it: a
# doxa-discord-bot PR merge — via mcp__github__merge_pull_request OR a Bash
# `gh pr merge` — is blocked unless the review attestation ledger
# ($GIT_COMMON_DIR/review-attest.jsonl, written by scripts/attest-review.sh)
# contains an entry for the tip of a local branch/worktree, i.e. the code
# being merged was reviewed AT its final SHA, not at some earlier state.
#
# The MCP path additionally resolves the PR's ACTUAL head SHA via `gh pr
# view` and checks the ledger for that too — checking only local worktree
# tips would let an MCP merge of PR #N pass on the strength of an unrelated
# attested SHA that happens to sit in some other local worktree (the same
# hole kg-save-gate.sh's MCP branch closes by reading the PR's real file
# list instead of trusting local state).
#
# FAIL-OPEN philosophy: any uncertainty — no payload, no jq, repo not
# doxa-discord-bot, git lookups failing — allows the call. Only the confirmed
# case blocks: a doxa-discord-bot merge with no attestation matching any local
# tip (or, when resolvable, the PR's real head SHA). The escape hatch is an
# EXPLICIT logged waiver (scripts/attest-review.sh "waived: <reason>"), never
# a silent bypass.
#
# Exit codes: 0 = allow, 2 = block (stderr shown to the model).

# gh repo view takes OWNER/REPO, never a path — `gh repo view "$dir"` is an
# argument error that always fails, which silently disabled the PR-file-list
# lookups this gate depends on. Resolve the slug from the checkout's remote.
repo_slug_of() {
  git -C "$1" remote get-url origin 2>/dev/null     | sed -E 's#^git@[^:]+:##; s#^https?://[^/]+/##; s#\.git$##'
}

payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

repo="$(printf '%s' "$payload" | jq -r '.tool_input.repo // empty' 2>/dev/null)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
remote_head_sha=""   # filled in below when a PR number is resolvable

if [ -n "$repo" ]; then
  # MCP merge tool (mcp__github__merge_pull_request): gate only this repo.
  [ "$repo" = "doxa-discord-bot" ] || exit 0

  # Resolve the PR's REAL head SHA (not just local checkout state) so the
  # attestation check below covers the code actually being merged.
  mcp_owner="$(printf '%s' "$payload" | jq -r '.tool_input.owner // empty' 2>/dev/null)"
  mcp_pr="$(printf '%s' "$payload" | jq -r '(.tool_input.pullNumber // empty) | if type == "number" then floor else . end' 2>/dev/null)"
  if [ -n "$mcp_owner" ] && [ -n "$mcp_pr" ] && command -v gh >/dev/null 2>&1; then
    case "$mcp_pr" in
      ''|*[!0-9]*) : ;;
      *) remote_head_sha="$(gh pr view "$mcp_pr" --repo "$mcp_owner/$repo" --json headRefOid -q .headRefOid 2>/dev/null)" ;;
    esac
  fi
elif [ -n "$cmd" ]; then
  # Bash tool: gate only a `gh pr merge` at command position — start of
  # string, right after a `&&`/`;` chain separator, or after a `cd <path> &&`
  # prefix and env assignments — never as a substring, so `git commit -m
  # '…gh pr merge…'` is not spuriously blocked. Under-block, never
  # over-block: a merge buried behind a `|` pipe or `$(...)` passes (fail-open).
  printf '%s' "$cmd" | grep -qE '(^|&&|;)[[:space:]]*(cd[[:space:]]+[^;&|]+(&&|;)[[:space:]]*)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+merge([[:space:];&|>]|$)' || exit 0

  # Which repo is being merged? -R/--repo flag wins; else resolve the working
  # directory (cd-prefix path over payload cwd) and require it to be THIS repo.
  flag_repo="$(printf '%s' "$cmd" | grep -oE '(-R|--repo)([[:space:]]+|=)[^[:space:];&|]+' | head -1 | sed -E 's/^(-R|--repo)([[:space:]]+|=)//')"
  if [ -n "$flag_repo" ]; then
    case "$flag_repo" in
      doxa-discord-bot|*/doxa-discord-bot) ;;   # gate
      *) exit 0 ;;                              # sibling repo — pass
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
    [ "$repo_common" = "$proj_common" ] || exit 0   # different repo — pass
  fi

  # `gh pr merge <N>` names the PR explicitly — resolve its real head SHA the
  # same way the MCP branch above does. `gh pr merge` with no number (merges
  # the current branch's PR) has no number to extract; local tips cover that
  # case since the current branch already IS the PR's head.
  cmd_pr="$(printf '%s' "$cmd" | grep -oE 'pr[[:space:]]+merge[[:space:]]+[0-9]+' | grep -oE '[0-9]+$' | head -1)"
  if [ -n "$cmd_pr" ] && command -v gh >/dev/null 2>&1; then
    if [ -n "$flag_repo" ]; then
      remote_head_sha="$(gh pr view "$cmd_pr" --repo "$flag_repo" --json headRefOid -q .headRefOid 2>/dev/null)"
    else
      remote_head_sha="$(gh pr view "$cmd_pr" --repo "20 20 12 61 79 80 81 98 701 33 100 204 250 395 398 399 400repo_slug_of "")" --json headRefOid -q .headRefOid 2>/dev/null)"
    fi
  fi
else
  exit 0
fi

cd "$dir" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
ledger="$common/review-attest.jsonl"

# Candidate SHAs the merge could be landing: HEAD, every worktree tip, and
# (when resolvable) the PR's actual remote head SHA.
# When the PR's real remote head resolves it is the ONLY candidate. OR-ing it
# into the local tips could only ever make this gate MORE permissive — the loop
# below passes if ANY candidate is attested, so a session that attested its own
# branch could land an unrelated, never-reviewed PR by number. Fall back to
# local tips only when the head cannot be resolved (offline / no gh), since
# fail-open is the documented posture for a hook that cannot see.
if [ -n "$remote_head_sha" ]; then
  tips="$remote_head_sha"
else
  tips="$(git rev-parse HEAD 2>/dev/null)
$(git worktree list --porcelain 2>/dev/null | sed -n 's/^HEAD //p')"
fi

if [ -f "$ledger" ]; then
  while IFS= read -r sha; do
    [ -n "$sha" ] || continue
    if grep "\"sha\":\"$sha\"" "$ledger" 2>/dev/null | grep -qv '"verdict":"waived-tests:'; then
      exit 0
    fi
  done <<EOF
$tips
EOF
fi

{
  echo "⛔ review gate — no review attestation for any local branch tip."
  echo "Every doxa-discord-bot chunk merges only after its INDEPENDENT review pass (CLAUDE.md Landing doctrine — self-review never counts)."
  echo "Run the review on the final diff, fix findings, then attest and retry:"
  echo
  echo "  PR bot / /code-review (non-author) → fix round →"
  echo "  scripts/attest-review.sh \"clean\"   (or \"findings-fixed: <summary>\")"
  echo
  echo "Genuinely reviewless landing (generated state only)? Log an explicit waiver:"
  echo "  scripts/attest-review.sh \"waived: <reason>\""
} >&2
exit 2
