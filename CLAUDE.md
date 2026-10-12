@AGENTS.md

## Claude Code workflow
- Default to a direct, economical implementation. Ask a question only when a missing fact blocks a safe/correct implementation; otherwise inspect the repo and state a reasonable assumption.
- For a task that touches more than one subsystem, use plan mode before editing. Do not use an elaborate plan for a one-file change.
- Use `architecture-advisor` only for consequential design decisions; use `code-reviewer` or `test-auditor` for focused read-only checks.
- Prefer `/feature-build`, `/verify`, and `/eval-experiment` for those explicit workflows. Skills contain detailed instructions only when needed.
- Do not invoke a model/agent team by default. Keep routine work on Sonnet at medium effort. Raise effort or use Opus only when the task's complexity justifies the additional cost.
- When compacting, preserve: current goal, assumptions, files changed, API/data-contract decisions, failing tests and exact failure, and the next concrete step. Drop repeated exploration and already-resolved alternatives.
********