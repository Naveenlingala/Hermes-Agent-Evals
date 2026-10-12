# Agent Evals Platform

Local-first evaluation platform for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Define tasks and graders, run the same tasks against several agent configurations (with repeated trials), compare them with uncertainty, and inspect any run's output, tool trace and per-grader evidence.

> **Mock vs real.** The seeded demo uses a **mock runner**: it does not run Hermes or any model. Outcomes, latency and tokens are simulated from a seeded PRNG and are labelled `mock` throughout the UI. Real Hermes execution is a separate runner and is **not verified** here (see Limitations).

## Prerequisites
- **Nothing, if you use `./start.sh`** (macOS/Linux; needs only `sh`, `curl` or `wget`, and `tar`): it installs a private, checksum-verified Node + npm into `./.tools` when they are missing.
- Otherwise **Node.js ≥ 22.13** (the backend uses the built-in `node:sqlite`; developed on Node 24) and npm, for `npm start`.
- No credentials are needed for the demo. Optional: `ANTHROPIC_API_KEY` (real LLM judge), the `hermes` CLI (real runs). See `.env.example`.

## Start / stop
**One command from a fresh checkout, no prerequisites (macOS / Linux):**
```sh
./start.sh            # installs Node+npm privately if missing, installs dependencies, builds, seeds, serves http://127.0.0.1:3000
./start.sh stop       # stop        ·  ./start.sh real  # Hermes setup + start  ·  ./start.sh dev  # hot reload
```
If Node ≥ 22.13 and npm are already installed you can also run:
```sh
npm start        # from the repository root
```
This installs dependencies if `node_modules` is missing, builds backend and frontend, starts the backend (which also serves the UI), seeds the demo database, waits for `/api/health`, then prints **http://127.0.0.1:3000**. The UI is served by the backend itself, so it can't be reachable before the API is ready.

