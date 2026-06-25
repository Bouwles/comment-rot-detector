'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  enabled: true,
  mode: 'warn', // off | warn | strict
  minConfidence: 0.7,
  minSeverity: 'medium', // low | medium | high | critical
  strictMode: false,
  ignoredPaths: [
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    '.git',
    '.comment-rot',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '*.min.js',
    'generated',
    'vendor'
  ],
  languages: ['javascript', 'typescript', 'python'],
  scanWholeFile: false
};

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

// Walk up from `startDir` looking for a project root marker. Falls back to startDir.
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (
      fs.existsSync(path.join(dir, '.comment-rot')) ||
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function loadConfig(startDir) {
  const root = findProjectRoot(startDir || process.cwd());
  const configPath = path.join(root, '.comment-rot', 'config.json');
  let userConfig = {};
  try {
    if (fs.existsSync(configPath)) {
      userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (_) {
    // Malformed config: ignore and use defaults. Never break the workflow.
    userConfig = {};
  }
  const merged = Object.assign({}, DEFAULT_CONFIG, userConfig);
  merged.projectRoot = root;
  // strictMode is a shorthand for mode === 'strict'
  if (merged.mode === 'strict') merged.strictMode = true;
  if (merged.strictMode) merged.mode = 'strict';
  return merged;
}

function meetsSeverity(severity, minSeverity) {
  return (SEVERITY_RANK[severity] || 0) >= (SEVERITY_RANK[minSeverity] || 0);
}

module.exports = { DEFAULT_CONFIG, SEVERITY_RANK, loadConfig, findProjectRoot, meetsSeverity };
