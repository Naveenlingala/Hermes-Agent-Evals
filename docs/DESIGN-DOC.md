# Design document — Agent Evals Platform

Status: implemented and tested locally (see README "Verification"). Scope: a local-first platform that runs the same tasks against different Hermes Agent configurations, grades them, compares them with uncertainty, and lets a user inspect any single run.

## 1. Goals and non-goals
Goals
- Define tasks and how each is scored; define agent configurations (model, skills, memory, toolsets); run every task under every configuration; show whether A beats B and how sure we can be; inspect one run in full.
- One command from a fresh checkout; demo works with no secrets.
- Honest separation of mock (demo) from real Hermes results.

Non-goals: rebuilding the agent runtime, multi-user/auth, distributed execution, hosted deployment, production-grade job queueing.

## 2. Architecture
```
Vue 3 SPA ──HTTP/JSON──> NestJS API ──> ExperimentsService ──> AgentRunner (interface)
                              │               │                    ├─ MockRunner   (seeded PRNG, demo/tests)
                              │               │                    └─ HermesRunner (spawns `hermes chat`)
                              │               └──> GradingService ──> deterministic graders
                              │                                    └─> Judge (Anthropic | Mock)
                              ├──> stats (Wilson CI, paired bootstrap)
                              └──> DbService (node:sqlite, JSON documents)
```
Module boundaries follow AGENTS.md: tasks, configs, runs/experiments, grading, aggregation (stats) and UI are separate; the frontend imports backend contract types type-only (`domain/types.ts`), so there is one source of truth for the API shape.

## 3. Key decisions (and why)
1. **Narrow `AgentRunner` adapter.** Everything agent-related is `run(task, config) → {output, trace, tokens, timing}`. Tests and the demo use a fake/mock runner; Hermes is spawned without a shell with the prompt on stdin (no injection through task text). Parsing `--format stream-json` is isolated in `parseHermesStream` and tested against a stream captured from a real Hermes v0.21.7.
2. **Mock mode is a different code path and is labelled.** Simulated runs always use the mock judge, so a demo can never be mistaken for evidence about a real agent, and a mock config cannot run tasks that have no mock scenario.
3. **Deterministic first, LLM second.** Pass/fail comes from observable checks (contains, regex, tool_called, tool_not_called, tool-call bounds). An LLM judge is used only where the user states a criterion (`llm_criterion`) and then *gates* pass/fail (score ≥ pass threshold). Judge failure is recorded as an error and never silently counts as a pass.
4. **Metrics are separated, not blended.** Task completion, step efficiency, plan quality, plan adherence, tool correctness (F1) and argument correctness are independent numbers; not-applicable is `null`, never 0. Latency, tokens and cost are reported separately. Deterministic metrics always run; LLM metrics are opt-in per task so cost is controllable.
5. **Judges are schema-validated.** Output must parse to `{score 1–5, evidence}`; refusals and truncation are errors. Judge “confidence” is not used as statistical confidence. A golden set (31 scored cases + 4 per-call cases) and `npm run judge:eval` calibrate a judge against known answers.
6. **Statistics that match the question.** Per-config pass rate has a Wilson 95% interval. A-vs-B uses a seeded percentile bootstrap over *paired per-task differences* (needs ≥ 5 shared tasks) with win/loss/tie by task. A winner is declared only if the interval excludes 0; otherwise “Inconclusive”. Trials are repeated per task; trial-level independence is an assumption (see limits).
7. **Reproducibility.** Each run stores output, full trace, raw Hermes stream, every grade with grader version/config/input/evidence, timestamps, and snapshots of the task and config as run (so later edits cannot rewrite history).
8. **Storage: SQLite document store via built-in `node:sqlite`.** Zero extra services, zero native build step, one file under `.data/`. Chosen over Postgres/Docker because the requirement is a lightweight single command; the cost is Node ≥ 22.13 and coarse querying (documents are filtered in memory).
9. **One-command start.** `./start.sh` (installs a private, checksum-verified Node if missing) → `npm start` (install, build, seed, serve SPA from the API on 127.0.0.1, wait for `/api/health`). `npm run start:real` adds Hermes detection/installation (user is asked first, installer sha256 shown), a smoke test through the same adapter, and optional key capture into a mode-600 `.env`. Docker was evaluated and removed: it added a prerequisite without removing one.
10. **Live progress.** Experiments run in-process; `live`, `counters` and the last 150 `events` are persisted on the experiment document and polled by the UI (progress bar, per-step status, judge calls). On restart, stale `running` experiments are marked failed rather than left spinning.
11. **Security posture.** Binds to 127.0.0.1 only; agent output and traces are rendered as text and never executed; API inputs validated at the boundary with 400 + error lists; secrets only via env/`.env` (git-ignored), never logged.

## 4. Data model (abridged)
Task (prompt, graders, optional criteria, expected tools/args, optimal steps, setup prompts, `elicitPlan`, `judgeMetrics`) · AgentConfig (model, provider, toolsets, skills, memory, maxTurns, prices) · Experiment (task×config×trials, status, live, counters, events) · Run (output, trace, tokens, timing, grades[], metrics, snapshots).

## 5. Alternatives considered
- Postgres/Redis queue: rejected; overkill for local single-user.
- Python harness for the agent runs: rejected; stack mandated NestJS and Hermes is a CLI.
- Single blended score: rejected; hides regressions (AGENTS.md requires per-task and separated metrics).
- Inferring a plan from the trace for plan metrics: rejected as circular; instead the task can opt in to asking the agent to state a plan.

## 6. Testing strategy
Backend `node:test` (119), frontend vitest (12), script tests (5): graders, judge parsing/failure paths, metrics, stats, runner parsing with real-stream fixtures, API validation, reset/reconciliation, progress. Last full run: typecheck, tests, build all exit 0 on macOS/Node 24.21.0.
