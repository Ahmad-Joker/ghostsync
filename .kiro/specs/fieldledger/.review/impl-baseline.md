# FieldLedger implementation baseline (pre-edit)

Recorded before any implementation edits. HEAD 916165f, branch feat/fieldledger. Windows PowerShell, pnpm.cmd.
Chromium ran the persist browser suite without any install.

| Command | Exit | Result |
|---|---|---|
| pnpm.cmd -F @ghostsync/kit build | 0 | tsc ok |
| pnpm.cmd -F @ghostsync/capsule build | 0 | tsc ok |
| pnpm.cmd -F @ghostsync/persist build | 0 | tsc ok |
| pnpm.cmd -F @ghostsync/persist build:harness | 0 | vite build ok (66 modules) |
| pnpm.cmd -F @ghostsync/kit test | 0 | 42 files, 112 tests passed |
| pnpm.cmd -F @ghostsync/capsule test | 0 | 20 files, 120 tests passed |
| pnpm.cmd -F @ghostsync/persist test (unit) | 0 | 7 files, 50 tests passed |
| pnpm.cmd -F @ghostsync/persist test:browser | 0 | 37 passed (Chromium, 1 worker, 23.3s) |

## git status --short --branch

```
## feat/fieldledger
 M docs/progress.md
?? .agents/
?? .kiro/specs/fieldledger/
?? .review-artifacts/
```
