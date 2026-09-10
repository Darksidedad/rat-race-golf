# Rat Race Golf Project Hub

This folder is the durable coordination layer for the Rat Race Golf application.

## Where work lives

- Application source: `app/`, `lib/`, and `public/`
- Database setup and migrations: root SQL files
- Operational and integration notes: `docs/`
- Current project summary: `docs/project/STATUS.md`
- Durable decisions: `docs/project/DECISIONS.md`

## Task structure

- **Chief of Staff:** owns priorities, delegation, integration awareness, and summaries.
- **Implementation tasks:** one feature or fix per task, normally in an isolated worktree.
- **Investigation tasks:** read-only diagnosis with evidence and recommendations.
- **Release tasks:** build, migration, deployment, and production verification with explicit authorization.

The Chief of Staff may delegate bounded work to sub-agents during a turn or create separate project tasks when persistent visibility is useful. Separate tasks remain peer tasks in Codex; the hierarchy is an operating convention maintained through titles, prompts, and this hub.

## Recommended naming

- `RRG — Chief of Staff`
- `RRG — Feature — <name>`
- `RRG — Bug — <name>`
- `RRG — Investigation — <name>`
- `RRG — Release — <name>`

## Routine

1. User gives the Chief of Staff a goal or asks for the project summary.
2. Chief of Staff reviews this hub, repository state, and relevant task history.
3. Chief of Staff creates bounded workstreams and tracks their status.
4. Workers report evidence using the completion format in `AGENTS.md`.
5. Chief of Staff synthesizes results, identifies decisions, and updates `STATUS.md`.
