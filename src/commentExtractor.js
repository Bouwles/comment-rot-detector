'use strict';

const path = require('path');

// ext -> { language, style }
// style: 'cstyle' (// and /* */), 'python' (# and docstrings), 'hash' (# only)
const LANGUAGES = {
  '.js': { language: 'javascript', style: 'cstyle' },
  '.mjs': { language: 'javascript', style: 'cstyle' },
  '.cjs': { language: 'javascript', style: 'cstyle' },
  '.jsx': { language: 'javascript', style: 'cstyle' },
  '.ts': { language: 'typescript', style: 'cstyle' },
  '.mts': { language: 'typescript', style: 'cstyle' },
  '.cts': { language: 'typescript', style: 'cstyle' },
  '.tsx': { language: 'typescript', style: 'cstyle' },
  '.py': { language: 'python', style: 'python' },
  // Fallback languages — generic comment extraction only.
  '.java': { language: 'java', style: 'cstyle' },
  '.c': { language: 'c', style: 'cstyle' },
  '.h': { language: 'c', style: 'cstyle' },
  '.cpp': { language: 'cpp', style: 'cstyle' },
  '.cc': { language: 'cpp', style: 'cstyle' },
  '.cxx': { language: 'cpp', style: 'cstyle' },
  '.hpp': { language: 'cpp', style: 'cstyle' },
  '.cs': { language: 'csharp', style: 'cstyle' },
  '.go': { language: 'go', style: 'cstyle' },
  '.rs': { language: 'rust', style: 'cstyle' },
  '.php': { language: 'php', style: 'cstyle' },
  '.rb': { language: 'ruby', style: 'hash' }
};

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGES[ext] || null;
}

// Find the index where a line-comment token starts, ignoring tokens inside strings.
// Returns { index, token } or null.
function findLineCommentStart(line, style) {
  const tokens = style === 'cstyle' ? ['//'] : ['#'];
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (style === 'cstyle' && ch === '/' && line[i + 1] === '/') {
      return { index: i, token: '//' };
    }
    if (style !== 'cstyle' && ch === '#') {
      return { index: i, token: '#' };
    }
  }
  return null;
}

// Find a `/*` block-comment start outside strings. Returns index or -1.
function findBlockCommentStart(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && line[i + 1] === '*') return i;
  }
  return -1;
}

