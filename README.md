# Comment Rot Detector

A Claude Code plugin that catches **comment rot**,which are comments that quietly stop matching the code after it's edited.

When Claude (or anyone) changes the logic of a function but leaves the comment alone, the comment becomes a lie. A `// returns true only for admins` sitting above code that now also returns true for moderators is worse than no comment at all. This plugin runs automatically after every edit and flags those mismatches with an explanation and a suggested fix.

```
COMMENT ROT DETECTED

File: src/auth/permissions.ts
Line: 42
Severity: High
Confidence: 88%

Comment:
"Returns true only if the user is an admin."

Current code behavior:
synchronous

Why this is stale:
Comment claims an exclusive condition ("admin"), but the code also matches: moderator. The condition was broadened.

Suggested replacement:
"Returns true when the value is one of: admin, moderator."
```

---

## Why a regex linter can't do this

ESLint and friends are great at *form*: missing JSDoc, TODO comments, formatting. They are blind to *meaning*. None of them can tell that:

| Comment says | Code now does |
|---|---|
| returns true only if admin | returns true for admin **or** moderator |
| sorts ascending | sorts descending (`b - a`) |
| throws on invalid input | returns `null` |
| O(n) | has a nested loop |
| cache expires after 5 minutes | uses `30 * 60` (30 minutes) |
| does not mutate input | calls `.push()` |
| only supports JPEG | also accepts PNG |

These need *semantic* comparison between the claim and the behavior. That's what this plugin does.

## How Claude Code makes it useful

A standalone tool would have to guess when to run and couldn't reason about meaning. As a Claude Code plugin it gets both for free:

1. A **`PostToolUse` hook** fires right after Claude edits/writes a file — exactly when a comment might have just gone stale.
2. The hook does fast, deterministic detection and feeds a report back into Claude's context.
3. For deeper cases, the **`comment-rot-reviewer` agent** applies real semantic judgment, and you can apply fixes with one command.

No code ever leaves your machine — everything runs locally or inside your existing Claude Code session. There is no external service.

---

## Architecture: layered analysis

```
edit ──► PostToolUse hook ──► changed-region detection (git diff / cache)
                                   │
                                   ▼
                         comment extraction (JS/TS/JSX/TSX/Python + fallback)
                                   │
                   ┌───────────────┴───────────────┐
        Layer 1: heuristics              Layer 2: code summary
        (numbers, sort dir,              (mutation, throws, async,
         throws/null, mutation,           loops, constants, conditions)
         formats, async, O())                     │
                   └───────────────┬───────────────┘
                                   ▼
                          report  ──►  Claude context
                                   │
                       Layer 3: comment-rot-reviewer agent
                          (conservative semantic judgment)
```

- **Layer 1 — heuristics** catch concrete contradictions deterministically (no API calls): duration/TTL mismatches, sort direction, permission broadening, supported file formats, throws-vs-returns-null, mutation claims, sync/async, and Big-O vs nested loops.
- **Layer 2 — code summary** describes what the linked code actually does, attached to every finding.
- **Layer 3 — agent** (`comment-rot-reviewer`) is invoked by the slash commands for nuanced judgment, deliberately conservative to keep false positives near zero.

---

## Installation

This is a standard Claude Code plugin. From a marketplace that includes it:

```
/plugin install comment-rot
```

Or point Claude Code at this directory as a local plugin. It requires only **Node.js ≥ 16** — there are **no npm dependencies to install**.

Verify it works:

```bash
node test/run.js          # self-check against the fixtures
npm run scan -- --all     # scan the whole project
```

## Usage

### Automatic (the hook)
Just edit code. After any `Edit` / `MultiEdit` / `Write`, the hook scans the changed regions and, if it finds rot, surfaces a report to Claude. It is **non-blocking** — it never stops an edit (unless you turn on strict mode).

### Manual scan — `/comment-rot:scan`
```
/comment-rot:scan                 # changed files
/comment-rot:scan src/auth.ts     # one file
/comment-rot:scan --all           # whole project
```
Runs the scanner, optionally invokes the reviewer agent, summarizes findings, and asks before changing anything.

### Apply fixes — `/comment-rot:fix`
```
/comment-rot:fix
```
Updates **only the comments** (never code logic), preserving each comment's style (`//`, `/* */`, JSDoc, `#`, docstrings). Asks for confirmation when multiple files are affected.

