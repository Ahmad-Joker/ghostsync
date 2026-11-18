# FieldLedger MVP implementation review (focused pass)

FieldLedger MVP is implemented under apps/fieldledger. Session ownership, save labelling, import and failure recovery match the specs. The only tracked-file edits are apps/fieldledger/package.json, pnpm-lock.yaml (fieldledger importer) and docs/progress.md. packages/*, .agents, .review-artifacts and the earlier .review files show no changes. Nothing is staged. Watch for: a progress.md flake count that differs from the run log (possible, non-blocking), and a guard error message that may never render (likely, non-blocking). Suites were not re-run, per instructions; counts come from impl-run-log.md.

**Verdict**: APPROVED

## High-level view

SessionController is the only holder of the Persist session. It opens with a localStorage replicaId per (profile, document), separate from the Yjs clientID. A second tab gets StorageInUseError and the in-use screen. The save label comes from one function, saveLabel, and shows "Saved locally" only for state saved with sequence above 0. Import goes through importCapsuleIntoPersisted. It reports applied-saved only when persisted is true, otherwise applied-unsaved with Retry save and Download backup. That state flips to saved only from the Persist onStateChange callback. Rejections throw before any apply, so the model is untouched, and e2e compares UI, sequence and stored record before and after.

The model is always read via listResults through readModel, so invalid records show with Restore and Discard. Failure injection lives only in e2e/helpers.ts via addInitScript, and tests/dist-scan.test.ts scans the built bundle for the hook names. Updates and incident switching settle through flush or close first. A failed close enters a recovery phase with backup and discard.

Playwright config has retries 0 and default-sized timeouts. Property batches are 4 x 50 with seeds 424242 to 424245. ORD-FIX-1 expectations are hand-written literals. Click calls are single and awaited. expect.poll is used for reads only.

<details>
<summary>Issues (3)</summary>

1. **Guard error not rendered (likely, non-blocking)**: SessionController.guard sets errorMessage while phase stays "ready", and the view only writes errorMessage into the error screen element. A failed edit may fail silently. Render it in ready phase or drop the assignment.
2. **Task 5.1 clean-checkout run open (confirmed, non-blocking)**: tasks.md leaves it unchecked and progress.md lists it as UNVERIFIED. Run it before merge.
3. **Flake counts inconsistent (confirmed, non-blocking)**: progress.md says one of five full runs failed with an ENOENT trace flake and three later runs passed. The run log says three full runs plus a targeted run and four later runs. Align the wording. The flake itself is disclosed and no retries were added.

</details>

<details>
<summary>Details</summary>

Checked in code: no .skip, .only, .todo, retries or raised timeouts in apps/fieldledger (playwright timeout 30s and expect 10s are the configured values for the app's own config). The only failure-injection names are in e2e/helpers.ts and the dist-scan test. The remaining unchecked task and the unverified items (Firefox/WebKit, quota exhaustion, remote-apply events) are disclosed in progress.md, matching the run log. Unit, e2e and regression counts in progress.md match the run log (64, 18, 4, 112, 120, 50, 37).

</details>

<details>
<summary>File map</summary>

apps/fieldledger/{src,tests,e2e,scripts}: app, tests and the adapted service-worker plugin. apps/fieldledger/package.json and pnpm-lock.yaml: workspace wiring. docs/progress.md: milestone notes. .kiro/specs/fieldledger: spec notes and review files. Full diff: `git diff` plus the untracked apps/fieldledger files.

</details>
