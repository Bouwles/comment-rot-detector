'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Returns a Set of changed (new-file) line numbers, or null meaning "no diff
// info available — scan the whole file". After computing, refreshes the cache
// snapshot so the next edit can be diffed even without git.
function getChangedLines(filePath, projectRoot) {
  const abs = path.resolve(filePath);
  const gitLines = tryGitDiff(abs, projectRoot);
  // Always refresh snapshot for the cache fallback path.
  let cacheLines = null;
  try {
    cacheLines = updateSnapshotAndDiff(abs, projectRoot);
  } catch (_) {
    cacheLines = null;
  }
  if (gitLines && gitLines.size) return gitLines;
  if (gitLines && gitLines.size === 0) {
    // git knows the file and reports no changes -> nothing to scan.
    return new Set();
  }
  // git unavailable/untracked: use cache diff (null = first time = whole file).
  return cacheLines;
}

function tryGitDiff(absFile, projectRoot) {
  const variants = [
    ['diff', '--unified=0', '--', absFile],
    ['diff', '--cached', '--unified=0', '--', absFile],
    ['diff', '--unified=0', 'HEAD', '--', absFile]
  ];
  let sawGit = false;
  const changed = new Set();
  for (const args of variants) {
    let out;
    try {
      out = execFileSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      sawGit = true;
    } catch (_) {
      continue;
    }
    for (const ln of parseHunkLines(out)) changed.add(ln);
  }
  if (!sawGit) return null;
  if (changed.size === 0 && !isTracked(absFile, projectRoot)) {
    // Untracked (e.g. a just-created file): git has no baseline. Let the caller
    // fall back to the cache snapshot / whole-file scan instead of skipping.
    return null;
  }
  return changed;
}

function isTracked(absFile, projectRoot) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', absFile], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Parse @@ -a,b +c,d @@ headers -> new-file line numbers.
function parseHunkLines(diff) {
  const lines = [];
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = re.exec(diff))) {
    const start = parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
    for (let i = 0; i < Math.max(count, 1); i++) lines.push(start + i);
  }
  return lines;
}

function cacheDir(projectRoot) {
  return path.join(projectRoot, '.comment-rot', 'cache');
}

function snapshotPath(absFile, projectRoot) {
  const hash = crypto.createHash('sha1').update(absFile).digest('hex').slice(0, 16);
  return path.join(cacheDir(projectRoot), hash + '.snapshot');
}

// Compare current file content with the cached snapshot, then overwrite the
// snapshot. Returns a Set of changed line numbers, or null if no prior snapshot.
function updateSnapshotAndDiff(absFile, projectRoot) {
  if (!fs.existsSync(absFile)) return null;
  const current = fs.readFileSync(absFile, 'utf8');
  const snapPath = snapshotPath(absFile, projectRoot);
  let changed = null;
  if (fs.existsSync(snapPath)) {
    const prev = fs.readFileSync(snapPath, 'utf8');
    changed = naiveLineDiff(prev, current);
  }
  fs.mkdirSync(cacheDir(projectRoot), { recursive: true });
  fs.writeFileSync(snapPath, current);
  return changed;
}

// Cheap line-level diff: mark lines that differ from the previous version.
function naiveLineDiff(prev, current) {
  const a = prev.split(/\r?\n/);
  const b = current.split(/\r?\n/);
  const changed = new Set();
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) changed.add(i + 1);
  }
  return changed;
}

module.exports = { getChangedLines, parseHunkLines };
