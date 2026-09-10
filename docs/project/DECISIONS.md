# Rat Race Golf Decisions

## 2026-08-31 — Single project home

All Rat Race Golf source code, project documentation, migrations, and operational notes belong in the `pga-draft` repository. Separate Codex tasks may work on the project, but they should use this saved project and contribute back through reviewable branches or documented findings.

## 2026-08-31 — Chief-of-staff operating model

A pinned Codex task acts as the coordination hub. It delegates bounded work, tracks outcomes, summarizes progress, and maintains the project status. Worker tasks do not independently redefine project priorities or deploy without explicit authority.

## 2026-08-31 — Production-first feature reconstruction

`origin/main` is the integration baseline. The `dev` branch contains no unique commits, and `codex/multi-league-catalog` diverged before thirteen production scoring and refresh fixes. Multi-league work will therefore be reconstructed on top of production in bounded catalog, provider-security, draft-integrity, UI, refresh, and completed-results slices. Production event validation, tee-time handling, scoring states, and live-refresh behavior take precedence over competing implementations from the feature branch.
