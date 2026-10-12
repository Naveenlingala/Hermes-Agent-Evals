---
name: verify
description: Run the smallest useful verification set for the current changes without making unrelated edits.
---
Verify the current changes.

1. Read package.json files and the current diff. Discover the package manager and available scripts; do not assume npm if the repo indicates pnpm, yarn, or bun.
2. Identify affected backend/frontend packages and run the narrowest relevant unit or integration tests first.
3. If supported and relevant, run typecheck and lint. Run the full build only when the change is cross-cutting or the smaller checks do not cover it.
4. Do not fix failures unless the user asked for fixes. Capture the smallest useful failure excerpt and identify whether the failure is introduced by this change or appears pre-existing.
5. Report each command, pass/fail/blocked status, and any checks not run. Never infer a pass from partial output.
