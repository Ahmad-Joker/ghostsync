# file-capsules — implementation evidence

Branch `feat/file-capsules` (HEAD 491e55e, nothing staged or committed). All numbers below are from real runs in the working tree on Windows, Node v24.14.0, pnpm 10.34.9, Playwright 1.65.0 chromium.

## Files

Created: `packages/capsule/` (`package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `vitest.setup.ts`, `README.md`, `src/{bytes,checksum,decode,encode,errors,format,import,index,metadata,token-scan,types}.ts`, 19 test files plus `tests/helpers.ts` and `tests/fc-report.ts`), `packages/persist/e2e/capsule-transfer.spec.ts`, `packages/persist/e2e/capsule-persistence.spec.ts`.
Modified: `packages/persist/harness/{harness.ts,index.html}`, `packages/persist/package.json` (`@ghostsync/capsule: workspace:*` devDependency only), `pnpm-lock.yaml` (via `pnpm.cmd install`; +22 lines, only the `packages/capsule` importer and the `@ghostsync/capsule` link under `packages/persist`), `.kiro/specs/file-capsules/tasks.md`, `docs/progress.md`.
Not touched: `packages/kit/**`, `packages/persist/src/**`, `apps/**`, `.agents/`, `.review-artifacts/`.

## Public API (`@ghostsync/capsule`)

```ts
encodeCapsule(input: { app: string; documentId: string; update: Uint8Array | TransportUpdate; createdAt?: string }): Promise<Uint8Array>
decodeCapsule(bytes: Uint8Array, opts?: { maxCapsuleBytes?: number; maxUpdateBytes?: number }): Promise<{ metadata: CapsuleMetadata; update: Uint8Array }>
importCapsuleInto(target: { documentId: string; applyUpdate(c: unknown): ApplyOutcome }, bytes, expected: { app: string }, opts?): Promise<{ applied: true; metadata }>
importCapsuleIntoPersisted(target: PersistTarget, bytes, opts?): Promise<{ applied: true; metadata; persisted: boolean; saveError?: PersistLikeError }>
PersistTarget = { identity: { app: string; documentId: string }; applyUpdate; flush(): Promise<void>; getState(): State }
CapsuleError(code, message, cause?) ; isCapsuleError(v, code?) ; codes: UnsupportedVersion | Malformed | AppIdentityMismatch | DocumentIdentityMismatch | OversizedRaw | OversizedDecoded | ChecksumMismatch | SdkRejection | TargetUnavailable | CryptoUnavailable
constants: CAPSULE_MAGIC, CAPSULE_FORMAT_VERSION=1, CAPSULE_EXTENSION=".gscap", CAPSULE_MEDIA_TYPE, DEFAULT_MAX_CAPSULE_BYTES (16 MiB), DEFAULT_MAX_UPDATE_BYTES (8 MiB)
```

## Commands and exit codes (final run, working tree)

| # | Command | Exit | Result |
|---|---|---|---|
| 0 | `pnpm.cmd install` then `pnpm.cmd install --frozen-lockfile` | 0 / 0 | lockfile diff inspected, clean |
| 1 | `-F @ghostsync/kit build` | 0 | |
| 2 | `-F @ghostsync/capsule typecheck` | 0 | |
| 3 | `-F @ghostsync/capsule test` | 0 | 20 files, 111 tests passed |
| 4 | `-F @ghostsync/capsule build` | 0 | |
| 5 | `-F @ghostsync/persist typecheck` | 0 | real `PersistSession` accepted by `importCapsuleIntoPersisted` and bound to `PersistTarget`, no cast (AC-CAP-003-5) |
| 6 | `-F @ghostsync/persist test` | 0 | 7 files, 50 tests (baseline 7 / 50) |
| 7 | `-F @ghostsync/persist build` | 0 | |
| 8 | `-F @ghostsync/persist build:harness` | 0 | 66 modules; bundle `assets/index-C3rn4jQ7.js` 120.52 kB; precache manifest lists that bundle and `index.html` |
| 9 | `-F @ghostsync/persist test:browser` | 0 | 37 passed (baseline 30 + 7 new), real Chromium, 1 worker |
| 10 | `-F @ghostsync/kit test` | 0 | 42 files, 112 tests (baseline 42 / 112) |

One earlier capsule test run failed: the three async property tests exceeded Vitest's default 5 s per-test budget on a slower machine pass (assertions had passed). SUPERSEDED by the review resolution: the 60 s budget was removed; see implementation-review.md (Review resolution). One browser run failed only because port 4319 was still held by a leftover server from an interrupted run; a rerun after it was free passed.

## Property metrics (fast-check, from real RunDetails)

| Property | result | seed | numRuns | numSkips | numShrinks |
|---|---|---|---|---|---|
| capsule commutativity | PASS | 424242 | 200 | 0 | 0 |
| capsule associativity | PASS | 424242 | 200 | 0 | 0 |
| capsule idempotency | PASS | 424242 | 200 | 0 | 0 |

Each property is checked against a direct Kit reference. The Kit's own 8 properties still pass (seed 424242, 200 runs).

## Chromium scenarios (separate from unit/static evidence)

New specs, all passed:
1. `capsule-transfer`: download -> upload both ways between two independent contexts (distinct replicaIds `replica-A`/`replica-B`), real downloaded `.gscap` files saved to disk and uploaded with `setInputFiles`, networking disabled after both harnesses loaded, bidirectional exchange converges, imported data survives reload.
2. `capsule-transfer`: garbage with a `.gscap` name is rejected as `Malformed` (nothing applied); a real capsule named `.png` is accepted (name/type are hints); a capsule for another document is `DocumentIdentityMismatch`.
3. `capsule-transfer`: a `File` over the raw limit is rejected from `File.size` with `arrayBuffer()` never called.
4. `capsule-transfer`: download button and file input are keyboard reachable with a visible 3px focus outline.
5. `capsule-persistence`: imported legacy and structured data survive reload after a successful flush.
6. `capsule-persistence`: genuine aborted write (`armWriteAbortOnce`) gives `applied:true, persisted:false`, `TransactionAbortError`, state `"error"`, data readable, retry flush reaches `saved`, durable after reload.
7. `capsule-persistence`: unconditional merged-size regression, target `maxBytes: 1024`: **S1 = 26 bytes** (< 1024, flush saved), import gives `applied:true, persisted:false`, `saveError.code = QuotaExceededError` with message containing `snapshot exceeds maxBytes`, **S_merged = 2100 bytes** measured via `exportHex` after import (> 1024), state `"error"`, both keys readable, second flush `{ ok:false, code:"QuotaExceededError" }`.

## Known limitations

- Task 7.1 is unchecked: commands were run in the working tree, not from a clean checkout without `dist/` and `node_modules`.
- Download URL revocation is verified by the harness counters (created equals revoked); the revoke runs on a 1 s timer.
- Review findings and resolutions are in implementation-review.md (Review resolution). Property tests run under the default 5 s budget and remain load-sensitive (see there).
- Chromium only; no other browsers.
- Size caps bound memory, not CPU cost of applying a crafted in-bounds Yjs update.
- `docs/progress.md` already had uncommitted pre-existing planning edits; this step only appended a section.