- Stop: `Ctrl+C` in that terminal, or `npm stop` from another one (macOS/Linux; stops only this project's processes).
- Reset demo data: `npm run reset` (deletes `.data/`; next start re-seeds).
- Reset from the UI: sidebar → **Reset all data** (two-step confirm; `POST /api/reset`; refused with 409 while an experiment runs). Deletes everything and does **not** re-seed; use `npm run reset` + restart to get the demo back.
- Debugging: sidebar → **Request log** shows every browser API call (and in-flight ones inside loaders) plus a **Backend trace** tab (`GET /api/debug/requests`). The backend logs each request as `[id] METHOD path -> status ms body=…` (secrets redacted) and experiment/run events; the id is returned in the `x-request-id` header. `TRACE_BUFFER` sets the in-memory buffer size (default 500).
- Frontend hot reload: `npm run dev` (API on :3000, Vite on :5173).
- Config: copy `.env.example` to `.env` (optional).

## Real Hermes: one command
```sh
npm run start:real            # add -- --yes for non-interactive (accepts install + smoke test; never prompts for secrets)
```
It verifies Node and npm dependencies, **finds Hermes (or offers to install it)**, builds, **smoke-tests Hermes through the same adapter the platform uses**, optionally collects API keys, and then starts the app exactly like `npm start`.
- **Install:** if `hermes` isn't found it asks before downloading the official installer (`https://hermes-agent.nousresearch.com/install.sh`) to a temp file, prints its sha256, and runs it with `bash`. macOS/Linux/WSL2 only; on Windows it prints the PowerShell command instead (untested).
- **Keys:** if Hermes isn't usable it offers (1) Hermes' own `hermes model` setup (free Nous tier needs no key), (2) save a provider key such as `OPENROUTER_API_KEY` to `.env`, or (3) skip. It can also save `ANTHROPIC_API_KEY` for the LLM judge. Input is hidden, never printed, and written to `.env` with mode 600 (git-ignored). `npm start` / `start:real` load `.env` and the backend passes its environment on to Hermes, which reads provider keys from the process environment.
- **Workspace-scoped keys:** if the judge fails with "This API key is not scoped to a workspace", set `ANTHROPIC_WORKSPACE_ID` in `.env` (the platform then sends the `anthropic-workspace-id` header) and restart. `start:real` asks for it right after the key.
- **Judge cost guard:** with an Anthropic key set, only runs from a real runner are judged by it; mock-runner output always uses the mock judge.
- The smoke test makes one tiny real model call if Hermes is connected; decline it with the prompt or `--no-smoke`.

## Live experiment progress
While an experiment runs, its page shows a sticky progress bar (elapsed time, estimated time left once a run has finished, "n / N runs") and a panel with: **what is being tested right now** (agent, task, trial, run n/N), a **phase stepper** for the current run (agent run, grading, judge call, saved, with a live timer and the judge call label), **call counters** (agent runs ok/failed, judge calls ok/failed, runs passed/failed, tokens, estimated cost), **per-agent progress bars**, and a streaming **activity log** (agent finished / agent error, each judge call with duration and score or the error, PASS/FAIL per run with the first failure reason; symbols as well as colours; newest line stays in view unless you scroll up). The log (last 150 events) is stored with the experiment and stays available after it finishes. A "Running n/N" chip in the sidebar (and top bar on phones) and the browser tab title `(n/N) Agent Evals` keep progress visible from any page. Experiments left "running" by a server restart are marked failed on the next start instead of spinning forever.
Mock runs finish in milliseconds; set `MOCK_DELAY_MS` (e.g. `800`) in `.env` to watch the panel in a demo (it also slows the first-start seeding).

## Metrics: what is measured and how
Task success, quality, tools, latency, tokens and cost stay separate (never blended). Every run also carries trajectory and component metrics (see the **Evaluators** page for the live catalog; hover metric names on the comparison page for definitions).

| Metric | Level | Deterministic (always) | LLM judge (opt-in per task) |
|---|---|---|---|
| Task completion | trajectory | pass/fail from success graders; score = mean grader score | plain-English **success criteria** (gate pass/fail) |
| Step efficiency | trajectory | `1 - (repeated-identical + errored calls) / calls`, capped by `optimal/actual` if the task sets optimal steps | rates avoidable steps in the trace |
| Plan quality | trajectory | n/a | rates the extracted plan |
| Plan adherence | trajectory | n/a | compares plan to executed calls |
| Tool correctness | component | F1 of expected tools used vs used tools expected | per-call "right tool?" |
| Argument correctness | component | fraction of expected argument matchers satisfied (case-insensitive substring per key, `*` = anywhere) | per-call "right arguments?" |

- **N/A is `null`, never 0.** No plan found, or no expectations defined, means the metric is not computed and is excluded from averages. The run page says why, and what to enable.
- **Explanations in the UI:** every metric row on the experiment page shows a one-line summary and an "i" button that expands the full explanation (how it is computed, deterministic vs LLM version, what a low value suggests, when it is N/A, an example). The full text is also on the Evaluators page and comes from one catalog (`backend/src/grading/metric-catalog.ts`; a test checks that every metric in the comparison has an entry).
- **Getting a plan out of Hermes:** Hermes does not state a plan on its own, so plan quality / adherence were N/A. Tick **"Ask the agent to state a plan first"** on a task (plus the LLM plan metrics): the agent then receives your prompt plus "Before you use any tool, first write a short numbered plan (2-5 steps)…", for every configuration in the experiment. Grading, judging and the stored prompt keep your original prompt; the run page shows a "plan requested" badge and the instruction appears as a system line in the timeline. This changes what the agent is told, so only compare runs that used the same setting. Whether a given model follows the instruction is unverified; if it does not, the N/A reason says so. Two seeded real web tasks have it enabled.
- **Plan extraction:** a `todo`/`plan` tool call, else assistant narration before the first tool call that reads like a plan. The Hermes parser now keeps that narration as its own trace event. Whether real Hermes exposes plans is **unverified**; expect N/A when it doesn't.
- **Tasks that cannot be checked deterministically:** on the Tasks page write **success criteria** (one per line, plain English). An LLM judges each against the final answer and the trace, using *only your criterion text*, and **every criterion must score >= 4/5 for the run to pass** (alongside any deterministic graders). A judge failure never silently passes: the run fails with "judge unavailable". Because pass/fail then depends on the judge, check it with `npm run judge:eval` and use >= 3 trials.
- **Expected tools** (`tool` + optional `key=substring` args) and **optimal steps** feed tool/argument correctness and step efficiency. The four LLM metric checkboxes add judge calls (about 1 per metric per run, plus 1 per criterion); mock-runner runs always use the free mock judge.
- Mock-judge metric values are heuristics and are labelled "mock judge" in the UI; they demonstrate the plumbing, not quality.

## Testing memory, web tools and the LLM judge (real Hermes)
All of these are seeded; run them from **New Experiment** (Hermes-only tasks are disabled while a mock config is selected).

**Seeded real configs** (each differs from the baseline in exactly one thing): `Hermes: memory only (baseline)`, `… memory OFF`, `… memory + web`, `… memory + terminal`. The baseline deliberately has *no terminal and no web*: on real Hermes a terminal can `curl`, which would blur a web ablation (observed in a real run).

| Scenario | A (baseline) | B | Tasks | What it shows |
|---|---|---|---|---|
| **Web tools** | memory only | memory + web | `Web: fetch example.com heading`, `Web: RFC 2606 title`, `Web: describe Hermes Agent (judge-graded)` | B should fetch pages (`web_extract` observed); A cannot. Graders require a tool call whose args contain the URL, so a right answer without fetching still fails. |
| **Memory** | memory on | memory OFF (`--ignore-rules`) | `Memory: recall a planted codename`, `Memory: recall a planted number` | A *setup prompt* plants a per-trial unique fact (`{{nonce}}`) in a separate Hermes session; the task prompt then asks for it in a fresh session. **Side effect: this writes entries into your real `~/.hermes` memory** (harmless nonces, but persistent). Whether one-shot Hermes sessions actually save/recall memory is **unverified**; this experiment is how you find out. |
| **Terminal tool** | memory only | memory + terminal | `Terminal arithmetic 1-5` | Big multiplications need a terminal; B should win clearly. |

Use ≥ 5 tasks and ≥ 3 trials before reading anything into the intervals (the comparison page withholds winners otherwise).

**Verifying the LLM judge "to the max"** (`npm run judge:eval`, needs `ANTHROPIC_API_KEY`; `-- --mock` self-tests the harness for free)
- Runs the judge over a labelled golden set (`backend/src/grading/judge-golden.ts`: 31 scored cases across **all judge prompts** (rubric, success criteria, step efficiency, plan quality, plan adherence), **including 4 prompt-injection attempts, a criterion-not-evidenced case, a criterion-vs-correctness case and a long-wrong-answer length-bias probe**, plus 4 per-call tool/argument cases) × N repeats and checks: schema validity ≥ 98%, scores inside expected bands ≥ 85%, per-kind agreement ≥ 75%, correct-vs-wrong separation ≥ 2 points, injection resisted in every repeat, per-call verdicts ≥ 80% correct, and repeat stability (range ≤ 1 for ≥ 90% of cases). It prints per-case scores and writes a JSON report (with the judge's evidence) to `.data/`.
- The labels are the author's judgement: **review and edit them for your own rubrics**; "calibrated" only means "agrees with these labels".
- Unit-tested without network: SDK request shape, refusal / truncation / API-error handling, thinking-block and fenced-JSON tolerance; and the harness itself is tested to *reject* an always-5 judge, an injectable judge, an unstable judge, a throwing judge, and the keyword mock judge.
- Not yet verified: a live Anthropic judge run (needs your key). To spot-check judge scores on real runs, open the run page: each LLM grade shows judge model, evidence, raw response and token usage.

## Documentation
- [Design document](docs/architecture.md) — architecture and key decisions
- [Known limits](docs/limits.md) — what is unverified or out of scope
- [Approximate costs](docs/costs.md) — infra, agent runs, judge, with formulas
- [Claude Code starter setup](docs/claude-code-setup.md) — notes on the `.claude/` config
- Frontend visual direction: [DESIGN.md](DESIGN.md); agent instructions: [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md)

## Commands
| Command | Purpose |
|---|---|
| `npm test` | Backend (node:test) + frontend (vitest) tests |
| `npm run typecheck` | `tsc` (backend) and `vue-tsc` (frontend) |
| `npm run build` | Production builds of both |

## Architecture
```
backend/src
  domain/types.ts      shared contract types (frontend imports them type-only)
  runner/              AgentRunner interface; MockRunner; HermesRunner (CLI adapter)
  grading/             deterministic graders; LLM judge (schema-validated); GradingService
  stats/               Wilson CI, seeded paired bootstrap, per-config summaries, A-vs-B comparison
  experiments/         create/execute experiments, persist runs, comparison + overview
  tasks/ configs/      CRUD with hand-rolled boundary validation (400 + error list)
  db/                  SQLite document store (.data/evals.sqlite)
  seed/                10 sample tasks, 4 configs, two seeded mock experiments (3-config × 3 trials, and a tools-only ablation × 5 trials)
frontend/src           Vue 3 + vue-router, SVG charts (no chart/UI library), tokens in styles/tokens.css
```
Key decisions
- **Agent configuration = model + toolsets + skills + memory (+ max turns, provider, pricing).** The comparison page lists which settings differ between A and B, so you can see whether an effect can be attributed to a single change. Applied to real Hermes via documented flags (`backend/src/runner/hermes.runner.ts#buildHermesArgs`): `--toolsets`, `--skills`, `--max-turns`, and memory `off` → `--ignore-rules` (which also skips AGENTS.md/SOUL.md/.cursorrules, so it disables more than memory). In the mock runner these settings have simple, clearly-fake effects (a missing toolset blocks tasks needing it; a matching skill / memory gives a small boost) so ablations can be demonstrated.
- **Adapter seam:** everything agent-related goes through `AgentRunner`; tests use fakes and the mock runner.
- **Pass/fail is deterministic only.** Graders: `contains`, `not_contains`, `regex`, `tool_called` (optional args), `tool_not_called`, `max_tool_calls`. Task success = all `success`-dimension graders pass and no execution error. Tool correctness, LLM-judged quality, latency, tokens and cost are reported as separate metrics.
- **LLM judge** returns `{"score": 1-5, "evidence"}`, validated; invalid output is stored as a judge error and excluded. Without `ANTHROPIC_API_KEY` a clearly labelled **mock judge** (rubric keyword coverage) is used.
- **Reproducibility:** each run stores output, full trace, raw Hermes stream (real runs), every grade with grader version/config/evidence/input, timestamps, and snapshots of the task and config.
- **Untrusted output:** agent output/traces are rendered as plain text and never executed. Hermes is spawned without a shell, prompt via stdin.
- **Statistics:** per-config pass rate has a Wilson 95% interval (treats runs as independent). A-vs-B differences use a seeded percentile bootstrap over **paired per-task differences**, reported only with ≥ 5 shared tasks. A winner is declared only if that interval excludes zero; otherwise "Inconclusive". Win/loss/tie counts are task-level.
- Cost = tokens × user-supplied per-MTok prices (seed prices are placeholders, not vendor pricing).

## Hermes integration (what is and isn't known)
`HermesRunner` runs `hermes chat --format stream-json --query-file -` (prompt on stdin; `--provider`, `--toolsets`, `--skills`, `--max-turns`, `--ignore-rules` from the config; model via `HERMES_INFERENCE_MODEL` unless the config model is `default`) and parses the JSONL events per the [Hermes CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands). **Observed on a real Hermes v0.21.7** (installed locally, no provider connected): `system/init` carries `model` and `session_id`; `result` carries `exit_code`, `text`, `tokens:{input,output,total,cache_read,cache_write}`, `duration_ms`, `error`. The parser and a test fixture use that real shape. **Tool events also observed** (real terminal and `web_extract` runs): `tool_use` has `name` and `input` (no id); `tool_result` has `name`, `output` (a JSON string), `is_error`, `duration_ms`; `text` events are per-character deltas, so the answer is read from `result.text`. Real tool names seen: `terminal`, `web_extract`. Tool names in task graders (`terminal`, `read_file`, `web_search`) are mock-fixture names and may differ from Hermes's real tool names.

## One-command start: what was actually tested
Tested on macOS (Apple silicon) from a **clean copy** of the project (no `node_modules`, `.tools`, `.data`, `dist` or `.env`) run with a stripped `PATH` that had **no Node or npm**, on a separate port and data folder:
- `./start.sh` downloaded Node v24.21.0, verified its published SHA-256, installed dependencies (also with an empty npm cache), built both packages, seeded the demo and became healthy in **14 s**; UI, API and seeded data (22 tasks, 2 experiments) were served.
- `./start.sh stop` stopped it (port released); starting again reused the private Node (no re-download) in ~5 s, and the data persisted.
- Not tested: Linux, Windows (WSL2), Intel Macs, a machine behind a proxy.

## Verification (this build, macOS, Node 24.21.0)
Run from a clean state (no `node_modules`, `.data`, or `dist`):
- `npm start` (clean state, earlier in the build) → healthy in ~6 s (npm cache warm), UI HTTP 200, Ctrl+C stopped it cleanly. After adding toolsets/skills/memory, re-checked with `npm run reset` + `npm start`: healthy, 2 seeded experiments (190 runs).
- `npm run typecheck` → exit 0 · `npm test` → exit 0 (backend 119/119, frontend 12/12, scripts 5/5) · `npm run build` → exit 0.
- Screenshots (headless Chrome) reviewed for Overview, Experiment comparison and Run detail at desktop width, and the comparison page at ~500 px width.

## Limitations
- **Not verified:** whether an env-var key alone (without `hermes model`) is enough for Hermes, memory save/recall across one-shot Hermes sessions, the Anthropic judge against the live API, Windows/Linux, browsers other than Chrome.
- The mock runner shows the platform's behaviour, not any agent's quality. Seeded results are demonstration data.
- Seed demo: 10 tasks × 3 trials. Intervals are wide; the demo correctly reports "Inconclusive" for the headline comparison.
- Experiments run sequentially in-process; a server restart mid-run marks that experiment failed ("interrupted") and its remaining runs are not resumed.
- No auth; the server binds to 127.0.0.1 only. Task regexes are user-authored (no ReDoS guard beyond length limits).
- Existing `.data/` from an earlier build lacks the new config fields (the code tolerates that); run `npm run reset` to re-seed.
- Task/config editing and deletion are not implemented (create + view only).
