// kg-save-gate-merge-integrity.test.cjs — proves the merge-integrity check
// wired into .claude/hooks/kg-save-gate.sh actually fires on the `gh pr
// merge` command path, not just on paper (ported from doxa-cns, which found
// its own copy of this block unreachable when placed AFTER a
// `gh pr merge`-specific KG-Guard-verdict fast path that exits 0 on a GREEN
// verdict — the single most common landing shape there). This repo's
// kg-save-gate.sh has no such fast path today, so this test instead pins
// that the block — placed immediately after cwd/work-tree resolution, before
// every exit path that follows — actually runs and blocks on a real dropped
// observation. This drives the REAL hook against a throwaway repo containing
// a synthetic instance of the real incident (a merge commit that drops an
// observation unique to one parent) — a mock-free reproduction, not just a
// read of the code.
//
// Run: node --test scripts/kg-save-gate-merge-integrity.test.cjs

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.resolve(__dirname, '../.claude/hooks/kg-save-gate.sh');
const REAL_INTEGRITY_SCRIPT = path.resolve(__dirname, 'check-kg-merge-integrity.cjs');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function merkle(observations) {
  return JSON.stringify({ merkleRoot: 'x', observations, lastVerified: null, version: 1 }, null, 2);
}

function writeAndCommit(dir, observations, message) {
  fs.writeFileSync(path.join(dir, '.knowledge-graph-merkle.json'), merkle(observations));
  git(['add', '-A'], dir);
  git(['commit', '-qm', message], dir);
  return git(['rev-parse', 'HEAD'], dir);
}

// Builds a throwaway repo shaped like the real incident:
//   A (root, obs h1)
//   ├─ main tip M1 (adds h2)   <- origin/main points here (already "pushed")
//   └─ feature tip F1 (adds h3)
// HEAD = a merge of M1 and F1 resolved by keeping ONLY M1's content (the
// `git checkout --theirs`/`--ours` anti-pattern) — h3 (unique to F1, a real
// parent of the merge) is silently dropped from the result. Both parents
// "look fine" individually, but the merge result is missing an entity that
// was live on one side.
function repoWithDroppedObservation() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kgsg-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'g@d'], dir);
  git(['config', 'user.name', 'g'], dir);

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(REAL_INTEGRITY_SCRIPT, path.join(dir, 'scripts', 'check-kg-merge-integrity.cjs'));

  const base = writeAndCommit(dir, [{ hash: 'h1', entityName: 'Base', content: 'c', provenance: {}, timestamp: '2026-01-01T00:00:00.000Z' }], 'base');

  const m1 = writeAndCommit(dir, [
    { hash: 'h1', entityName: 'Base', content: 'c', provenance: {}, timestamp: '2026-01-01T00:00:00.000Z' },
    { hash: 'h2', entityName: 'Two', content: 'c', provenance: {}, timestamp: '2026-01-02T00:00:00.000Z' },
  ], 'M1: add Two');
  // origin/main = M1, simulating "already pushed" state the merge lands onto.
  git(['update-ref', 'refs/remotes/origin/main', m1], dir);

  git(['checkout', '-q', '-b', 'feature', base], dir);
  writeAndCommit(dir, [
    { hash: 'h1', entityName: 'Base', content: 'c', provenance: {}, timestamp: '2026-01-01T00:00:00.000Z' },
    { hash: 'h3', entityName: 'Three', content: 'c', provenance: {}, timestamp: '2026-01-03T00:00:00.000Z' },
  ], 'F1: add Three');

  git(['checkout', '-q', 'main'], dir);
  try { git(['merge', '--no-commit', '--no-ff', 'feature'], dir); } catch { /* expected: conflicts on the merkle file */ }
  // Anti-pattern resolution: keep ONLY main's side, silently dropping h3.
  fs.writeFileSync(path.join(dir, '.knowledge-graph-merkle.json'), merkle([
    { hash: 'h1', entityName: 'Base', content: 'c', provenance: {}, timestamp: '2026-01-01T00:00:00.000Z' },
    { hash: 'h2', entityName: 'Two', content: 'c', provenance: {}, timestamp: '2026-01-02T00:00:00.000Z' },
  ]));
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'Merge feature into main (drops h3 — simulated incident)'], dir);

  return dir;
}

