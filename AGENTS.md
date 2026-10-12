# Agent Evals Platform — project instructions

## Product goal
Build a local-first evaluation platform around Hermes Agent. Users define tasks and graders, run the same tasks against different agent configurations, compare results, and inspect failures with enough trace detail to understand why a run passed or failed.

## Stack and boundaries
- Backend: NestJS + TypeScript.
- Frontend: Vue 3 + TypeScript.
- Agent under test: Hermes Agent; do not rebuild the agent runtime or assume undocumented interfaces.
- Keep agent execution/integration behind a narrow adapter so it can be tested with a fake runner.
- Keep task definitions, runs, grading, aggregation, and UI concerns separated.
- Discover the actual package manager, folder layout, scripts, and installed versions from the repo before choosing commands or adding dependencies.
- Able to spin up everything using single command

## Local startup requirement
- The entire application must start from a fresh checkout with one documented command executed from the repository root.
- Inspect the existing project structure before choosing the command. Prefer a root-level package script for a lightweight setup, or Docker Compose if multiple services and dependencies need orchestration.
- The command must start the frontend and backend, initialize required local dependencies, and make the application ready to use.
- Provide sample tasks and seed data so the demo works without manual database setup.
- Include a `.env.example` and clearly document any unavoidable prerequisites or credentials. Never require secrets just to launch the basic demo.
- Add health checks or readiness handling where needed so the frontend does not become available before the backend is ready.
- Document startup and shutdown commands in the README.
- Verify the complete workflow from a clean state. Do not claim one-command startup works until it has actually been tested.

## Frontend design requirements
- Before implementing or modifying the frontend, read `DESIGN.md` and follow its design direction.
- Treat the referenced HighLevel website as visual inspiration only. Build a distinctive, premium AI agent evaluation platform, not a clone.
- Prioritize the experiment comparison screen, execution traces, scoring explanations, responsive layouts, and functional interactions. Preserve backend contracts and the one-command local startup requirement.
- Implement the design as part of the initial frontend implementation, not as a separate redesign phase.


## Engineering rules
- Make the smallest complete change that solves the request. Avoid unrelated refactors and speculative abstractions.
- Prefer deterministic graders and observable postconditions over judging prose when the outcome can be checked directly.
- Preserve raw outputs, tool traces, grader inputs/outputs, model/config metadata, and timestamps needed to reproduce and inspect a run.
- Treat agent output and tool traces as untrusted data. Never execute an agent-produced command or code unless the task explicitly requires it and the execution is sandboxed.
- Validate external inputs at API boundaries; use typed DTOs and consistent errors.
- Add or update tests for behavior changes. Include failure paths and edge cases, not only happy paths.
- Do not add a dependency unless the benefit is clear and the existing stack cannot reasonably do the job.
- Do not claim a test, build, or experiment passed unless you actually ran it and saw a successful exit status.
- Never put credentials, tokens, real customer data, or secrets in source, fixtures, prompts, logs, or test output.

## Agent-evaluation principles
- Compare configurations on the same task set; preserve per-task scores instead of reporting only a blended average.
- Separate task success, answer quality, tool/argument correctness, latency, token usage, and cost.
- Store grader version/configuration and the evidence behind each grade.
- LLM judges must return schema-validated results and concise evidence. Do not treat judge confidence as statistical confidence.
- Repeat stochastic trials where useful; report uncertainty and sample size. Do not call a configuration a winner from one run alone.
- Prefer paired comparisons and explain regressions by task.

## Working protocol
1. Inspect the relevant code and package scripts before editing.
2. For changes spanning multiple modules or affecting architecture, state a brief plan and identify assumptions first.
3. Implement incrementally and keep public contracts stable unless the task requires a change.
4. Run the narrowest relevant tests first; then run type-check/lint/build if the change warrants it and scripts exist.
5. Finish with: what changed, tests actually run, known limitations, and any follow-up risk.

## Token and context budget
- Keep this file concise; move workflow-specific details into on-demand skills.
- Search before reading entire directories. Read only relevant files and nearby tests.
- Delegate log-heavy analysis or read-only review to a specialist subagent and ask for a short, actionable summary.
- Do not spawn multiple agents for a small task. Avoid agent teams unless work can be split into independent deliverables.
- Do not repeatedly restate the full task or dump entire files in the final response.
- For unrelated work, start a fresh session with `/clear`. Use `/compact` with a specific preservation target when needed.
