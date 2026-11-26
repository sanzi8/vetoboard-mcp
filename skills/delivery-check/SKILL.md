---
name: delivery-check
description: Pre-commit and pre-push delivery self-check checklist covering blast radius, rollback safety, failure-path observability, credential/PII hygiene, and definition-of-done verification. Use before committing code or claiming a task is delivered.
---

# Delivery Self-Check

Before claiming work is "done" or pushing commits, answer all five checks below explicitly in your response. Any item you cannot answer concretely is unfinished work.

## 1. Blast Radius

What other pages, endpoints, CLI commands, or background jobs are affected by this change?
- If you modified shared components, utility functions, database schemas, or API request/response contracts, find and list every caller via `grep` (never rely on memory).
- If the change is strictly isolated to one module, state explicitly: "Isolated to `X` because ...".

## 2. Rollback Plan

How do we revert cleanly if this fails in production?
- For pure code changes, verify the commit is atomic and self-contained (zero unrelated drive-by edits) so `git revert <sha>` restores prior behavior cleanly.
- If schemas, migrations, or persisted state formats changed, document the exact backward-compatibility or rollback procedure — and call out anything irreversible upfront.

## 3. Failure-Path Observability

When execution hits an unexpected error branch, can an operator diagnose it immediately?
- Verify new error paths preserve actionable context (operation name, entity/request ID, failing step, and underlying cause).
- Never swallow exceptions silently (`catch {}`) or collapse distinct failure modes into a generic `"failed"` message.

## 4. Credentials & PII Hygiene

- Confirm zero API keys, tokens, passwords, private URLs, or internal IPs were written into source code, configs, logs, or test fixtures.
- Confirm zero real user names, phone numbers, email addresses, or local machine user paths leaked into committed files or screenshots.

## 5. Definition of Done

Verify what "delivered" actually means for the current task:
- **Committed & Verified**: Uncommitted edits or unverified builds are not delivered work unless the user explicitly asked not to commit.
- Report concrete evidence in your handoff: **branch name, commit SHA, modified files, and the exact verification commands + pass/fail output**.

## Usage

Run through items 1–5 before finalizing your commit and include concrete answers (never placeholder phrases like "N/A" or "no impact" — state *why* there is no impact).
