'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig } = require('./config');
const { scanFile, scanFiles, isSupported, isIgnored } = require('./scanner');
const { formatReport, toJSON } = require('./reportFormatter');
const { detectLanguage } = require('./commentExtractor');

function writeReport(findings, config) {
  try {
    const dir = path.join(config.projectRoot, '.comment-rot', 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      generatedAt: new Date().toISOString(),
      count: findings.length,
      findings: toJSON(findings, config.projectRoot)
    };
    fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(payload, null, 2));
  } catch (_) {
    /* never break on report write */
  }
}

function gitChangedFiles(projectRoot) {
  const files = new Set();
  for (const args of [['diff', '--name-only'], ['diff', '--cached', '--name-only'], ['ls-files', '--others', '--exclude-standard']]) {
    try {
      const out = execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      out.split('\n').filter(Boolean).forEach((f) => files.add(path.join(projectRoot, f)));
    } catch (_) {
      /* ignore */
    }
  }
  return [...files];
}

function walkSupported(dir, config, acc) {
  acc = acc || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (isIgnored(full, config.projectRoot, config.ignoredPaths)) continue;
    if (e.isDirectory()) walkSupported(full, config, acc);
    else if (detectLanguage(full)) acc.push(full);
  }
  return acc;
}

// Resolve the list of files to scan from CLI args.
function resolveTargets(args, config) {
  if (args.all) return walkSupported(config.projectRoot, config);
  if (args.changed) return gitChangedFiles(config.projectRoot).filter((f) => detectLanguage(f));
  if (args.path) {
    const p = path.resolve(args.path);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return walkSupported(p, config);
    return [p];
  }
  // default: changed files
  const changed = gitChangedFiles(config.projectRoot).filter((f) => detectLanguage(f));
  return changed;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--whole' || a === '--whole-file') out.whole = true;
    else if (a === '--changed') out.changed = true;
    else if (a === '--all') out.all = true;
    else out._.push(a);
  }
  out.command = out._[0];
  out.path = out._[1];
  return out;
}

function runCli(argv) {
  const args = parseArgs(argv);
  const config = loadConfig(process.cwd());

  if (args.command === 'config') {
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
    return 0;
  }

  // default command is "scan"
  const targets = resolveTargets(args, config);
  // A manual scan of the whole project or an explicit path looks at the whole
  // file. Only the implicit "changed files" mode narrows to diff regions (that
  // diff-narrowing is mainly a hook-speed optimization).
  const wholeFile = !!args.whole || !!args.all || !!args.path;
  const findings = scanFiles(targets, { config, wholeFile });
  writeReport(findings, config);

  if (args.json) {
    process.stdout.write(JSON.stringify(toJSON(findings, config.projectRoot), null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(findings, config.projectRoot) + '\n');
  }
  return findings.length ? 1 : 0;
}

// Public API for the hook and tests.
module.exports = { loadConfig, scanFile, scanFiles, formatReport, toJSON, writeReport, isSupported, gitChangedFiles, walkSupported };

if (require.main === module) {
  process.exit(runCli(process.argv.slice(2)));
}
