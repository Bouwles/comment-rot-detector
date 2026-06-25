---
description: Apply fixes for stale comments found by the comment rot scanner. Updates ONLY comments, never code logic, preserving the original comment style.
argument-hint: "[file path] (optional — defaults to the latest report)"
---

# Comment Rot Fix

Update stale comments using the most recent scan report. **Comments only — never touch code logic.**

## Steps

1. **Load findings**:
   - Read `.comment-rot/reports/latest.json` (the last scan's output).
   - If it's missing or stale, first run:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/src/index.js" scan $ARGUMENTS --json
     ```
   - If `$ARGUMENTS` names a file, restrict to findings for that file.

2. **For each finding**, open the file at the reported line and confirm the comment still matches the report (the code may have changed again). Re-read the linked code to make sure the suggested replacement is accurate.

3. **Apply the comment edit**:
   - Replace only the comment text.
   - Preserve the comment's delimiter and style (`//`, `/* */`, JSDoc `/** */`, `#`, docstring `"""`).
   - Preserve indentation, leading `*` in JSDoc, and surrounding tags (`@param`, `@returns`).
   - Keep the wording natural and consistent with the file's voice.

4. **Confirmation gate**:
   - If more than one file is affected, show the full list of proposed edits and **ask before applying**.
   - For a single file, you may apply directly, then show a summary.

## Hard rules

- ❌ Never change code logic, signatures, or behavior.
- ❌ Never invent behavior the code does not actually have — describe only what the code does.
- ❌ Never delete a comment unless the user explicitly asks.
- ✅ Only rewrite the comment so it matches current code.
- ✅ If a suggested replacement looks wrong, fix the wording rather than applying it blindly.
