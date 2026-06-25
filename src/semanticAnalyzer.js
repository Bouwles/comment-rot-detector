'use strict';

// Layer 1: deterministic heuristics. Each check is GATED on the comment actually
// making the relevant claim, then looks for a contradiction in the linked code.
// This keeps false positives low: no claim -> no finding.
//
// Layer 2: summarizeCode() produces a lightweight behavioral summary used in the
// report and handed to the comment-rot-reviewer agent for deeper (Layer 3) review.

const FORMAT_WORDS = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif', 'pdf', 'heic', 'avif', 'ico'];
const TIME_UNITS = {
  ms: 1 / 1000,
  millisecond: 1 / 1000,
  milliseconds: 1 / 1000,
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400
};

const MUTATION_OPS = {
  cstyle: ['.push(', '.splice(', '.pop(', '.shift(', '.unshift(', '.sort(', '.reverse(', '.fill(', '.copywithin(', 'object.assign(', 'delete '],
  python: ['.append(', '.extend(', '.insert(', '.pop(', '.remove(', '.sort(', '.reverse(', '.clear(', '.update(', 'del ']
};

function humanizeDuration(seconds) {
  if (seconds % 86400 === 0) return plural(seconds / 86400, 'day');
  if (seconds % 3600 === 0) return plural(seconds / 3600, 'hour');
  if (seconds % 60 === 0) return plural(seconds / 60, 'minute');
  if (seconds < 1) return plural(Math.round(seconds * 1000), 'millisecond');
  return plural(seconds, 'second');
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

// Parse the first "<number> <unit>" duration claim from text. Returns { seconds, raw } or null.
function parseCommentDuration(text) {
  const re = /(\d+(?:\.\d+)?)\s*(milliseconds?|millisecond|ms|seconds?|secs?|sec|minutes?|mins?|min|hours?|hrs?|hr|days?|day)\b/i;
  const m = text.match(re);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const factor = TIME_UNITS[unit];
  if (!factor) return null;
  return { seconds: n * factor, raw: m[0] };
}

// Evaluate the first multiplicative product or notable bare number in code.
// Returns { seconds } or null. Detects ms by presence of a 1000 factor.
function parseCodeDuration(code) {
  // products like 30 * 60, 5 * 60 * 1000, 1000 * 60 * 5
  const prod = code.match(/(\d+)\s*\*\s*(\d+)(?:\s*\*\s*(\d+))?(?:\s*\*\s*(\d+))?/);
  if (prod) {
    const nums = prod.slice(1).filter(Boolean).map(Number);
    const value = nums.reduce((a, b) => a * b, 1);
    const isMs = nums.includes(1000);
    return { seconds: isMs ? value / 1000 : value };
  }
  // bare number next to a time keyword
  const bare = code.match(/\b(\d{3,})\b/);
  if (bare && /ttl|timeout|expire|expiry|delay|interval|duration|cache|ms|milliseconds?/i.test(code)) {
    const n = Number(bare[1]);
    const isMs = /ms|milliseconds?/i.test(code) || n >= 1000;
    return { seconds: isMs ? n / 1000 : n };
  }
  return null;
}

function extractEqualityValues(code) {
  const values = new Set();
  const re = /(?:===?|==)\s*["'`]([^"'`]+)["'`]|["'`]([^"'`]+)["'`]\s*(?:===?|==)/g;
  let m;
  while ((m = re.exec(code))) {
    const v = (m[1] || m[2] || '').trim();
    if (v) values.add(v);
  }
  return [...values];
}

function extractFormats(text) {
  const found = new Set();
  const lower = text.toLowerCase();
  for (const f of FORMAT_WORDS) {
    const re = new RegExp('\\b' + f + '\\b');
    if (re.test(lower)) found.add(f === 'jpg' ? 'jpeg' : f === 'tif' ? 'tiff' : f);
  }
  return [...found];
}

function countLoops(code, style) {
  if (style === 'python') {
    return (code.match(/^\s*(for|while)\b/gm) || []).length;
  }
  return (code.match(/\b(for|while)\s*\(/g) || []).length;
}

function hasNestedLoop(code, style) {
  // Approximate: a loop whose indented body contains another loop.
  const lines = code.split('\n');
  const loopRe = style === 'python' ? /^(\s*)(for|while)\b/ : /^(\s*).*\b(for|while)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(loopRe);
    if (!m) continue;
    const baseIndent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      const indent = lines[j].match(/^(\s*)/)[1].length;
      if (indent <= baseIndent) break;
      if (loopRe.test(lines[j])) return true;
    }
  }
  return false;
}

function summarizeCode(code, style) {
  const lower = code.toLowerCase();
  const mutationOps = (MUTATION_OPS[style] || MUTATION_OPS.cstyle).filter((op) => lower.includes(op));
  const throwsErr = style === 'python' ? /\braise\b/.test(code) : /\bthrow\b/.test(code);
  const returnsNull = /\breturn\s+(null|undefined|none)\b/i.test(code);
  const isAsync = /\basync\b/.test(code) || /\bawait\b/.test(code) || /\.then\s*\(/.test(code) || /Promise/.test(code);
  const constants = [...new Set((code.match(/\b\d+(?:\.\d+)?\b/g) || []))].slice(0, 8);
  return {
    mutationBehavior: mutationOps.length ? 'mutates input (' + mutationOps.join(', ') + ')' : 'no obvious mutation',
    errorsThrown: throwsErr,
    returnsNull,
    asyncBehavior: isAsync ? 'async' : 'synchronous',
    loops: countLoops(code, style),
    nestedLoop: hasNestedLoop(code, style),
    notableConstants: constants,
    equalityValues: extractEqualityValues(code)
  };
}

// ---- Individual heuristic checks. Each returns a finding object or null. ----

function checkSortDirection(comment, code) {
  const c = comment.toLowerCase();
  if (!/\bsort|\bascending|\bdescending|\border\b/.test(c)) return null;
  const wantsAsc = /\bascending\b/.test(c) || /\blowest to highest\b/.test(c) || /\bsmallest to largest\b/.test(c);
  const wantsDesc = /\bdescending\b/.test(c) || /\bhighest to lowest\b/.test(c) || /\blargest to smallest\b/.test(c);
  if (!wantsAsc && !wantsDesc) return null;
  const desc = /\bb\s*-\s*a\b/.test(code) || /\.reverse\(\)/.test(code) || /\bsort\([^)]*>\s*[^)]*\)/.test(code) && /\ba\s*>\s*b/.test(code);
  const asc = /\ba\s*-\s*b\b/.test(code);
  if (wantsAsc && desc && !asc) {
    return finding(0.9, 'high', 'Comment says the result is sorted ascending, but the comparator (b - a / reverse) sorts descending.', comment.replace(/ascending/i, 'descending'));
  }
  if (wantsDesc && asc && !desc) {
    return finding(0.9, 'high', 'Comment says the result is sorted descending, but the comparator (a - b) sorts ascending.', comment.replace(/descending/i, 'ascending'));
  }
  return null;
}

function checkDuration(comment, code) {
  const cd = parseCommentDuration(comment);
  if (!cd) return null;
  const kd = parseCodeDuration(code);
  if (!kd) return null;
  // tolerate tiny rounding
  if (Math.abs(cd.seconds - kd.seconds) < 0.001) return null;
  const codeHuman = humanizeDuration(kd.seconds);
  const suggested = comment.replace(cd.raw, codeHuman);
  return finding(
    0.9,
    'high',
    `Comment states ${cd.raw} (${humanizeDuration(cd.seconds)}), but the code computes ${codeHuman}.`,
    suggested
  );
}

function checkPermissionExpansion(comment, code) {
  const c = comment.toLowerCase();
  const exclusivity = /\bonly\b|\bjust\b|\bsolely\b|\bexclusively\b/.test(c);
  const values = extractEqualityValues(code);
  const hasOr = /\|\||\bor\b/.test(code);
  if (!exclusivity || !hasOr || values.length < 2) return null;
  // Which equality values are NOT mentioned in the comment?
  const missing = values.filter((v) => !c.includes(v.toLowerCase()));
  const mentioned = values.filter((v) => c.includes(v.toLowerCase()));
  if (mentioned.length >= 1 && missing.length >= 1) {
    return finding(
      0.88,
      'high',
      `Comment claims an exclusive condition ("${mentioned.join(', ')}"), but the code also matches: ${missing.join(', ')}. The condition was broadened.`,
      `Returns true when the value is one of: ${values.join(', ')}.`
    );
  }
  return null;
}

function checkFileFormats(comment, code) {
  const c = comment.toLowerCase();
  if (!/\bonly\b|\bjust\b|\bsolely\b|\bexclusively\b|\bsupports?\b|\baccepts?\b/.test(c)) return null;
  const commentFormats = extractFormats(comment);
  const codeFormats = extractFormats(code);
  if (commentFormats.length === 0 || codeFormats.length === 0) return null;
  const extra = codeFormats.filter((f) => !commentFormats.includes(f));
  const exclusivity = /\bonly\b|\bjust\b|\bsolely\b|\bexclusively\b/.test(c);
  if (extra.length >= 1 && (exclusivity || codeFormats.length > commentFormats.length)) {
    return finding(
      exclusivity ? 0.86 : 0.78,
      exclusivity ? 'high' : 'medium',
      `Comment lists formats [${commentFormats.join(', ')}], but the code also handles: ${extra.join(', ')}.`,
      `Supports ${codeFormats.join(', ')}.`
    );
  }
  return null;
}

function checkThrowsVsReturn(comment, code, style) {
  const c = comment.toLowerCase();
  const claimsThrow = /\bthrows?\b|\braises?\b|\bthrow an? error\b|\bwill throw\b/.test(c);
  if (!claimsThrow) return null;
  const codeThrows = style === 'python' ? /\braise\b/.test(code) : /\bthrow\b/.test(code);
  const codeReturnsNull = /\breturn\s+(null|undefined|none)\b/i.test(code);
  if (!codeThrows && codeReturnsNull) {
    return finding(
      0.85,
      'high',
      'Comment says this throws/raises on the error path, but the code now returns null/None instead of throwing.',
      comment.replace(/throws?|raises?/i, 'returns null')
    );
  }
  return null;
}

function checkMutation(comment, code, style) {
  const c = comment.toLowerCase();
  const claimsNoMutation = /\bdoes not mutate\b|\bdoesn'?t mutate\b|\bnon-?mutating\b|\bwithout (modifying|mutating)\b|\bimmutable\b|\bpure function\b|\bdoes not modify\b|\bdoesn'?t modify\b/.test(c);
  if (!claimsNoMutation) return null;
  const ops = (MUTATION_OPS[style] || MUTATION_OPS.cstyle).filter((op) => code.toLowerCase().includes(op));
  // direct index / property assignment
  const directAssign = /\b\w+\s*\[[^\]]+\]\s*=(?!=)/.test(code) || /\b\w+\.\w+\s*=(?!=)/.test(code);
  if (ops.length || directAssign) {
    const how = ops.length ? ops.join(', ') : 'direct assignment';
    return finding(
      0.82,
      'high',
      `Comment claims the input is not mutated, but the code mutates it (${how}).`,
      comment.replace(/does not mutate|doesn'?t mutate|does not modify|doesn'?t modify|non-?mutating|immutable|pure function/i, 'mutates the input')
    );
  }
  return null;
}

