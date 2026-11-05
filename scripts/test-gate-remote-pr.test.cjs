// test-gate-remote-pr.test.cjs — pins the REMOTE check of
// .claude/hooks/test-gate.sh (canonical fleet gate, doxa-cns fleet/gates/).
//
// Why: a PR being merged need not exist in this checkout (another session's
// branch, a fresh clone, a worktree already removed). Then the only honest
// answer to "does this chunk change code with no test?" is GitHub's own file
// list for that PR. The old hand copy of this hook built the repo for that
// lookup from a line holding shell-expanded junk
// (`cmd_pr_repo="${flag_repo:-20 20 12 61 … repo_slug_of "")}"`), so for a
// plain `gh pr merge <N>` (no --repo) it asked GitHub about a repo that does
// not exist, got nothing, and let an untested code PR merge. This test fails
// on that copy and passes on the generated one.
//
// Drives the REAL hook with a stubbed `gh` that answers ONLY for the real
// repo slug. Run: node --test scripts/test-gate-remote-pr.test.cjs

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.resolve(__dirname, '../.claude/hooks/test-gate.sh');
const SLUG = 'The-Doxa-Way/doxa-discord-bot';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// A checkout of this repo with NOTHING landing locally (HEAD = origin/main),
// so only the remote PR file list can show what the merge brings in.
function cleanCheckout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testgate-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'g@d'], dir);
  git(['config', 'user.name', 'g'], dir);
  git(['remote', 'add', 'origin', `https://github.com/${SLUG}.git`], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'base'], dir);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir);
  return dir;
}

// gh answers `pr diff 7 --repo <SLUG>` with `files`; every other call
// (including `pr view` for the head SHA) returns nothing, as when the PR's
// head is not resolvable.
function stubGh(files) {
  const bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghbin-'));
  fs.writeFileSync(path.join(bindir, 'gh'), `#!/bin/bash
case "$*" in
  *"pr diff 7 --repo ${SLUG} --name-only"*) printf '%s\\n' ${files.map((f) => `'${f}'`).join(' ')}; exit 0 ;;
  *) exit 0 ;;
esac
`);
  fs.chmodSync(path.join(bindir, 'gh'), 0o755);
  return bindir;
}

function runGate(dir, bindir) {
  const r = spawnSync('bash', [HOOK], {
    cwd: dir,
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { command: 'gh pr merge 7 --squash' }, cwd: dir }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${bindir}:${process.env.PATH}` },
  });
  return { code: r.status, stderr: r.stderr };
}

test('a remote PR that changes code with no test is blocked (repo taken from origin)', () => {
  const dir = cleanCheckout();
  const bindir = stubGh(['src/commands/word.ts']);
  const r = runGate(dir, bindir);
  assert.strictEqual(r.code, 2, 'untested code must not merge just because its branch is not local');
  assert.match(r.stderr, /src\/commands\/word\.ts/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bindir, { recursive: true, force: true });
});

test('the same remote PR with a test change passes', () => {
  const dir = cleanCheckout();
  const bindir = stubGh(['src/commands/word.ts', 'src/commands/word.test.ts']);
  const r = runGate(dir, bindir);
  assert.strictEqual(r.code, 0, r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bindir, { recursive: true, force: true });
});
