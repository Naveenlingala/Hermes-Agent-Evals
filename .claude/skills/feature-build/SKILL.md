---
name: feature-build
description: Implement a scoped feature in the Agent Evals Platform with minimal changes and targeted verification.
disable-model-invocation: true
---
Implement this feature: $ARGUMENTS

1. Inspect the relevant source, tests, package scripts, and existing conventions before proposing code.
2. If it touches multiple subsystems, give a brief plan and list any assumptions. For a small change, proceed directly.
3. Keep changes minimal. Preserve existing contracts unless the requirement explicitly changes them. Do not add dependencies without a clear need.
4. Add or update tests for the behavior and at least one meaningful failure/edge case.
5. Run the narrowest relevant test first. Run typecheck/lint/build only when relevant scripts exist and the change warrants them.
6. Do not run broad suites repeatedly after each edit. Fix root causes, then perform one final targeted verification.
7. Finish with a short summary, files changed, exact commands and results, and known limitations. Never claim an unrun check passed.
