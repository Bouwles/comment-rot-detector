'use strict';

// PostToolUse hook (matcher: Edit|MultiEdit|Write).
// Reads Claude Code hook JSON from stdin, scans the edited file's changed
// regions for comment rot, and surfaces a report. Non-blocking by default:
// any error -> exit 0 so Claude's workflow is never interrupted.

const path = require('path');

function safeExit(code) {
  process.exit(code);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(data);
    };
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => (data += c));
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch (_) {
      finish();
    }
    // Guard: if stdin never closes, don't hang the hook.
    setTimeout(finish, 4000).unref();
  });
}

function extractFilePaths(payload) {
  const input = payload.tool_input || payload.toolInput || {};
  const paths = [];
  if (input.file_path) paths.push(input.file_path);
  if (input.filePath) paths.push(input.filePath);
  // MultiEdit may carry edits[] but file_path is still top-level in CC's schema.
  if (Array.isArray(input.edits) && input.file_path) {
    // already added
  }
  return [...new Set(paths)];
}

async function main() {
  let raw = '';
  try {
    raw = await readStdin();
  } catch (_) {
    return safeExit(0);
  }

  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
  } catch (_) {
    return safeExit(0);
  }

  const filePaths = extractFilePaths(payload);
  if (!filePaths.length) return safeExit(0);

  // Lazy-require so a syntax error in src can't crash before we've decided to exit 0.
  let loadConfig, scanFile, formatReport, writeReport, toJSON;
  try {
    ({ loadConfig, scanFile, formatReport, writeReport, toJSON } = require(path.join(__dirname, '..', 'src', 'index')));
  } catch (_) {
    return safeExit(0);
  }

  const cwd = payload.cwd || process.cwd();
  let config;
  try {
    config = loadConfig(filePaths[0] ? path.dirname(path.resolve(filePaths[0])) : cwd);
  } catch (_) {
    return safeExit(0);
  }
  if (config.mode === 'off' || config.enabled === false) return safeExit(0);

  let findings = [];
  for (const fp of filePaths) {
    try {
      findings = findings.concat(scanFile(fp, { config }));
    } catch (_) {
      /* ignore per-file errors */
    }
  }

  if (!findings.length) return safeExit(0); // stay quiet when clean

  try {
    writeReport(findings, config);
  } catch (_) {
    /* ignore */
  }

  const report = formatReport(findings, config.projectRoot);

  // Strict mode: block on high/critical findings so Claude must address them.
  const severe = findings.filter((f) => (f.severity === 'high' || f.severity === 'critical') && f.confidence >= 0.85);
  if (config.mode === 'strict' && severe.length) {
    process.stderr.write(report + '\n');
    return safeExit(2); // exit 2 feeds stderr back to Claude and blocks.
  }

  // Warn mode (default): non-blocking. Feed the report to Claude as context.
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: report
    }
  };
  process.stdout.write(JSON.stringify(out));
  return safeExit(0);
}

main().catch(() => safeExit(0));