function checkAsync(comment, code) {
  const c = comment.toLowerCase();
  const claimsSync = /\bsynchronous\b|\bsynchronously\b|\bblocking\b|\bnot async\b/.test(c);
  const claimsAsync = /\basynchronous\b|\basynchronously\b|\breturns a promise\b/.test(c);
  const isAsync = /\basync\b/.test(code) || /\bawait\b/.test(code) || /\.then\s*\(/.test(code) || /Promise/.test(code);
  if (claimsSync && isAsync) {
    return finding(0.78, 'medium', 'Comment says this is synchronous, but the code is async (uses async/await or a Promise).', comment.replace(/synchronous(ly)?|blocking/i, 'asynchronous'));
  }
  if (claimsAsync && !isAsync) {
    return finding(0.72, 'medium', 'Comment says this is asynchronous / returns a promise, but the code is synchronous.', comment);
  }
  return null;
}

function checkComplexity(comment, code, style) {
  const c = comment.toLowerCase();
  const claimsLinear = /o\(n\)|\blinear time\b|\blinear\b/.test(c);
  const claimsConstant = /o\(1\)|\bconstant time\b/.test(c);
  if (claimsLinear && hasNestedLoop(code, style)) {
    return finding(0.75, 'medium', 'Comment claims O(n) / linear time, but the code contains a nested loop (likely O(n²) or worse).', comment.replace(/o\(n\)/i, 'O(n²)'));
  }
  if (claimsConstant && countLoops(code, style) >= 1) {
    return finding(0.75, 'medium', 'Comment claims O(1) / constant time, but the code contains a loop.', comment.replace(/o\(1\)/i, 'O(n)'));
  }
  return null;
}

function checkDefaultValue(comment, code) {
  const c = comment.toLowerCase();
  const m = c.match(/\b(?:default(?:s to| is| of)?|defaults to)\s+(?:to\s+)?(\d+(?:\.\d+)?)/);
  if (!m) return null;
  // Skip if this is a duration claim (handled by checkDuration).
  if (parseCommentDuration(comment)) return null;
  const commentVal = parseFloat(m[1]);
  const ret = code.match(/\breturn\s+(\d+(?:\.\d+)?)/) || code.match(/=\s*(\d+(?:\.\d+)?)\b/);
  if (!ret) return null;
  const codeVal = parseFloat(ret[1]);
  if (commentVal === codeVal) return null;
  return finding(
    0.72,
    'medium',
    `Comment says the default is ${commentVal}, but the code uses ${codeVal}.`,
    comment.replace(String(commentVal), String(codeVal))
  );
}

function finding(confidence, severity, reason, suggestedComment) {
  return { isRotten: true, confidence, severity, reason, suggestedComment };
}

const CHECKS = [
  (cm, code) => checkSortDirection(cm, code),
  (cm, code) => checkDuration(cm, code),
  (cm, code) => checkPermissionExpansion(cm, code),
  (cm, code) => checkFileFormats(cm, code),
  (cm, code, style) => checkThrowsVsReturn(cm, code, style),
  (cm, code, style) => checkMutation(cm, code, style),
  (cm, code) => checkAsync(cm, code),
  (cm, code, style) => checkComplexity(cm, code, style),
  (cm, code) => checkDefaultValue(cm, code)
];

// Analyze one linked comment. Returns the single strongest finding (or null).
function analyzeComment(comment, style) {
  const text = comment.commentText || '';
  const code = comment.linkedCodeText || '';
  if (!text.trim() || !code.trim()) return null;
  let best = null;
  for (const check of CHECKS) {
    let res = null;
    try {
      res = check(text, code, style);
    } catch (_) {
      res = null;
    }
    if (res && (!best || res.confidence > best.confidence)) best = res;
  }
  if (!best) return null;
  return Object.assign(
    {
      line: comment.startLine,
      commentText: text,
      commentType: comment.commentType,
      filePath: comment.filePath,
      linkedCodeStartLine: comment.linkedCodeStartLine,
      linkedCodeEndLine: comment.linkedCodeEndLine,
      codeSummary: summarizeCode(code, style)
    },
    best
  );
}

module.exports = { analyzeComment, summarizeCode, parseCommentDuration, parseCodeDuration, humanizeDuration };
