---
name: eval-experiment
description: Design or run a reproducible comparison between two Hermes agent configurations.
disable-model-invocation: true
---
Design or run this experiment: $ARGUMENTS

Prioritize reproducibility and evidence.

1. Define the hypothesis and the single configuration difference being tested. Keep the task set, grader versions, tool permissions, and other settings fixed where possible.
2. Use stable task IDs and preserve each run, not only aggregate averages. Record config/model/version, seed if available, start/end time, tool trace, token usage, latency, cost, and grader outputs.
3. Separate deterministic outcome checks from rubric/LLM-judge scores. Validate judge JSON against a schema and attach concise evidence to each score.
4. Run both configurations on the same tasks. Repeat stochastic trials where time permits and report sample size. Prefer paired differences; use a bootstrap confidence interval over task-level differences when appropriate.
5. Report task pass rate first, then quality, tool/argument correctness, latency, tokens, and cost. Show per-task wins/regressions and uncertainty. Do not declare a winner from one run or from a tiny difference without qualification.
6. Never fabricate experiment data. If execution is unavailable, provide a runnable experiment plan and label results as not run.
