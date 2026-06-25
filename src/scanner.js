'use strict';

const fs = require('fs');
const path = require('path');
const { detectLanguage, extractComments } = require('./commentExtractor');
const { analyzeComment } = require('./semanticAnalyzer');
const { getChangedLines } = require('./diffAnalyzer');
const { meetsSeverity } = require('./config');

const NEAR_WINDOW = 3; // a comment is "near a change" within this many lines

function isIgnored(filePath, projectRoot, patterns) {
  const rel = path.relative(projectRoot, path.resolve(filePath)).split(path.sep).join('/');
  const segments = rel.split('/');
  const base = segments[segments.length - 1];
  for (const pat of patterns) {
    if (pat.includes('*')) {
      const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (re.test(base)) return true;
    } else if (segments.includes(pat) || base === pat) {
      return true;
    }
  }
  return false;
}

function isSupported(filePath, languages) {
  const info = detectLanguage(filePath);
  if (!info) return false;
  if (!languages || !languages.length) return true;
  // Always allow the fallback languages; gate only the "primary" three by config.
  const primary = ['javascript', 'typescript', 'python'];
  if (primary.includes(info.language)) return languages.includes(info.language);
  return true;
}

function commentNearChange(comment, changedLines) {
  if (!changedLines) return true; // whole-file scan
  const lo = Math.min(comment.startLine, comment.linkedCodeStartLine || comment.startLine) - NEAR_WINDOW;
  const hi = Math.max(comment.endLine, comment.linkedCodeEndLine || comment.endLine) + NEAR_WINDOW;
  for (const ln of changedLines) {
    if (ln >= lo && ln <= hi) return true;
  }
  return false;
}

// Scan a single file. opts: { config, changedLines (Set|null|undefined), wholeFile }
function scanFile(filePath, opts) {
  opts = opts || {};
  const config = opts.config;
  const projectRoot = config.projectRoot;
  const findings = [];

  if (config.mode === 'off' || config.enabled === false) return findings;
  if (!fs.existsSync(filePath)) return findings;
  if (isIgnored(filePath, projectRoot, config.ignoredPaths)) return findings;
  if (!isSupported(filePath, config.languages)) return findings;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return findings;
  }

  const wholeFile = opts.wholeFile || config.scanWholeFile;
  let changedLines = opts.changedLines;
  if (changedLines === undefined) {
    changedLines = wholeFile ? null : getChangedLines(filePath, projectRoot);
  }
  if (wholeFile) changedLines = null;

  const { style, comments } = extractComments(content, filePath);
  for (const comment of comments) {
    if (!commentNearChange(comment, changedLines)) continue;
    const result = analyzeComment(comment, style);
    if (!result) continue;
    if (result.confidence < config.minConfidence) continue;
    if (!meetsSeverity(result.severity, config.minSeverity)) continue;
    findings.push(result);
  }
  return findings;
}

function scanFiles(filePaths, opts) {
  const all = [];
  for (const fp of filePaths) {
    for (const f of scanFile(fp, opts)) all.push(f);
  }
  return all;
}

module.exports = { scanFile, scanFiles, isIgnored, isSupported };
