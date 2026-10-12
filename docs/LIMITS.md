# Known limits

## Not verified (never run, so do not rely on it)
- Anthropic judge against the live API in a full real experiment (code and parsing tested with fakes/golden fixtures; the judge was hit once with an unscoped key and returned a workspace error, fixed via `ANTHROPIC_WORKSPACE_ID`, not re-run end to end).
- The `start:real` path that installs Hermes from scratch (user is testing it; Hermes was uninstalled for that purpose).
- Whether a given Hermes model follows the “state a plan first” instruction; memory persistence across one-shot Hermes sessions; env-var-only provider auth.
- Linux, Windows/WSL2, Intel Macs, proxied networks, browsers other than Chrome. One-command start was tested only on macOS (Apple silicon).

## Design limits
- **Scale:** experiments run sequentially in one process; no queue, parallelism, resume or cancel. A restart mid-run marks the experiment failed. SQLite document store filters in memory; fine for thousands of runs, not millions. Raw streams and traces are stored whole (~30 KB/run in the mock demo; real runs larger).
- **Statistics:** trials of the same task are treated as independent for Wilson intervals; the bootstrap is over tasks, so conclusions need ≥ 5 shared tasks and are about *this task set*, not agents in general. No multiple-comparison correction across many metrics/configs.
- **LLM judge:** a single judge model, no ensembling; scores 1–5 are ordinal and noisy; calibration covers only the golden set. Judge cost and latency grow with trace length (traces are compacted).
- **Hermes integration:** relies on the CLI’s `stream-json` shape observed on v0.21.7; a version change can break parsing. Real tool names (`terminal`, `web_extract`) differ from mock names, so tool graders must be tuned per environment. Memory `off` maps to `--ignore-rules`, which also drops AGENTS.md/SOUL.md.
- **Agent safety:** real Hermes runs execute tools (terminal, web) on the host with the user’s credentials; there is no sandbox. Only run tasks you trust.
- **Product gaps:** no auth/multi-user (localhost only); tasks/configs can be created and viewed but not edited or deleted; regexes are user-authored with length limits only (no ReDoS guard); cost uses user-supplied prices, seed prices are placeholders.
- **Mock results** demonstrate platform behaviour, not agent quality.
