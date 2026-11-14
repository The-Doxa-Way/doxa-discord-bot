# CLAUDE.md — doxa-discord-bot

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.

## What this is

DoxaBot for Discord, a product of the Doxa business (doxa.app). It is a thin discord.js shim:
slash commands and @mentions call the hosted Doxa MCP (`doxa.app/mcp/v1`) through
`@thedoxaway/mcp-client`. The voice, theology and Scripture handling live in that MCP, not here.
`README.md` has the commands and the self-host steps. The repo is PUBLIC: never commit a secret.

The brand and voice rules live in doxa-brand (The-Doxa-Way/doxa-brand). Apply them; do not copy
them here.

## How to verify

- `npm ci`, then `npm run typecheck` (`tsc --noEmit`) and `npm run build` (`tsc` into `dist/`).
- `npm test` compiles with `tsconfig.test.json` into `.test-dist/`, then runs `node --test` on
  the compiled `*.test.js` files and `scripts/*.test.cjs`.
- There is no lint script.
- CI does NOT run the typecheck, the build or the tests. Run them yourself before you push.
- No CI job builds the Docker image, so a Dockerfile or dependency fault shows only at
  `flyctl deploy`.

## Gotchas

- Deploy is by hand: `flyctl deploy` to the Fly.io app `doxa-discord-bot` (`fly.toml`). A merge
  to `main` does not deploy.
- `@thedoxaway/mcp-client` comes from the committed tarball `thedoxaway-mcp-client-0.2.0.tgz`,
  not from the npm registry. The Dockerfile copies it in.
- `DATABASE_URL` is required at boot. It connects as the least-privilege Postgres role
  `discord_bot`, which can only execute the consent functions. The value is in the macOS
  Keychain, service `doxa-discord-bot DATABASE_URL`. Never print it.
- The GDPR Art. 9 consent gate (`src/consent.ts`, `src/dispatch.ts`) must stay in front of every
  command that sends free text. A consent-store read error fails closed.
- The Doxa server's public text (description, #welcome topic and pin) is code-owned in
  `src/server-profile.ts`. The bot writes it on every start.

## Landing

The production branch is `main`. Every change lands by branch, PR, independent review, merge.
Self-review never counts.

- Review: one `/code-review max` pass on the final diff on claude-opus-5-5, at most one fix
  round, then `ATTEST_REVIEW_LEVEL=max scripts/attest-review.sh "<verdict>"` before you push.
  `.github/workflows/claude-code-review.yml` runs only on manual dispatch.
- Hooks in `.claude/hooks/` enforce this: `push-review-gate.sh` (max review before `git push`),
  `review-gate.sh` (attestation before merge), `test-gate.sh` (a code change needs a test change,
  or `scripts/attest-review.sh "waived-tests: <reason>"`) and `kg-save-gate.sh`.
- kg-save: KG Guard CI fails a PR with no `.knowledge-graph/` change. Record it with
  `node scripts/knowledge-graph-merkle.cjs add "<Entity>" "<what and why>" <source-file> --type <Type>`
  and commit it in the same PR. Use `[skip-kg]` in the PR title only for a knowledge-free change.
- The org ruleset requires `gitleaks` (secret-scan). `kg-save-gate.sh` refuses `gh pr merge`
  while KG Guard is red or pending. Never merge over a red or pending check.
- An attestation is merge authority: the fleet auto-lander (openclaw `land-prs.mjs`) merges an
  attested, green PR.
- The gate hooks and `scripts/attest-review.sh` are rendered from The-Doxa-Way-CNS
  `fleet/gates/`. Fix the template there, never the copy here.

## Standing orders

Cross-repo rules, the standing orders and the fleet map live in The-Doxa-Way-CNS: its
`CLAUDE.md` and `docs/org-map.md`. The CNS CLAUDE.md is the authority. If this file and the CNS
disagree, the CNS wins.
