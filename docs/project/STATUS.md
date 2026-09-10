# Rat Race Golf Status

Last organized: 2026-09-10

## Current state

- Production application repository: `C:\Users\sethm\pga-draft`
- Production branch: `main`
- Hosting: Vercel
- Database: Supabase
- Golf data: Data Golf, with legacy ESPN compatibility paths

## Recently accomplished

- Corrected pre-tournament leaderboard handling and tee-time display.
- Added event validation to prevent stale or wrong-tournament results.
- Hardened CUT, WD, DQ, finalization, and live-score handling.
- Added bounded automatic leaderboard refresh and live Results-tab refresh.
- Added production-schema compatibility to the leaderboard refresh route.
- Reconciled branch topology: `dev` has no unique commits, while `codex/multi-league-catalog` diverges from production and must be reconstructed in bounded slices.
- Added the first dependency-free leaderboard lifecycle test suite covering event matching, live-play detection, record comparison, and status transitions; all four tests pass.
- Reconstructed the tournament catalog/schema slice as a discrete, idempotent migration. Shared provider-event identity and snapshots are separated from league-scoped sessions, teams, and picks; the prod-to-dev copy script now preserves that foreign-key order.
- Reconstructed provider API protection: authenticated browser requests, authorized internal refresh calls, per-user limits, and a shared Data Golf quota that fails closed before provider traffic. Seven automated tests now pass.
- Reconstructed transactional draft integrity: server-side snake-turn, ownership, field-membership, status, and concurrency checks now back manual picks, auto-drafts, and undo operations. Ten automated tests now pass.
- Integrated the shared tournament catalog into the multi-league UI while keeping sessions, teams, and picks league-scoped. League switches now reject stale responses, cross-league session IDs fail closed, and unpublished fields have a distinct non-draftable state.
- Reconciled Realtime and polling: league/session changes update promptly across windows, reconnect/focus events are deduplicated, hidden tabs avoid refreshes, and production's one-minute live-score and database safety nets remain intact. Fourteen tests now pass.
- Reconstructed completed historical results behind event-identity and meaningful-data validation. Real round scores produce totals; placeholder, incomplete, uniform, or mismatched feeds cannot finalize. Eighteen automated tests now pass.
- Cleared cumulative review blockers: draft status transitions are atomic, permission revocation is a separate post-deployment migration, internal provider calls use a dedicated secret plus canonical origin, and authenticated provider responses are private/no-store. Twenty-two tests now pass.

## Task organization

- Active hub: `RRG — Chief of Staff`.
- Completed production work: `Fix pre-tournament leaderboard` (latest production scoring and refresh fixes are on `origin/main`).
- Backlog / reconciliation: `Set up dev/UAT server` contains preview-tested work on `codex/multi-league-catalog` that is not integrated into production.
- Superseded: `Finish multi-league admin` by `Continue multi-league admin work`; the two `Fix finished player playoff labels` tasks duplicate the same workstream and their relevant production fixes are already represented on `main`/`dev`.
- Historical reference: `Fantasy Golf`, `Fantasy golf deployment`, and `Continue fantasy golf app`; retain for knowledge capture, not active implementation.
- Closed investigations: `Leaderboard Error Investigation` and `PGA Players List Match`; neither is an active implementation task.

## Coordination backlog

- Prepare a reviewable integration branch/commit from the reconstructed slices and define migration/deployment order.
- Run authenticated two-browser testing against a disposable Supabase environment, including concurrent picks and Realtime reconnects.
- Consolidate relevant knowledge from older fantasy-golf conversations into this repository's documentation.
- Establish a repeatable release checklist for database migrations and Vercel deployments.
- Extend automated coverage to provider payload validation, tee-time preservation, completed-result imports, league isolation, quotas, and concurrent draft picks.
- Repair the repository-wide lint baseline (currently 18 errors and 20 warnings in untouched legacy files).

## Known caution

- Do not merge the old `codex/multi-league-catalog` branch wholesale without reconciling later production scoring fixes.
- Production database schema has historically lagged repository SQL; release work must verify migrations explicitly.
- This coordination worktree is detached at production commit `88d8098`; the project-hub commit is currently on local `main` and is not yet on `origin/main`.
- `supabase-tournament-catalog.sql` has been prepared and verified but has not been applied to development or production. Both databases must receive it before the catalog-aware copy script is run.
- `supabase-api-security.sql` must be applied before its protected route code is deployed; otherwise authenticated provider requests fail closed because the rate-limit functions do not exist.
- Internal provider calls currently reuse the Supabase service-role value. A future hardening pass should replace this with a dedicated `INTERNAL_PROVIDER_API_KEY` to reduce credential scope.
- Apply `supabase-draft-pick-integrity.sql` before deploying the RPC-based client, then apply `supabase-draft-pick-permission-hardening.sql` only after the compatible app is deployed and verified.
- The reconstructed code has passed local automated tests and build verification but has not been live-tested against provider APIs or a migrated Supabase environment.
- Production requires `INTERNAL_PROVIDER_API_SECRET` and canonical `APP_ORIGIN`; the Supabase service-role credential is no longer used as an internal HTTP secret.
