---
description: Scan for comment rot — comments whose meaning no longer matches the code. Runs the deterministic scanner, then optionally invokes the comment-rot-reviewer agent for deeper semantic judgment.
argument-hint: "[file path | --changed | --all]"
---

# Comment Rot Scan

Scan code for **comment rot**: comments that became outdated after the code they describe changed.

## Steps

1. **Pick the target** from `$ARGUMENTS`:
   - a file or directory path → scan that
   - `--changed` (default if no args) → scan git-changed files
   - `--all` → scan the whole project
   - `--whole` → don't restrict to changed regions

2. **Run the scanner** (deterministic Layer 1 + 2):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/src/index.js" scan $ARGUMENTS --json
   ```
   It writes a machine-readable report to `.comment-rot/reports/latest.json` and prints findings.

3. **Deep review (Layer 3)**: for any file with findings — or if the user wants a thorough pass — invoke the **comment-rot-reviewer** agent on the linked comment/code pairs to confirm real contradictions and discard weak ones. Prefer no finding over a weak finding.

4. **Summarize** the confirmed findings for the user: file, line, severity, confidence, what the comment claims, what the code actually does, and the suggested replacement.

5. **Do not edit anything.** Ask the user whether they want to apply fixes. If yes, hand off to `/comment-rot:fix`.

## Rules

- Only report medium+ severity and confidence ≥ 0.70 unless the user lowers the threshold.
- Never flag vague-but-still-true comments. A contradiction must be concrete.
- Never propose changing code logic — only comments.
