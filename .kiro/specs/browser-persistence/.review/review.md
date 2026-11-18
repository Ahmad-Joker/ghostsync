# Final Review — @ghostsync/persist review-finding fixes (round 2)

Verdict: **APPROVED**

Scope reviewed: the UNSTAGED working-tree diff (`git diff`) plus the real source,
new tests, harness, and recorded verification evidence. The staged review-ZIP
index (`pnpm-lock.yaml`, `.gitignore`, and the originally-added spec/app files)
was confirmed intact and is out of scope for this round.

## Scope / constraint verification

- `git diff --name-only` touches only permitted paths: `packages/persist/src/{idb,session}.ts`,
  `packages/persist/tsconfig.json`, `packages/persist/tests/flush-lifecycle.test.ts`,
  `packages/persist/harness/harness.ts`, `packages/persist/e2e/lifecycle-fixes.spec.ts`,
  the three `browser-persistence` spec files, and `docs/progress.md`. The one untracked file,
  `packages/persist/tests/support/tx-abort-hook.ts`, is also within `packages/persist/**`.
- No `packages/kit/**` or `apps/**` change in either the staged or unstaged diff. No dependency/
  lockfile/root-manifest change in this round (`pnpm-lock.yaml` is staged `M` with a clean working
  tree — part of the prior snapshot, untouched here).
- `git diff --check` → clean (only benign LF→CRLF warnings).
- `git status --short --branch` → staged review-ZIP index intact; this round's edits are unstaged
  `AM`/`??`. No unstage/reset/commit/push. `.agents/` untracked and untouched.
- No `.skip` / `.only` / `.todo` anywhere in `tests/**` or `e2e/**`. No test-timeout increase
  (the only `timeout`/`setTimeout` references are a documentation note and a `setTimeout(check, 0)`
  poll inside the fix‑2 ordering helper). No weakened assertions observed.
- Unit `it()` count = 50 (grew from 48); e2e `test()` count = 23 (grew from 21) — matching the
  recorded totals.

## Fix 1 — immediate flush retry must promptly reject/settle, no inserted delay

`src/session.ts`: `#runSave`'s `finally` clears `#inFlight` FIRST, then, only while the session still
owns its connection and is not terminating, reschedules a fresh save when `#hasPendingFlushWaiter()`
reports a waiter whose target is still unpersisted. `flush()` registers its waiter BEFORE scheduling
(so a synchronous pre-await maxBytes failure still settles it) and schedules a save when none is in
flight. Traced both required scenarios:
- Immediate REPEATED failure: the fresh save fails again, `#rejectFlushWaiters` removes the waiter, so
  `#hasPendingFlushWaiter()` is then false → no reschedule → **bounded**, every promise rejects.
- Immediate SAME-SESSION retry after a transient (forced-digest) failure: the fresh save re-attempts,
  succeeds, advances the marker, and `#resolveFlushWaiters` resolves the retry → `saved`.
Regressions in `tests/flush-lifecycle.test.ts` perform the retry with NO `Promise.resolve()`/timer/
polling between the two flush calls, and assert state + retained in-memory data. Correct.

## Fix 2 — settle the write lifecycle on the TERMINAL transaction event; teardown waits for it

`src/idb.ts`: both `writeRecord` and `readRecord` now settle ONLY on `tx.oncomplete` (success) or
`tx.onabort` (terminal failure). `request.onerror`/`put.onerror`/`get.onerror` merely record the first
error into `firstError`/`requestError`; the rejection is produced on `onabort` via `mapTxError`. Nothing
settles from `onerror` alone, and nothing relies on `db.close()` or an early-rejected write promise.
`src/session.ts` `#releaseResources` marks terminating, aborts the active tx, then awaits the in-flight
save (which now resolves on the terminal event), then `replica.destroy()` + `conn.close()`, then
`await lock.release()` (which `locks.ts` resolves only after the Web Locks manager actually frees the
lock). This yields the asserted order.
The deterministic regression (`tests/flush-lifecycle.test.ts` + test-only `tests/support/tx-abort-hook.ts`)
arms a real fake-IndexedDB `readwrite` abort, disposes WHILE the write is active, and asserts
`["tx:abort", "lock:release", "dispose:resolve"]`, plus immediate same-key reopen and no late
`saved`. The Chromium regression (`e2e/lifecycle-fixes.spec.ts` + harness `flushThenDisposeOrdered`/
`armWriteAbortOnce`/lifecycle log) asserts the same order against real IndexedDB/locks. Instrumentation
is test-only (patched prototypes restored after each test); no public production failure-injection API
was added. Correct.

## Fix 3 — onStateChange after terminal close/dispose rejects with typed ClosedError

`src/session.ts` `onStateChange` now calls `#assertReadable()` first, so a NEW registration after a
successful close/dispose throws `PersistenceError("ClosedError")`, while recovery-only (phase
`recovery`) registration stays allowed. Tested after both terminal `dispose()` and terminal `close()`
(unit) and after terminal disposal in Chromium (`onStateChangeProbe` → `"ClosedError"`). Correct.

## Fix 4 — clean-checkout typecheck independent of stale persist/dist; typing not weakened

`tsconfig.json` adds `paths: { "@ghostsync/persist": ["./src/index.ts"] }` so the harness self-import
typechecks against SOURCE; `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, NodeNext are all unchanged — no `any`, no loosened option, no `@ts-ignore`.
`tsconfig.build.json` includes only `src/**` and excludes `harness`/`tests`, and `src` does not
self-import the package, so the mapping is a no-op for emitted output. Recorded evidence verifies
`typecheck` passes with `dist` deleted; the documented order is kit build → persist build →
persist typecheck. Correct.

## Verification evidence (read, not re-run)

Recorded in `tasks.md` / `docs/progress.md`, run in order: kit build (0), persist build (0),
persist typecheck (0, also verified with `dist` deleted → 0), persist test (0 — 50 unit), persist
build:harness (0), persist test:browser (0 — 23 Chromium), kit test (0 — 112 SDK unchanged),
`git diff --check` (0), `git status --short --branch` (0). Chromium 158.0.8127.18 / Playwright 1.65.0
(chromium-1254). Observed terminal order `["tx:abort", "lock:release", "dispose:resolve"]` in BOTH the
Node unit and real Chromium. `progress.md` honestly labels these as reported-this-run evidence and
invites independent re-run; nothing fabricated. Counts and the absence of skips were spot-checked
directly and match.

## Conclusion

All four fixes are correct and meaningful, the regressions are deterministic and exercise real
transaction/lock/lifecycle behavior (unit) and real Chromium, strict typing is preserved, and no
constraint was violated. No blockers.
