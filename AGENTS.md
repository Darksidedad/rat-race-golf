# Rat Race Golf Project Charter

This repository is the single source of truth for the Rat Race Golf application.

## Operating model

- The pinned **Rat Race Golf — Chief of Staff** Codex task is the project's coordination hub.
- Use the hub for priorities, decisions, progress summaries, and deciding what work happens next.
- Use separate Codex tasks or sub-agents for concrete implementation, investigation, testing, deployment, data migration, or design work.
- Give each delegated task one bounded outcome, explicit acceptance criteria, and relevant file or environment scope.
- Prefer isolated git worktrees for implementation tasks. Use the shared checkout only for coordination or when the user explicitly requests it.
- The chief-of-staff task reviews delegated results, resolves overlaps, verifies integration status, and updates the project hub. It does not claim work is complete until it has evidence.

## Source-control rules

- Production code lives in this repository; do not create a second Rat Race Golf codebase elsewhere.
- Preserve unrelated user changes and untracked files.
- Use branches prefixed with `codex/` for delegated implementation.
- Do not push or deploy unless the task explicitly authorizes it.
- Before production changes, run the relevant build or tests and record the result.

## Project records

- Read `docs/project/README.md` before coordinating broad project work.
- Keep `docs/project/STATUS.md` concise and current after meaningful milestones.
- Record durable architecture or product decisions in `docs/project/DECISIONS.md`.
- Store detailed feature documentation elsewhere under `docs/`; the project hub should link to it rather than duplicate it.

## Completion report

Every delegated task should return:

1. Outcome and user-visible impact.
2. Files or systems changed.
3. Verification performed and results.
4. Commit, branch, deployment, or migration status.
5. Risks, follow-ups, and any decision needed from the user.
