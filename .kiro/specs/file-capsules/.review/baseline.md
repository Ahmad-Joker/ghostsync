# Pre-edit baseline (branch feat/file-capsules, HEAD 491e55e)

Captured before any implementation edits. Chromium ran successfully (no blocker).

| # | Command | Exit | Result |
|---|---------|------|--------|
| 1 | `pnpm.cmd -F @ghostsync/kit build` | 0 | tsc ok |
| 2 | `pnpm.cmd -F @ghostsync/persist build` | 0 | tsc ok |
| 3 | `pnpm.cmd -F @ghostsync/persist build:harness` | 0 | vite: 56 modules; assets/index-D8xLbFF4.js 106.23 kB |
| 4 | `pnpm.cmd -F @ghostsync/kit test` | 0 | 42 test files passed, 112 tests passed; 8 fast-check properties PASS (seed=424242, numRuns=200) |
| 5 | `pnpm.cmd -F @ghostsync/persist test` | 0 | 7 test files passed, 50 tests passed |
| 6 | `pnpm.cmd -F @ghostsync/persist test:browser` | 0 | Playwright chromium, 1 worker: 30 passed |

Exit codes for 4-6 were confirmed by a second run (all 0, same counts for persist). Commands 1-3 exit codes were captured on the first run.

## git status --short --branch

```
## feat/file-capsules
 M docs/progress.md
?? .agents/
?? .kiro/specs/file-capsules/
?? .review-artifacts/
```
