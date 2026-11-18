# FieldLedger implementation run log (changes uncommitted; HEAD 916165f, branch feat/fieldledger)

Date: 2026-11-14. Baseline: `impl-baseline.md` (all green before edits). No `impl-review.json` existed, so this is the implementation pass.

## Commands and real results

| Command | Exit | Result |
|---|---|---|
| `pnpm.cmd install` (normal) | 0 | lockfile diff: only the `apps/fieldledger` importer (3 workspace links; exact pins playwright 1.65.0, @types/node 24.19.2, fast-check 4.10.2, typescript 7.0.2, vite 8.3.6, vitest 5.1.0) |
| `pnpm.cmd install --frozen-lockfile` | 0 | up to date |
| kit / capsule / persist `build` | 0 | tsc ok |
| `-F @ghostsync/fieldledger typecheck` | 0 | tsc ok |
| `-F @ghostsync/fieldledger test` | 0 | 13 files, 64 tests passed. Property batches: ordering (3 properties) and kit-integration (2 properties), each 4 batches, seeds 424242..424245, every batch `numRuns=50 numSkips=0 PASS`; afterAll proves 200 per property |
| `-F @ghostsync/fieldledger build` | 0 | vite build ok; dist: index.html, sw.js, precache-manifest.json, assets/index-*.js, assets/index-*.css |
| `-F @ghostsync/fieldledger test:dist` | 0 | 1 file, 4 tests passed (relative URLs, no injection names, `register("./sw.js", { scope: "./" })`) |
| `-F @ghostsync/fieldledger test:e2e` | 0 | 18 passed, real Chromium, 1 worker, no retries (3 full runs plus a targeted run all green after the final code) |
| kit `test` | 0 (passed) | 42 files, 112 tests |
| capsule `test` | 0 | 20 files, 120 tests |
| persist `test` | 0 | 7 files, 50 tests |
| persist `build:harness` | 0 | vite build ok |
| persist `test:browser` | 0 | 37 passed |
| `git diff --check` | 0 | clean (CRLF warnings only) |

Flake disclosure: one full e2e run (the first after the final edits, run right after unit and dist) failed `two-profile` with Playwright `ENOENT` while copying trace artifacts in `test-results/.playwright-artifacts-0` (infrastructure, thrown at the end of the test body, after all assertions and screenshot lines had run). It did not reproduce in four later runs. Cause not established. An earlier `persist test:browser` attempt failed with "port 4319 already in use" because a prior batch call was interrupted; it passed (37) once the port was free.

## Key evidence
- Screenshots (from the running production build, taken after "Saved locally" assertions; valid PNG signature, nonempty, checked in the test): `apps/fieldledger/test-results/two-profile-two-profiles-j-2c79e--state-after-offline-reload-chromium/fieldledger-desktop-1280x800.png` and `.../fieldledger-mobile-320.png` (attached via `testInfo.attach`; the directory is gitignored and rewritten by each run).
- E2E-FL-08 observed: `invalidRecord`, identical on both profiles, fields `{"text":"Check valve seat"}`; Kit-level test agrees.
- Hash route offline: initially FAILED (Chromium keeps the fragment in SW navigation requests); fixed in the copied worker (`url.hash = ""`); now passes.
- `listResults()` contract matched the spec; only wording notes were added.
- Subpath: `base "./"` verified; sub-path test is optional and passes.

## Deviations / unverified
See the notes appended to requirements.md, design.md, tasks.md. Unverified: clean-checkout run (task 5.1), Firefox/WebKit, real quota exhaustion, Kit remote-apply `subscribe` events (A4; app refreshes explicitly), and an independent self-review (left to the review step).