// Same shape, but resolved CORRECTLY (union of both sides) — nothing dropped.
function repoWithCorrectMerge() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kgsg-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'g@d'], dir);
  git(['config', 'user.name', 'g'], dir);

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(REAL_INTEGRITY_SCRIPT, path.join(dir, 'scripts', 'check-kg-merge-integrity.cjs'));

  const base = writeAndCommit(dir, [{ hash: 'h1', entityName: 'Base', content: 'c', provenance: {}, timestamp: '2026-01-01T00:00:00.000Z' }], 'base');

  const m1 = writeAndCommit(dir, [
    { hash: 'h1', entityName: 'Base', content: 'c', provenance: {}, timestamp: '2026-01-01T00:00:00.000Z' },
    { hash: 'h2', entityName: 'Two', content: 'c', provenance: {}, timestamp: '2026-01-02T00:00:00.000Z' },
  ], 'M1: add Two');
  git(['update-ref', 'refs/remotes/origin/main', m1], dir);

  git(['checkout', '-q', '-b', 'feature', base], dir);
  writeAndCommit(dir, [
    { hash: 'h1', entityName: 'Base', content: 'c', provenance: {}, timestamp: '2026-01-01T00:00:00.000Z' },
    { hash: 'h3', entityName: 'Three', content: 'c', provenance: {}, timestamp: '2026-01-03T00:00:00.000Z' },
  ], 'F1: add Three');

  git(['checkout', '-q', 'main'], dir);
  try { git(['merge', '--no-commit', '--no-ff', 'feature'], dir); } catch { /* expected: conflicts on the merkle file */ }
  // Correct resolution: union of both sides — nothing dropped.
  fs.writeFileSync(path.join(dir, '.knowledge-graph-merkle.json'), merkle([
    { hash: 'h1', entityName: 'Base', content: 'c', provenance: {}, timestamp: '2026-01-01T00:00:00.000Z' },
    { hash: 'h2', entityName: 'Two', content: 'c', provenance: {}, timestamp: '2026-01-02T00:00:00.000Z' },
    { hash: 'h3', entityName: 'Three', content: 'c', provenance: {}, timestamp: '2026-01-03T00:00:00.000Z' },
  ]));
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'Merge feature into main (correct union)'], dir);

  return dir;
}

// Stubs `gh` to unconditionally report KG Guard GREEN. This repo's Bash-cmd
// `gh pr merge` path never actually shells out to `gh` (unlike doxa-cns's
// gate, which has a KG-Guard-verdict fast path there) — this stub exists so
// the test still passes if a future edit adds one, without requiring a real
// network call in CI.
function stubGhAlwaysGreen() {
  const bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghbin-'));
  const script = `#!/bin/bash
args="$*"
case "$args" in
  *"--json statusCheckRollup"*) echo '{"statusCheckRollup":[{"workflowName":"KG Guard","conclusion":"SUCCESS","status":"COMPLETED"}]}'; exit 0 ;;
  *) exit 0 ;;
esac
`;
  fs.writeFileSync(path.join(bindir, 'gh'), script);
  fs.chmodSync(path.join(bindir, 'gh'), 0o755);
  return bindir;
}

function runGate(dir, cmd, ghbin) {
  try {
    execFileSync('bash', [HOOK], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${ghbin}:${process.env.PATH}` },
      input: JSON.stringify({ tool_input: { command: cmd }, cwd: dir }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0 };
  } catch (e) {
    return { status: e.status, stderr: (e.stderr || '').toString() };
  }
}

test('gh pr merge blocks a merge commit that dropped an observation', () => {
  const dir = repoWithDroppedObservation();
  const ghbin = stubGhAlwaysGreen();
  const result = runGate(dir, 'gh pr merge 12 --repo The-Doxa-Way/doxa-discord-bot --squash', ghbin);
  assert.strictEqual(result.status, 2, 'must block a merge commit that dropped an observation');
  assert.match(result.stderr, /dropped knowledge-graph observations/);
  assert.match(result.stderr, /Three/, 'must name the dropped entity');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(ghbin, { recursive: true, force: true });
});

test('gh pr merge passes a correctly-unioned merge (no false positive)', () => {
  const dir = repoWithCorrectMerge();
  const ghbin = stubGhAlwaysGreen();
  const result = runGate(dir, 'gh pr merge 12 --repo The-Doxa-Way/doxa-discord-bot --squash', ghbin);
  assert.strictEqual(result.status, 0, 'a correct union must not be blocked');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(ghbin, { recursive: true, force: true });
});
