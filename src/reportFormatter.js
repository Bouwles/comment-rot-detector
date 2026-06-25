'use strict';

const path = require('path');

const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

function relPath(filePath, projectRoot) {
  if (!projectRoot) return filePath;
  const rel = path.relative(projectRoot, path.resolve(filePath));
  return rel.startsWith('..') ? filePath : rel;
}

function formatFinding(f, projectRoot) {
  const pct = Math.round(f.confidence * 100);
  const sev = SEVERITY_LABEL[f.severity] || f.severity;
  const summary = f.codeSummary || {};
  const behaviorBits = [];
  if (summary.asyncBehavior) behaviorBits.push(summary.asyncBehavior);
  if (summary.errorsThrown) behaviorBits.push('throws');
  if (summary.returnsNull) behaviorBits.push('can return null');
  if (summary.mutationBehavior && summary.mutationBehavior.startsWith('mutates')) behaviorBits.push(summary.mutationBehavior);
  const behavior = behaviorBits.length ? behaviorBits.join(', ') : f.reason;

  return [
    'COMMENT ROT DETECTED',
    '',
    `File: ${relPath(f.filePath, projectRoot)}`,
    `Line: ${f.line}`,
    `Severity: ${sev}`,
    `Confidence: ${pct}%`,
    '',
    'Comment:',
    `"${f.commentText.replace(/\s+/g, ' ').trim()}"`,
    '',
    'Current code behavior:',
    behavior,
    '',
    'Why this is stale:',
    f.reason,
    '',
    'Suggested replacement:',
    `"${(f.suggestedComment || '').replace(/\s+/g, ' ').trim()}"`
  ].join('\n');
}

function formatReport(findings, projectRoot) {
  if (!findings.length) {
    return 'Comment Rot Detector: no stale comments found.';
  }
  const blocks = findings.map((f) => formatFinding(f, projectRoot));
  const header =
    findings.length === 1
      ? ''
      : `Comment Rot Detector: ${findings.length} stale comments found.\n\n`;
  return header + blocks.join('\n\n' + '-'.repeat(48) + '\n\n');
}

// Compact JSON the agent / fix command can consume.
function toJSON(findings, projectRoot) {
  return findings.map((f) => ({
    file: relPath(f.filePath, projectRoot),
    line: f.line,
    severity: f.severity,
    confidence: f.confidence,
    commentType: f.commentType,
    isRotten: true,
    reason: f.reason,
    comment: f.commentText.replace(/\s+/g, ' ').trim(),
    suggestedComment: (f.suggestedComment || '').replace(/\s+/g, ' ').trim(),
    linkedCodeStartLine: f.linkedCodeStartLine,
    linkedCodeEndLine: f.linkedCodeEndLine
  }));
}

module.exports = { formatReport, formatFinding, toJSON };
