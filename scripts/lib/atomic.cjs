/**
 * atomic.cjs — crash-safe file writes (tmp + fsync + rename).
 *
 * Ported from doxa-cns / openclaw. .cjs extension because this repo's
 * package.json sets "type": "module" — plain .js files are ES modules there
 * and require() would throw; .cjs forces CommonJS regardless.
 *
 * Replaces direct fs.writeFileSync for durable full-file overwrites. A torn
 * writeFileSync corrupts the WHOLE file; tmp+rename gives atomicity (readers
 * never see a partial file) and the fsync gives durability (survives kill -9
 * / power loss).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let counter = 0;

/**
 * Atomically write `contents` to `filePath`. Creates parent dirs as needed.
 * @param {string} filePath
 * @param {string|Buffer} contents
 * @param {Object} [opts]
 * @param {() => boolean} [opts.precheck] Optional guard run AFTER the tmp file
 *   is fsync'd but BEFORE the rename. Return false to abort: the tmp file is
 *   removed and `filePath` is left untouched, and an Error (with
 *   `.precheckFailed = true`) is thrown instead of completing the rename.
 * @param {string} [opts.precheckMessage] Error message when precheck fails.
 */
function atomicWrite(filePath, contents, opts = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Unique tmp name: pid + monotonic counter avoids collision when a single
  // process writes several files.
  const tmp = `${filePath}.tmp.${process.pid}.${counter++}`;

  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  if (typeof opts.precheck === 'function') {
    let precheckOk;
    try {
      precheckOk = opts.precheck();
    } catch (precheckErr) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best effort cleanup */
      }
      throw precheckErr;
    }
    if (!precheckOk) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best effort cleanup */
      }
      const err = new Error(opts.precheckMessage || `atomicWrite: precheck failed for ${filePath}, write aborted`);
      err.precheckFailed = true;
      throw err;
    }
  }

  fs.renameSync(tmp, filePath);

  // Best-effort directory fsync so the rename survives power loss. Not all
  // platforms/filesystems support fsync on a directory fd — ignore failures.
  try {
    const dfd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dfd);
    } finally {
      fs.closeSync(dfd);
    }
  } catch {
    /* directory fsync is best-effort */
  }
}

/** Convenience: atomically write a pretty-printed JSON object. */
function atomicWriteJSON(filePath, obj) {
  atomicWrite(filePath, JSON.stringify(obj, null, 2));
}

/** sha256 hex of a string/Buffer — the content fingerprint used by
 *  atomicWriteGuarded's concurrent-writer precheck. */
function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * atomicWrite that ABORTS (throws, with `.precheckFailed = true`) when
 * `filePath`'s current on-disk content no longer hashes to `expectedHash` —
 * i.e. a concurrent external writer changed the file between the caller's read
 * and this write. Pass `expectedHash = hashContent(rawContentTheCallerRead)`.
 */
function atomicWriteGuarded(filePath, contents, expectedHash, precheckMessage) {
  atomicWrite(filePath, contents, {
    precheck: () => {
      let current;
      try {
        current = fs.readFileSync(filePath, 'utf8');
      } catch {
        return false; // vanished/unreadable — treat as changed, don't clobber
      }
      return hashContent(current) === expectedHash;
    },
    precheckMessage,
  });
}

module.exports = { atomicWrite, atomicWriteJSON, hashContent, atomicWriteGuarded };
