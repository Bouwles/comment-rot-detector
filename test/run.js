'use strict';

// Self-check: scan the fixtures and assert the detector flags the stale ones,
// keeps quiet on the valid ones, and reports the expected kinds. Pure asserts,
// no framework. Run: node test/run.js

const assert = require('assert');
const path = require('path');
const { loadConfig } = require('../src/config');
const { scanFile } = require('../src/scanner');

const root = path.join(__dirname, '..');
const config = Object.assign(loadConfig(root), { projectRoot: root });

function scan(rel) {
  // wholeFile so the test doesn't depend on git diff state.
  return scanFile(path.join(root, rel), { config, wholeFile: true });
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  - ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL  - ' + name + '\n        ' + e.message);
  }
}

// --- Stale JS fixture ---
const staleJs = scan('test-fixtures/stale-comment.js');
const jsReasons = staleJs.map((f) => f.reason.toLowerCase());

check('stale JS: flags at least 5 findings', () => {
  assert(staleJs.length >= 5, `expected >=5, got ${staleJs.length}: ${jsReasons.join(' | ')}`);
});
check('stale JS: catches permission expansion (admin -> +moderator)', () => {
  assert(jsReasons.some((r) => r.includes('exclusive') || r.includes('broadened')), 'no permission finding');
});
check('stale JS: catches sort direction (ascending vs b-a)', () => {
  assert(jsReasons.some((r) => r.includes('ascending') || r.includes('descending')), 'no sort finding');
});
check('stale JS: catches throws-vs-null', () => {
  assert(jsReasons.some((r) => r.includes('throw') && r.includes('null')), 'no throws/null finding');
});
check('stale JS: catches file formats (JPEG only vs +png)', () => {
  assert(jsReasons.some((r) => r.includes('format')), 'no format finding');
});
check('stale JS: catches mutation (does not mutate vs push)', () => {
  assert(jsReasons.some((r) => r.includes('mutat')), 'no mutation finding');
});
check('stale JS: catches duration (5 minutes vs 30*60)', () => {
  assert(jsReasons.some((r) => r.includes('minute')), 'no duration finding');
});

// --- Valid JS fixture: zero false positives ---
const validJs = scan('test-fixtures/valid-comment.js');
check('valid JS: zero findings (no false positives)', () => {
  assert.strictEqual(validJs.length, 0, 'false positives: ' + validJs.map((f) => `L${f.line} ${f.reason}`).join(' | '));
});

// --- Stale Python fixture ---
const stalePy = scan('test-fixtures/stale-python.py');
const pyReasons = stalePy.map((f) => f.reason.toLowerCase());
check('stale PY: flags at least 3 findings', () => {
  assert(stalePy.length >= 3, `expected >=3, got ${stalePy.length}: ${pyReasons.join(' | ')}`);
});
check('stale PY: catches docstring duration (5 minutes vs 30*60)', () => {
  assert(pyReasons.some((r) => r.includes('minute')), 'no python duration finding');
});
check('stale PY: catches O(n) vs nested loop', () => {
  assert(pyReasons.some((r) => r.includes('nested') || r.includes('o(n')), 'no python complexity finding');
});
check('stale PY: catches mutation (without modifying vs append)', () => {
  assert(pyReasons.some((r) => r.includes('mutat')), 'no python mutation finding');
});

console.log('');
if (failures) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('All checks passed.');