function stripCommentText(raw, style) {
  return raw
    .replace(/^\s*\/\*\*?/, '')
    .replace(/\*\/\s*$/, '')
    .replace(/^\s*[rbuRBU]*("""|''')/, '')
    .replace(/("""|''')\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').replace(/^\s*\/\/+\s?/, '').replace(/^\s*#\s?/, ''))
    .join('\n')
    .trim();
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function isBlank(line) {
  return line.trim() === '';
}

// Capture the code block that a leading comment refers to.
// startIdx is 0-based line index where code search begins.
// Returns { startLine, endLine, text } (1-based) or null.
function captureLeadingCode(lines, startIdx, style, excludeRange) {
  let i = startIdx;
  while (i < lines.length && isBlank(lines[i])) i++;
  if (i >= lines.length) return null;
  const startLine = i + 1;
  let endIdx = i;

  if (style === 'python') {
    const base = indentOf(lines[i]);
    const opensBlock = /:\s*(#.*)?$/.test(lines[i]);
    if (opensBlock) {
      let j = i + 1;
      let last = i;
      for (; j < lines.length && j < i + 60; j++) {
        if (isBlank(lines[j])) continue;
        if (indentOf(lines[j]) > base) last = j;
        else break;
      }
      endIdx = last;
    } else {
      endIdx = i; // single statement
    }
  } else {
    // cstyle / hash: brace-aware if braces appear, else a short statement window.
    let braces = 0;
    let sawOpen = false;
    let j = i;
    const max = i + 60;
    for (; j < lines.length && j < max; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          braces++;
          sawOpen = true;
        } else if (ch === '}') braces--;
      }
      if (sawOpen && braces <= 0) {
        endIdx = j;
        break;
      }
      endIdx = j;
      if (!sawOpen) {
        // No block opened yet. Stop at end of a simple statement.
        if (/;\s*$/.test(lines[j]) || j - i >= 3) {
          endIdx = j;
          break;
        }
      }
    }
  }

  const text = sliceText(lines, i, endIdx, excludeRange);
  return { startLine, endLine: endIdx + 1, text };
}

// Join lines i..endIdx (0-based inclusive), skipping any lines in excludeRange (1-based [start,end]).
function sliceText(lines, i, endIdx, excludeRange) {
  const out = [];
  for (let k = i; k <= endIdx && k < lines.length; k++) {
    const lineNo = k + 1;
    if (excludeRange && lineNo >= excludeRange[0] && lineNo <= excludeRange[1]) continue;
    out.push(lines[k]);
  }
  return out.join('\n');
}

function extractComments(content, filePath) {
  const info = detectLanguage(filePath);
  if (!info) return { language: null, style: null, comments: [] };
  const { language, style } = info;
  const lines = content.split(/\r?\n/);
  const comments = [];
  const consumed = new Set(); // line indices already part of a docstring

  // --- Python docstrings (function / class / module) ---
  if (style === 'python') {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const tripleMatch = trimmed.match(/^[rbuRBU]*("""|''')/);
      if (!tripleMatch) continue;
      const quote = tripleMatch[1];
      // Find end of docstring.
      let endIdx = i;
      const afterOpen = trimmed.slice(trimmed.indexOf(quote) + 3);
      if (!afterOpen.includes(quote)) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].includes(quote)) {
            endIdx = j;
            break;
          }
          endIdx = j;
        }
      }
      for (let k = i; k <= endIdx; k++) consumed.add(k);

      // What does this docstring describe? Look upward for a def/class.
      let owner = null;
      for (let p = i - 1; p >= 0 && p >= i - 2; p--) {
        if (isBlank(lines[p])) continue;
        if (/^\s*(async\s+)?def\s+/.test(lines[p]) || /^\s*class\s+/.test(lines[p])) {
          owner = p;
        }
        break;
      }

      const commentText = stripCommentText(lines.slice(i, endIdx + 1).join('\n'), style);
      let linked;
      if (owner !== null) {
        // Link to the owner def/class block, excluding the docstring lines.
        linked = captureLeadingCode(lines, owner, style, [i + 1, endIdx + 1]);
        // captureLeadingCode starts after blanks; force startLine to owner.
        if (linked) linked.startLine = owner + 1;
      } else {
        // Module docstring: link to the next code block below.
        linked = captureLeadingCode(lines, endIdx + 1, style, [i + 1, endIdx + 1]);
      }
      comments.push({
        filePath,
        commentText,
        startLine: i + 1,
        endLine: endIdx + 1,
        linkedCodeStartLine: linked ? linked.startLine : null,
        linkedCodeEndLine: linked ? linked.endLine : null,
        linkedCodeText: linked ? linked.text : '',
        commentType: owner !== null ? 'docstring' : 'module-docstring',
        language
      });
    }
  }

  // --- Line + block comments ---
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const line = lines[i];

    // Block comment /* ... */ (cstyle only)
    if (style === 'cstyle') {
      const bStart = findBlockCommentStart(line);
      if (bStart !== -1) {
        const before = line.slice(0, bStart).trim();
        let endIdx = i;
        if (!line.slice(bStart).includes('*/')) {
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].includes('*/')) {
              endIdx = j;
              break;
            }
            endIdx = j;
          }
        }
        const isJsDoc = line.slice(bStart).startsWith('/**');
        const commentText = stripCommentText(lines.slice(i, endIdx + 1).join('\n'), style);
        const linked = before
          ? { startLine: i + 1, endLine: i + 1, text: before }
          : captureLeadingCode(lines, endIdx + 1, style, [i + 1, endIdx + 1]);
        comments.push({
          filePath,
          commentText,
          startLine: i + 1,
          endLine: endIdx + 1,
          linkedCodeStartLine: linked ? linked.startLine : null,
          linkedCodeEndLine: linked ? linked.endLine : null,
          linkedCodeText: linked ? linked.text : '',
          commentType: isJsDoc ? 'jsdoc' : 'block',
          language
        });
        i = endIdx;
        continue;
      }
    }

    // Line comment // or #
    const lc = findLineCommentStart(line, style);
    if (lc) {
      const before = line.slice(0, lc.index).trim();
      if (before) {
        // Inline comment — links to the code on the same line.
        comments.push({
          filePath,
          commentText: stripCommentText(line.slice(lc.index), style),
          startLine: i + 1,
          endLine: i + 1,
          linkedCodeStartLine: i + 1,
          linkedCodeEndLine: i + 1,
          linkedCodeText: before,
          commentType: 'inline',
          language
        });
        continue;
      }
      // Full-line comment — group consecutive ones into a block.
      let endIdx = i;
      while (
        endIdx + 1 < lines.length &&
        !consumed.has(endIdx + 1) &&
        (() => {
          const next = findLineCommentStart(lines[endIdx + 1], style);
          return next && lines[endIdx + 1].slice(0, next.index).trim() === '';
        })()
      ) {
        endIdx++;
      }
      const commentText = stripCommentText(lines.slice(i, endIdx + 1).join('\n'), style);
      const linked = captureLeadingCode(lines, endIdx + 1, style, [i + 1, endIdx + 1]);
      comments.push({
        filePath,
        commentText,
        startLine: i + 1,
        endLine: endIdx + 1,
        linkedCodeStartLine: linked ? linked.startLine : null,
        linkedCodeEndLine: linked ? linked.endLine : null,
        linkedCodeText: linked ? linked.text : '',
        commentType: 'line',
        language
      });
      i = endIdx;
    }
  }

  comments.sort((a, b) => a.startLine - b.startLine);
  return { language, style, comments };
}

module.exports = { detectLanguage, extractComments, LANGUAGES };
