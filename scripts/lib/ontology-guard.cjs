/**
 * ontology-guard.cjs — reject off-ontology entity types AT WRITE TIME.
 *
 * Ported from doxa-cns / openclaw. .cjs extension because this repo's
 * package.json sets "type": "module" — plain .js files are ES modules there
 * and require() would throw.
 *
 * doxa-discord-bot has no local ontology of its own — it validates against
 * doxa-cns's shared ontology/entity-types.yaml (found via
 * DOXA_ONTOLOGY_PATH or the sibling-repo path below). FAIL-OPEN on a missing
 * ontology, deliberately: a checkout with no doxa-cns beside it must still be
 * able to kg-save (the kg-save gate blocks landings without one). It warns
 * loudly instead — an unreadable ontology is a check outage, not a licence to
 * invent types.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// When DOXA_ONTOLOGY_PATH is set it is AUTHORITATIVE — no fallback to the
// discovered paths.
const ONTOLOGY_PATHS = process.env.DOXA_ONTOLOGY_PATH
  ? [process.env.DOXA_ONTOLOGY_PATH]
  : [
      path.join(__dirname, '..', '..', 'ontology', 'entity-types.yaml'),
      path.join(os.homedir(), 'Documents/Projects/doxa-cns/ontology/entity-types.yaml'),
    ];

/**
 * Minimal YAML reader for this one file's shape (`kinds:` mapping and
 * `aliases:` mapping). Deliberately dependency-free.
 */
function parseEntityTypes(text) {
  const kinds = new Set();
  const aliases = new Map();
  let section = null;
  let sectionIndent = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || /^\s*#/.test(line)) continue;
    if (/^[A-Za-z_]+:/.test(line)) {
      section = line.split(':')[0];
      sectionIndent = null;
      continue;
    }
    const m = line.match(/^(\s+)(.+?)\s*:(.*)$/);
    if (!m) continue;
    const [, indent, rawKey, rest] = m;
    const key = rawKey.trim().replace(/^["']|["']$/g, '');
    if (!key || key.startsWith('-')) continue; // list item, not a mapping key
    if (sectionIndent === null) sectionIndent = indent.length;
    if (indent.length !== sectionIndent) continue; // a child of the entry above
    if (section === 'kinds') kinds.add(key);
    else if (section === 'aliases') {
      const target = rest.trim().replace(/^["']|["']$/g, '');
      if (target) aliases.set(key, target);
    }
  }
  return { kinds, aliases };
}

let _cache = null;

/** Load the ontology, or null when it genuinely cannot be read. */
function loadOntology() {
  if (_cache !== null) return _cache;
  for (const p of ONTOLOGY_PATHS) {
    try {
      const parsed = parseEntityTypes(fs.readFileSync(p, 'utf8'));
      if (parsed.kinds.size > 0) {
        _cache = parsed;
        return _cache;
      }
    } catch {
      /* try the next candidate */
    }
  }
  _cache = null;
  return null;
}

/** Levenshtein, small and local — used only to suggest a near-miss type. */
function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function suggest(type, kinds) {
  let best = null;
  let bestD = Infinity;
  for (const k of kinds) {
    const d = distance(type, k);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return bestD <= Math.max(3, Math.floor(type.length / 2)) ? best : null;
}

/**
 * Check one entity type.
 * Returns { ok: true, type } with aliases already resolved, or
 * { ok: false, message } describing exactly what to do instead.
 */
function checkEntityType(entityType) {
  const ontology = loadOntology();
  if (!ontology) {
    return {
      ok: true,
      type: entityType,
      warning:
        'ontology not readable (looked for doxa-cns/ontology/entity-types.yaml) — entity type NOT validated',
    };
  }
  if (!entityType) {
    return {
      ok: false,
      message:
        'entityType is required. Pass --type <Kind>. Valid kinds:\n  ' +
        [...ontology.kinds].sort().join(', '),
    };
  }
  if (ontology.kinds.has(entityType)) return { ok: true, type: entityType };

  if (ontology.aliases.has(entityType)) {
    const target = ontology.aliases.get(entityType);
    return { ok: true, type: target, rewrittenFrom: entityType };
  }

  const near = suggest(entityType, ontology.kinds);
  return {
    ok: false,
    message:
      `entityType "${entityType}" is not in the ontology.` +
      (near ? `\n  Did you mean: ${near}?` : '') +
      '\n  Valid kinds: ' +
      [...ontology.kinds].sort().join(', ') +
      '\n\n  If this genuinely needs a NEW kind, that is a blast-radius change:' +
      '\n  edit doxa-cns/ontology/entity-types.yaml (or add an alias) and take it' +
      '\n  through the ontology-reviewer gate. Do not invent a type here.',
  };
}

module.exports = { checkEntityType, parseEntityTypes, loadOntology };