### CLI directly
```bash
node src/index.js scan <path>      # scan a file or directory (whole file)
node src/index.js scan --changed   # git-changed files, changed regions only
node src/index.js scan --all       # entire project
node src/index.js scan --json      # machine-readable output
node src/index.js config           # print the resolved config
```
Every scan also writes `.comment-rot/reports/latest.json`, which `/comment-rot:fix` consumes.

---

## Configuration

Config lives in `.comment-rot/config.json` at your project root:

```json
{
  "enabled": true,
  "mode": "warn",
  "minConfidence": 0.7,
  "minSeverity": "medium",
  "strictMode": false,
  "ignoredPaths": ["node_modules", "dist", "build", "coverage", "*.min.js", "vendor", "generated"],
  "languages": ["javascript", "typescript", "python"],
  "scanWholeFile": false
}
```

| Key | Meaning |
|---|---|
| `mode` | `off` (disabled) · `warn` (report, non-blocking — default) · `strict` (block on high/critical findings) |
| `minConfidence` | Hide findings below this confidence (0–1). |
| `minSeverity` | `low` · `medium` · `high` · `critical`. Default `medium`. |
| `strictMode` | Same as `mode: "strict"`. High-confidence severe rot blocks the edit (exit 2). |
| `ignoredPaths` | Globs / directory names to skip. Lock files, `node_modules`, generated/vendor code are skipped by default. |
| `languages` | Which primary languages to scan. Fallback languages are always allowed. |
| `scanWholeFile` | Scan whole files instead of only changed regions. |

---

## Supported languages

- **First-class:** JavaScript, TypeScript, JSX, TSX, Python (incl. function/class/module docstrings, JSDoc/TSDoc).
- **Fallback (generic `//` `/* */` `#` extraction):** Java, C, C++, C#, Go, Rust, PHP, Ruby.

Comment types: line comments, block comments, JSDoc/TSDoc, Python docstrings, inline comments, and leading comments above functions/classes/variables.

---

## Avoiding false positives

The detector only fires on a **concrete contradiction** between a claim and the code. It deliberately does **not** flag:

- vague but still-true comments (`// handle user input`)
- high-level intent that still holds
- comments unrelated to the changed code
- generated files, lock files, `node_modules`, license headers, vendored code

Every finding carries a **confidence** (0–1) and **severity**; only `medium`+ and confidence ≥ `0.70` show by default. The Layer 3 agent is instructed to prefer *no finding* over a weak one.

---

## 2-minute demo

```
1. Open test-fixtures/stale-comment.js
2. Notice the comment:  // Returns true only if the user is an admin.
   …above code that returns true for admin OR moderator.
3. Let Claude edit the file (or run it yourself):
      node src/index.js scan test-fixtures/stale-comment.js --whole
4. The hook / scanner flags the stale comment with a suggested fix.
5. Run /comment-rot:fix to update just the comment — code untouched.
```

Compare with `test-fixtures/valid-comment.js` (same code, accurate comments) → **no findings**.

---

## Safety

- The hook **never auto-edits** files — it only reports.
- Only `/comment-rot:fix` changes anything, and it changes **comments only**, never code logic.
- Non-blocking by default; strict mode is opt-in.
- No project code is sent anywhere external. All analysis is local or within your Claude Code session.

## Limitations

- Heuristics are intentionally narrow; subtle semantic rot is left to the Layer 3 agent.
- Changed-region detection uses `git diff` when available, otherwise a content snapshot cache under `.comment-rot/cache/`.
- Fallback languages get generic comment extraction, not full parsing.
- It reports what it's confident about and stays quiet otherwise — by design, it would rather miss a weak case than cry wolf.

## Project layout

```
comment-rot/
├── .claude-plugin/plugin.json     plugin manifest
├── hooks/
│   ├── hooks.json                 PostToolUse: Edit|MultiEdit|Write
│   └── comment-rot-hook.js        stdin JSON → scan → report (never blocks)
├── commands/
│   ├── scan.md                    /comment-rot:scan
│   └── fix.md                     /comment-rot:fix
├── agents/comment-rot-reviewer.md Layer 3 semantic reviewer
├── src/
│   ├── index.js                   API + CLI
│   ├── scanner.js                 orchestration + ignore/region filtering
│   ├── commentExtractor.js        comment ↔ code linking
│   ├── diffAnalyzer.js            git diff / snapshot cache
│   ├── semanticAnalyzer.js        Layer 1 heuristics + Layer 2 summary
│   ├── reportFormatter.js         human + JSON reports
│   └── config.js                  config load/merge
├── test-fixtures/                 stale + valid demo files
└── test/run.js                    self-check
```

## License

MIT
