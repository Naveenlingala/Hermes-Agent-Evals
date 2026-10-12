# Approximate cost of running the system

All figures are estimates derived from the code and the stored demo data, **not measurements of a real billed experiment**. Provider prices change; plug current prices into the formulas.

## Infrastructure: $0
Local-only: Node process + SQLite file. No hosted services, queue, or database. Disk: demo data (190 mock runs) ≈ 6 MB, i.e. ≈ 30 KB/run; allow more for real runs (raw stream + trace).

## Mock mode: $0
No model calls. The mock judge is keyword-based.

## Real mode: two paid components

**1. Agent runs (Hermes + your provider).** One run per task × config × trial.
`cost ≈ Σ runs (input_tokens × P_in + output_tokens × P_out)`; tokens come from Hermes’s `result.tokens`. Tool-using web tasks cost more than single-turn ones because every turn re-sends context. Free models (e.g. OpenRouter `:free`) make this $0 but are rate-limited. Cap with `maxTurns` and `HERMES_TIMEOUT_MS`.

**2. LLM judge (Anthropic, default `claude-haiku-5-5`, `max_tokens` 4096).** Per run, one call each for: the quality rubric (if set), every `llm_criterion`, and each opted-in LLM metric (step efficiency, plan quality, plan adherence), plus one call per tool call if per-call tool judging is enabled. Typical 1–4 calls/run; each ≈ 1–4k input tokens (task, output, compacted trace) and ≈ 100–400 output tokens.
`judge cost ≈ runs × calls_per_run × (in_tok × P_in + out_tok × P_out)`

### Worked example (illustrative prices, check your plan)
Assume judge prices of $1 / MTok input and $5 / MTok output (placeholders, not quoted vendor rates), a 10-task × 2-config × 3-trial experiment = 60 runs, 3 judge calls/run at 3k in / 300 out:
- calls: 180; input 540k tok ≈ $0.54; output 54k tok ≈ $0.27 → **≈ $0.8 per experiment** for judging.
- Agent side with a mid-priced model at ~20k in / 2k out per run: 60 × (20k×P_in + 2k×P_out) — dominated by agent runs, usually larger than judging. With $3/$15 placeholder prices ≈ $5.4.
- Judge calibration (`npm run judge:eval`): ~35 calls ≈ a few cents at the same prices.

## Levers to reduce cost
Keep LLM metrics opt-in per task; prefer deterministic graders; fewer trials while exploring (then raise for the final comparison); smaller judge model; lower `maxTurns`; run `judge:eval` only when changing judge prompts/model.

## Time
Real runs take seconds to minutes each (timeout 5 min default) and execute sequentially, so wall-clock ≈ Σ run durations + judge latency. This is the practical cost of large experiments.
