# Claude Code starter setup — Agent Evals Platform

This is a small, token-conscious starter configuration for a NestJS + Vue 3/TypeScript project that evaluates Hermes Agent. It is a template, not a drop-in architecture implementation.

## Apply it

1. Copy `AGENTS.md`, `CLAUDE.md`, and `.claude/` into the root of your repository. Merge carefully if those paths already exist; do not overwrite personal rules/hooks without reviewing them.
2. Install or update Claude Code using the current official installation instructions, then run:

   ```sh
   claude update
   claude --version
   claude doctor
   ```

3. Start Claude Code at the repo root. Confirm the project instructions are loaded with `/memory` (or `/context`) and inspect registered hooks with `/hooks`.
4. Run `/model` and check the model name available to your account/provider. The project default is the `sonnet` alias; on the direct Anthropic API it resolves to Sonnet 5.5 as of October 2026, but other providers may resolve it differently.
5. Use `/feature-build <feature>` for scoped implementation, `/verify` for a verification pass, and `/eval-experiment <comparison>` to plan/run an agent configuration comparison.

## Routing philosophy

- Main session: Sonnet, medium effort.
- `architecture-advisor`: Opus/high, manually or selectively delegated only for architecture and hard trade-offs.
- `code-reviewer`: Sonnet/medium, read-only, for high-risk diffs.
- `test-auditor`: Haiku/medium, read-only, for concise test-gap analysis.
- Keep normal tasks to one main session and at most one specialist. Do not use an agent team for routine feature work.

## Hooks

The only enabled hook is an optional formatter after `Write`/`Edit`. It uses a Prettier executable already installed in the nearest project `node_modules`; if `jq` or Prettier is unavailable, it exits quietly. It never installs packages and does not run the test suite after every edit.

Command hooks run with your user permissions. Read the script before trusting this repository, and remove the hook if you do not want automatic formatting.

## Recommended current workflow

- Start routine work with the default model and medium effort.
- For a complex architecture question, run `claude --model opus --effort high` in a separate session or switch with `/model` and `/effort`; switch back to Sonnet for implementation.
- Use `/skill-doctor` (if present in your version) to review skill context/usage. Use `/doctor prompt-audit .claude` if supported to audit instruction and skill files.
- Use `/usage` and `/context` to see cost/context usage. Use `/clear` between unrelated tasks and `/compact` with a preservation target for long work.
- `claude plugin eval` is useful if you later package skills/hooks as a Claude Code plugin and want test cases/graders compared with a no-plugin baseline; it is not required for this project scaffold.
- Keep MCP servers minimal. Prefer existing CLI tools and targeted file reads over adding tools that load many definitions into context.

## First prompts to use

### Understand the repository (cheap, read-only)

> Inspect the repo for this assignment. Do not edit anything. Return: 1) actual package/folder layout, 2) existing scripts and test commands, 3) Hermes integration points available in the current code/docs, 4) the three most important missing pieces, 5) a concise recommended implementation order. Cite file paths and do not assume undocumented Hermes APIs.

### Architecture pass (use Opus only for this)

> Review the proposed architecture for the Agent Evals Platform. Focus on the runner adapter, task/config/run data model, grader interface, reproducible experiment execution, trace capture, and comparison statistics. Pick one practical architecture for a local-first take-home. Explain the key trade-offs and failure modes; avoid adding infrastructure that is not needed for a single-command local demo. Do not edit code.

### Implement a vertical slice (Sonnet)

> Use /feature-build to implement the smallest complete vertical slice: define one sample task, run a fake Hermes adapter, save an execution record, grade it deterministically, and display the result in the UI. Inspect the repo first, follow its actual conventions, add tests, and report commands/results. Do not claim real Hermes integration until verified.

### Review before submission

> Use the code-reviewer and test-auditor subagents for one focused, read-only review of the final diff. Return only blockers, correctness risks, missing high-value tests, and any unverified claims in the README. Do not make edits during review.

## Notes

- `AGENTS.md` is the shared coding-agent guidance. `CLAUDE.md` imports it and adds Claude-specific workflow rules. Current Claude Code versions can read AGENTS.md directly, but the import supports sessions/settings where direct AGENTS.md loading is unavailable.
- This template intentionally avoids enabling agent teams, adding MCP servers, or making the main model Opus by default. Add those only when a concrete task benefits from them.
