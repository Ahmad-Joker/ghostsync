# file-capsules — Tasks

Planning-only. **Every task is pending; no task is complete and no listed command
has been run.** Tasks are ordered so each builds on verified prior work. Each task
notes the requirement IDs it satisfies.

> Correction pass 3 (external findings; all tasks still pending, no test run): (1)
> `importCapsuleIntoPersisted(target, bytes, opts?)` has **no expected-app argument**;
> `target.identity.app` + `target.identity.documentId` govern, and the plain replica
> helper keeps explicit `expected.app`; (2) the capsule imports **nothing** from
> `@ghostsync/persist` — `PersistTarget.identity` is
> `{ readonly app: string; readonly documentId: string }`, graph `kit <- capsule`
> (no `capsule -> persist`), and the new importer **changes `pnpm-lock.yaml`**
> (`pnpm.cmd install`, then `pnpm.cmd install --frozen-lockfile`); (3) metadata is
> decoded with fatal UTF-8 and located by a JSON-aware token scan (no regex, no
> reserialization); (4) all async functions snapshot-copy input before the first
> `await`, SharedArrayBuffer is a `TypeError`; (5) success is `{ applied: true }`,
> TypeError vs CapsuleError is separated, a target closed before apply rejects
> `TargetUnavailable`, and merged-size overflow of Persist's limit is
> `persisted: false`.
>
> Correction pass 4 (correction-3 review F1-F7; all tasks still pending, no test or
> command run): (F1) metadata decoder is `TextDecoder("utf-8", { fatal: true,
> ignoreBOM: true })` (`true` KEEPS the BOM) and a leading `EF BB BF` is `Malformed`
> before the token scan; (F2) the harness passes a real `PersistSession` to
> `importCapsuleIntoPersisted`, and `-F @ghostsync/persist typecheck` joins the
> verification after the Kit and Capsule builds, from a clean checkout; (F3) encode
> of a `TransportUpdate` requires `kind === "full"` and `documentId` equal to
> `input.documentId` (`TypeError` before hashing); (F4) an unconditional
> `maxBytes: 1024` merged-size Chromium test using the harness's EXISTING
> `OpenOptions` forwarding; (F5) header version `1` ok / `0` Malformed / `2..255`
> UnsupportedVersion, header-vs-metadata disagreement Malformed; (F6) new
> `CapsuleError` code `CryptoUnavailable`; (F7) AC ordering tidied.
>
> Correction-pass note (earlier pass): this revision aligns the tasks with the corrected design —
> `encodeCapsule`/`decodeCapsule`/`importCapsuleInto`/`importCapsuleIntoPersisted`
> are **async** (SHA-256 via `crypto.subtle.digest`); `PersistTarget` is the
> structural `{ identity; applyUpdate; flush; getState }` surface a real
> `PersistSession` satisfies with no wrapper; the persisted document identity is
> governed by `session.identity.documentId` (no `documentId` parameter); encode
> rejects a diff `kind`; `createdAt` is strict ISO-8601 UTC; metadata
> duplicate/ambiguous keys are rejected before hashing; and the shared fast-check
> helper is `tests/fc-report.ts` (no `.test.ts` suffix).

> **Implementation status (file-capsules implementation step; updated from ACTUAL results only).**
> Implemented, unit-tested (capsule vitest, Node), statically typechecked (including the real
> `PersistSession` -> `PersistTarget` use in the harness), and browser-verified in real Chromium.
> Task 7.1 is now CHECKED: see "Snapshot verification" at the end of this file (an earlier working-tree-only run did not suffice). The evidence is recorded in that section and in `docs/progress.md`; `.review/implementation-evidence.md` pre-dates the snapshot run and does NOT contain it.
> The independent code review is a later step and has not happened.
## 1. Package scaffold

- [x] 1.1 Create `packages/capsule/package.json` — `@ghostsync/capsule`,
  `version 0.0.0`, `private`, `type: "module"`, `exports`/`main`/`module`/`types`
  → `dist`, `files: ["dist"]`, scripts `typecheck`/`test`/`build` mirroring the
  Kit, runtime dep `@ghostsync/kit: "workspace:*"` (the ONLY workspace dependency; **no
  `@ghostsync/persist` dependency of any kind**), dev deps
  `@types/node@24.19.2`, `fast-check@4.10.2`, `typescript@7.0.2`, `vitest@5.1.0`
  (exact pins reused). Creating this importer **changes `pnpm-lock.yaml`**; see
  task 7.0 for the install procedure. (NFR-CAP-002)
- [x] 1.2 Create `tsconfig.json` + `tsconfig.build.json` copying the Kit's strict
  settings (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `NodeNext`, `target ES2022`, `lib ES2022`,
  `declaration`). Build config emits `src` only. (NFR-CAP-001)
- [x] 1.3 Create `vitest.config.ts` + `vitest.setup.ts` (node env; fast-check
  global `seed 424242`, `numRuns 200`) mirroring the Kit.

## 2. Format + metadata + errors (no SDK yet)

- [x] 2.1 `src/errors.ts` — `CapsuleError` (with preserved `cause`),
  `CapsuleErrorCode` union `"UnsupportedVersion" | "Malformed" |
  "AppIdentityMismatch" | "DocumentIdentityMismatch" | "OversizedRaw" |
  "OversizedDecoded" | "ChecksumMismatch" | "SdkRejection" | "TargetUnavailable" |
  "CryptoUnavailable"`, `isCapsuleError`. (REQ-CAP-006)
- [x] 2.2 `src/format.ts` — magic/version/offset constants, `DataView` big-endian
  read/write of `metaLength`, header read/write, min-length guard, and the header
  version mapping: byte `1` supported, `0` → `Malformed`, `2..255` →
  `UnsupportedVersion`. (REQ-CAP-002)
- [x] 2.3 `src/metadata.ts` + `src/token-scan.ts` — `CapsuleMetadata`, strict field
  validation, unknown-key rejection, **fatal UTF-8 decode**
  (`new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` — `ignoreBOM: true`
  KEEPS a leading U+FEFF; `false` would strip it), an **explicit leading-BOM
  rejection** (`EF BB BF` at metadata offset 0 → `Malformed`, before the token scan
  and before hashing), a `metadata.formatVersion !== 1` (with header byte `1`) →
  `Malformed` check, and the **JSON-aware token scan**:
  records each top-level member's **decoded name** and **raw value span mapped to
  UTF-8 byte offsets** (not UTF-16 indices), rejects duplicate **decoded** keys
  (incl. escaped equivalents like `"\u0073ha256"`), and requires the `sha256` value
  token to be exactly 64 literal ASCII lowercase hex chars with **no JSON escapes**
  (else `Malformed`). `JSON.parse` is used for value validation only. Also **strict
  ISO-8601 UTC `createdAt`** (`toISOString()` round-trip + ms-`Z` regex).
  **Forbidden:** regex-only key scan, JSON reserialization. (REQ-CAP-002, REQ-CAP-004)
- [x] 2.4 `src/checksum.ts` — **async** `crypto.subtle` SHA-256 (`Promise<string>`)
  over the covered region as lowercase hex; verify recomputes over the **received
  bytes** (the owned snapshot) with only the 64-byte `sha256` span — located by the
  task 2.3 token scan — swapped to the placeholder (NO regex location, NO JSON
  reserialization); constant-shape hex compare. If `globalThis.crypto?.subtle` is
  unusable or `digest` throws/rejects, throw `CapsuleError("CryptoUnavailable", …,
  cause)` with the original error as `cause` (never `Malformed`). (REQ-CAP-004,
  REQ-CAP-006)

## 3. Encode / decode

- [x] 3.1 `src/encode.ts` — **async** `encodeCapsule(input): Promise<Uint8Array>`:
  validate inputs (TypeErrors), **accept `Uint8Array | TransportUpdate` and reject
  a `TransportUpdate` with `kind !== "full"`** (NIT-1) **and require
  `update.documentId === input.documentId` (else `TypeError`, synchronously before
  any hashing or `await`, F3; a raw `Uint8Array` has no checkable identity —
  caller's responsibility)**, default `createdAt` to a
  strict ISO-8601 UTC string, serialize metadata with 64×`"0"` `sha256`, assemble
  header+metadata+update, `await` the hash over offsets 7..end, overwrite the 64
  placeholder bytes in place. **Capture inputs before the first `await`**: copy the
  update bytes into the output assembly and snapshot `app`/`documentId`/`createdAt`
  strings, then hash only that assembly; retain no reference to caller buffers.
  `TypeError` (programmer error) for wrong types, diff kind, `documentId` mismatch,
  bad `createdAt`, and **SharedArrayBuffer-backed** bytes. The only `CapsuleError`
  encode may reject with is `CryptoUnavailable` (digest cannot be computed).
  (REQ-CAP-001, REQ-CAP-002, REQ-CAP-006, NFR-CAP-003)
- [x] 3.2 `src/decode.ts` — **async** `decodeCapsule(bytes, opts):
  Promise<DecodedCapsule>`: the exact validation pipeline (raw-size → magic+version
  → length framing → metadata parse + fields + **duplicate/ambiguous-key
  rejection** + strict `createdAt` + `updateByteLength === M` → decoded-size →
  `await` checksum recompute over received bytes), each failure a named
  `CapsuleError` (rejection; a digest failure is `CryptoUnavailable`, not
  `Malformed`); return copies. Header version: `1` ok, `0` `Malformed`, `2..255`
  `UnsupportedVersion`. **Order:** type check (`TypeError`,
  incl. SharedArrayBuffer) → raw-size check → **`bytes.slice()` owned snapshot, still
  before the first `await`** → everything else reads only the snapshot. Never
  re-read the caller buffer after an `await`.
  (REQ-CAP-001/002/004/005/006, NFR-CAP-003)

## 4. Import helpers

- [x] 4.1 `src/types.ts` — `ReplicaTarget` (`{ documentId; applyUpdate }`),
  `PersistTarget` (**does NOT extend `ReplicaTarget`**; `{ identity: { readonly app:
  string; readonly documentId: string }; applyUpdate; flush; getState }` — the
  minimal structural projection; a real `PersistSession` (identity
  `{ app, documentId, replicaId }`) satisfies it unchanged), `PersistLikeError`,
  `ImportResult` / `PersistImportResult` (success is **`applied: true`**, never
  `ok: true`), `ImportExpectation` (replica helper only). **Import**
  `ApplyOutcome`/`State`/`TransportUpdate` from `@ghostsync/kit` only; **do not import or
  re-export `ResolvedIdentity` or anything from `@ghostsync/persist`**; redefine no
  SDK type. (HIGH-1, MEDIUM-2, REQ-CAP-003)
- [x] 4.2 `src/import.ts` — **async** `importCapsuleInto(target, bytes, expected:
  { app }, opts?)`: `await decodeCapsule` → app check (`expected.app`) → documentId
  check (vs **`target.documentId`**) → `applyUpdate` (in `try`: a throw →
  `CapsuleError("TargetUnavailable")`) from the **decoded snapshot-derived
  `update`**, never the caller buffer → map non-ok to `SdkRejection` → resolve
  `{ applied: true, metadata }`. Empty-source capsule preserves target data (CRDT
  merge). (REQ-CAP-003/006/007/008)
- [x] 4.3 `src/import.ts` — **async** `importCapsuleIntoPersisted(target, bytes,
  opts?)` (**no expected-app argument and no `documentId` parameter**): `await
  decodeCapsule` → app check (vs **`target.identity.app`**) → documentId check (vs
  **`target.identity.documentId`**) — both **before apply and before flush** →
  `applyUpdate` in `try` (throw, e.g. `ClosedError` from a closed/recovery session
  → reject `CapsuleError("TargetUnavailable")`, **never** `applied: true`, flush not
  called) → on `!ok` reject `SdkRejection` → **only after a successful apply**
  `await flush()` → `{ applied: true, persisted, metadata, saveError? }`. A failed
  flush after a successful apply is `persisted:false` (not a rejection): on an open
  session it preserves in-memory data (`"error"`, readable); a merged snapshot above
  Persist's `maxBytes` surfaces here as `QuotaExceededError` (persistence failure,
  not a capsule rejection); a `ClosedError` during flush is the documented terminal
  path. (REQ-CAP-003/009)
- [x] 4.4 `src/index.ts` — public re-exports (constants, types, functions,
  errors; re-export `ApplyOutcome`/`State` from `@ghostsync/kit` only).

## 5. Unit + property tests (mapping below)

- [x] 5.1 Author every test file in the mapping; include `no-node-imports.test.ts`
  scanning `src/**` (mirror the Kit). All encode/decode/import assertions `await`
  the async functions and use `await expect(...).rejects` for rejection cases.
  Any shared property-test helper (the fast-check reporter) is named
  `tests/fc-report.ts` — **without** the `.test.ts` suffix — so the
  `tests/**/*.test.ts` include does not collect it as an empty suite, mirroring
  `packages/kit/tests/fc-report.ts` (NIT-4). New named tests: `encode-kind.test.ts`
  (reject a `kind: "diff"` `TransportUpdate`), `metadata.test.ts`
  (duplicate/ambiguous-key rejection + strict `createdAt`), and the persisted
  identity cases in `identity.test.ts` (identity governed by
  `target.identity.app` + `target.identity.documentId`). Correction-pass-3 PLANNED
  tests (none run):
  - `identity.test.ts` › **"persisted import rejects correct documentId with another
    app before apply and flush"** — `AppIdentityMismatch`, replica state deep-equal
    before/after, `flush` not called. Fakes carry `identity { app, documentId,
    replicaId }`. (AC-CAP-003-4)
  - `token-scan.test.ts` — **"BOM-prefixed metadata is Malformed"** (prepend
    `EF BB BF` to the metadata and bump `metaLength` by 3 so framing stays
    consistent; expect `Malformed`, not `ChecksumMismatch`, proving rejection happens
    before the scan/hash; AC-CAP-004-4); **"Unicode content before sha256 keeps byte
    offsets correct (round trip verifies)"** — multi-byte `app`/`documentId` such as
    `ünï-💾` ahead of the `sha256` member, encode → decode verifies (AC-CAP-004-3);
    **Unicode (multi-byte) content before `sha256`**
    (byte-offset correctness, still verifies); **escaped-equivalent duplicate keys**
    (`"sha256"` vs `"\u0073ha256"` → `Malformed`); **escaped characters inside the
    checksum token** (e.g. `\u0061`), wrong length, uppercase, non-hex → `Malformed`;
    **whitespace and key-reordering variants** (verify when bytes are consistent);
    **invalid UTF-8 bytes in metadata** → `Malformed`. (AC-CAP-002-4, 004-2/3)
  - `snapshot-ownership.test.ts` — mutate the ordinary caller buffer **immediately
    after invoking** `encodeCapsule` / `decodeCapsule` / `importCapsuleInto` /
    `importCapsuleIntoPersisted` but **before awaiting**; assert the produced /
    validated / applied payload equals the call-time bytes (the validated payload is
    the applied payload); a **non-aliasing** category: after `encodeCapsule` /
    `decodeCapsule` complete, mutating the input does not change the returned capsule /
    decoded `update`, and mutating a returned buffer does not change the input; plus a
    **SharedArrayBuffer rejection** test (`TypeError`) for each. This single file
    replaces the former separate `buffer-ownership.test.ts`. (AC-CAP-NFR3-1/2/3)
  - `merge-semantics.test.ts` — **empty source into a fresh target** (stays empty)
    and **into a populated target** (deep-equal before/after); **merged snapshot above
    persist limit ⇒ `applied:true, persisted:false`** using a fake whose `flush`
    rejects with a `QuotaExceededError`-coded error. (AC-CAP-007-3, 009-3)
  - `target-closed.test.ts` — target whose `applyUpdate` throws `ClosedError` ⇒
    `CapsuleError("TargetUnavailable")`, never `applied: true`, `flush` not called;
    a separate case: successful apply then failing flush ⇒ `{ applied: true,
    persisted: false, saveError }`. (AC-CAP-006-5, 009-4)
  - `tamper.test.ts` — a flipped **payload** byte ⇒ `ChecksumMismatch`; flipped
    magic/version/length-prefix/metadata bytes assert their specific earlier error
    (they may yield `Malformed`/`UnsupportedVersion`/…); **never** a blanket
    "any flipped byte ⇒ ChecksumMismatch". (AC-CAP-004-1)
  - `encode-kind.test.ts` (F3) — **"encode rejects a TransportUpdate whose
    documentId differs from input.documentId"** (`TypeError`; spy on
    `crypto.subtle.digest` shows it was not called, and the throw happens before any
    `await`); **"encode accepts a matching full TransportUpdate"**; **"encode of raw
    bytes uses the caller-asserted documentId"** (no cross-check; documents that
    identity is the caller's responsibility); plus the existing diff-kind rejection.
    (AC-CAP-002-3/5)
  - `version.test.ts` (F5) — header byte `1` decodes; `0` → `Malformed`; `2`, `128`
    and `255` → `UnsupportedVersion`; header `1` with `metadata.formatVersion` `2`
    (disagreement) → `Malformed`, never `UnsupportedVersion`. (AC-CAP-002-6)
  - `crypto-unavailable.test.ts` (F6) — with `crypto.subtle.digest` stubbed to throw /
    reject (stub restored in `afterEach`): `encodeCapsule`, `decodeCapsule`,
    `importCapsuleInto`, `importCapsuleIntoPersisted` each reject
    `CapsuleError("CryptoUnavailable")` with the original error as `cause`, code is
    not `Malformed`/`ChecksumMismatch`, and the import cases never call `applyUpdate`
    or `flush`; a structurally bad capsule still yields its own earlier code.
    (AC-CAP-006-6)
  - `errors.test.ts` — per-function `TypeError` (programmer error) vs `CapsuleError`
    (input rejection) boundary; helper success results are `{ applied: true }`, never
    `ok: true`. (AC-CAP-006-4)
  (all REQ/NFR)

## 6. Harness + Chromium e2e (consumes BUILT capsule)

- [x] 6.1 Add `@ghostsync/capsule: "workspace:*"` to `packages/persist/package.json`
  as a **devDependency** (harness consumer only; Persist `src` never imports it;
  graph stays acyclic: `kit <- capsule`, `persist(harness) -> capsule`, no
  `capsule -> persist`: the harness is inside the persist package so the manifest
  edge is `persist -> capsule`, but capsule imports only kit, so no cycle). **This
  also changes `pnpm-lock.yaml`** (as does task 1.1); regenerate via task 7.0.
  Flagged, not performed during planning. (REQ-CAP-010)
- [x] 6.2 Extend `packages/persist/harness/harness.ts` + `index.html` with
  `downloadCapsule` / `importCapsuleFile` controls: `downloadCapsule` does
  `await encodeCapsule({ app: session.identity.app, documentId:
  session.identity.documentId, update: session.exportState() })` → `Blob` download;
  `importCapsuleFile` does `await importCapsuleIntoPersisted(session, bytes)`
  (**no expected-app and no `documentId` arg** — both come from `session.identity`)
  and returns `{ applied, persisted, saveError? }` via the existing `asError`. The
  value passed is the harness's `session(handle)` whose declared type is the real
  `PersistSession` — **no cast, no `any`, no wrapper** — and the harness also has
  `import type { PersistTarget } from "@ghostsync/capsule"` with `const target:
  PersistTarget = session(handle);`. `pnpm.cmd -F @ghostsync/persist typecheck`
  (`tsc --noEmit -p tsconfig.json`; `include` has `harness/**/*.ts`; `paths` maps
  only `@ghostsync/persist` to `src`, so capsule resolves via its built
  `dist/index.d.ts`) therefore fails if a real `PersistSession` stops satisfying
  the structural target (AC-CAP-003-5). Also add the test hooks
  `exportCapsuleHex(handle)` / `importCapsuleHex(handle, hex)` (reusing the harness
  `toHex`/`fromHex`). **No `maxBytes` change**: `open(handle, options: OpenOptions)`
  already forwards `options` to `openReplica` (verified in `harness.ts`; existing
  specs pass `maxBytes: 4`).
  `<input type=file accept=".gscap">`, keyboard-reachable, focus-visible.
  (REQ-CAP-010)
- [x] 6.3 `packages/persist/e2e/capsule-transfer.spec.ts` — two independent
  contexts, distinct `replicaId`s, real download → upload → appears in receiver →
  survives reload after flush. (AC-CAP-010-1)
- [x] 6.4 `packages/persist/e2e/capsule-persistence.spec.ts` — (a) valid import
  persists and survives reopen; (b) an armed `TransactionAbortError`
  (`armWriteAbortOnce`) leaves `applied:true, persisted:false`, data readable,
  session visibly unsaved (AC-CAP-009-1/2); (c) **mandatory, unconditional
  merged-size case** (AC-CAP-009-3; no `if`, no `test.skip`/`fixme`), same `app`
  `"a"` / `documentId` `"d"`, distinct `replicaId`s and `dbName`s:
  1. open `"src"` (default `maxBytes`), `set("payload", "x".repeat(2048))`,
     `exportCapsuleHex("src")` (update ≈ 2.1 KB, far below the 16 MiB / 8 MiB
     capsule defaults);
  2. open `"tgt"` with `maxBytes: 1024` (existing `OpenOptions` forwarding),
     `set("t", "small")`, `flush("tgt")` ⇒ `{ ok: true, state: "saved" }`; read
     `S1 = exportHex("tgt").length / 2` (the byteLength of the public
     `PersistSession.exportBytes()` full-state update) and assert `S1 < 1024` (the
     initial saved snapshot fits; M is the fixed constant 1024);
  3. `importCapsuleHex("tgt", capsuleHex)` ⇒ `applied === true`,
     `persisted === false`, `saveError.code === "QuotaExceededError"`, `saveError
     .message` contains `snapshot exceeds maxBytes` (the real `session.ts` text);
  4. **measure the actual post-import snapshot:** `S_merged = exportHex("tgt").length /
     2` (the byteLength of the public `exportBytes()` full-state update; available
     because the session is open in `"error"`, not closed) and assert **`S_merged >
     1024`** — i.e. the measured merged update exceeds `maxBytes`; no payload-length
     arithmetic is used; `state("tgt") === "error"`; `get("tgt", "t") === "small"` and
     `get("tgt", "payload") === "x".repeat(2048)`; a second `flush("tgt")` is
     `{ ok: false, code: "QuotaExceededError" }` (in-memory data preserved, no silent
     success).

## 7. Final verification (run during implementation, NOT now)

- [x] 7.0 **Install / lockfile (implementation time, NOT now).** After tasks 1.1 and
  6.1 add the new importer/dependency, run a normal `pnpm.cmd install` from the
  workspace root to **regenerate `pnpm-lock.yaml`**, inspect the lockfile diff (only
  the new `packages/capsule` importer and the `@ghostsync/capsule` link under
  `packages/persist`; no unrelated drift), **then** run
  `pnpm.cmd install --frozen-lockfile` and require it to succeed. Do not claim "no
  lockfile change". (NFR-CAP-002)
- [x] 7.1 Run every command in the Verification section **in the stated order, from
  a clean checkout** (fresh clone/worktree of the implementation commit with no
  `dist/` and no `node_modules`, so a stale artifact cannot mask a missing build
  step), and record exit codes and actual test counts. `pnpm.cmd -F
  @ghostsync/persist typecheck` **must pass; it is the evidence for AC-CAP-003-5**
  (real `PersistSession` accepted by `importCapsuleIntoPersisted`). (AC-CAP-010-2)
- [x] 7.2 Confirm the existing SDK, Persist, and offline suites pass unchanged.

---

## Requirement → planned test mapping

| Requirement / AC | Planned test | Kind |
| --- | --- | --- |
| AC-CAP-001-1/2 | `roundtrip.test.ts` (async round-trip) | unit |
| AC-CAP-002-1/2 | `format.test.ts`, `tamper.test.ts` | unit |
| AC-CAP-003-4 | `identity.test.ts` › "persisted import rejects correct documentId with another app before apply and flush" | unit |
| AC-CAP-003-5 | harness passes a real `PersistSession` to `importCapsuleIntoPersisted` + `const target: PersistTarget = session(handle)`; `pnpm.cmd -F @ghostsync/persist typecheck` after Kit + Capsule builds | static |
| AC-CAP-004-3 / 002-4 | `token-scan.test.ts` (Unicode-before-sha256, escaped-equivalent duplicates, escaped checksum chars, whitespace/reorder, invalid UTF-8) | unit |
| AC-CAP-004-1 | `tamper.test.ts` (payload flip ⇒ `ChecksumMismatch`; header/metadata flips may fail earlier) | unit |
| AC-CAP-006-4 | `errors.test.ts` (TypeError vs CapsuleError per function) | unit |
| AC-CAP-006-5 / 009-4 | `target-closed.test.ts` (closed before apply ⇒ `TargetUnavailable`, not applied) | unit |
| AC-CAP-007-3 | `merge-semantics.test.ts` (empty source: fresh + populated target) | unit |
| AC-CAP-009-3 | `capsule-persistence.spec.ts` › merged-size case (task 6.4(c): target `maxBytes: 1024` via existing harness `open` options; unconditional; `applied:true, persisted:false`, `QuotaExceededError`, state `"error"`, data readable) — primary evidence; `merge-semantics.test.ts` (fake flush `QuotaExceededError` ⇒ `persisted:false`) covers the mapping only | Chromium + unit |
| AC-CAP-002-5 | `encode-kind.test.ts` (documentId mismatch ⇒ `TypeError` before hashing; matching full `TransportUpdate` encodes; raw bytes use caller-asserted id) | unit |
| AC-CAP-002-6 | `version.test.ts` (`1` ok, `0` Malformed, `2..255` UnsupportedVersion, header/metadata disagreement Malformed) | unit |
| AC-CAP-004-4 | `token-scan.test.ts` › "BOM-prefixed metadata is Malformed" | unit |
| AC-CAP-004-3 (Unicode) | `token-scan.test.ts` › "Unicode content before sha256 keeps byte offsets correct (round trip verifies)" | unit |
| AC-CAP-006-6 | `crypto-unavailable.test.ts` (`CryptoUnavailable` for encode/decode/import; `cause` preserved; not Malformed) | unit |
| AC-CAP-NFR3-1/2/3 | `snapshot-ownership.test.ts` (mutate after invoke before await ⇒ validated/applied data unchanged; returned buffers do not alias caller input after completion; SharedArrayBuffer ⇒ `TypeError`) | unit |
| AC-CAP-002-3 | `encode-kind.test.ts` (reject `kind: "diff"` TransportUpdate) | unit |
| AC-CAP-002-4 | `metadata.test.ts` (duplicate/ambiguous key + strict `createdAt`) | unit |
| AC-CAP-003-1/2 | `identity.test.ts` (replica path) | unit |
| AC-CAP-003-3 | `identity.test.ts` (persisted path; governed by `session.identity.documentId`) | unit |
| AC-CAP-004-1/2 | `checksum.test.ts` (recompute over received bytes, no reserialize), `tamper.test.ts` | unit |
| AC-CAP-005-1/2 | `size-limits.test.ts` | unit |
| AC-CAP-006-1 | `errors.test.ts` | unit |
| AC-CAP-006-2 | `sdk-rejection.test.ts` (fake target returning each `ApplyOutcome` reason) | unit |
| AC-CAP-006-3 | `tamper.test.ts` (lie about `updateByteLength`; truncate) | unit |
| AC-CAP-007-1 | `converge.test.ts` (duplicate import) | unit |
| AC-CAP-007-2 | `converge.test.ts` (bidirectional) + `merge.property.test.ts` | unit + property |
| AC-CAP-008-1 | `no-mutation.test.ts` (deep before/after over every rejection category) | unit |
| NFR-CAP-003 | `snapshot-ownership.test.ts` (consolidated: both ownership categories) | unit |
| NFR-CAP-001 | `no-node-imports.test.ts` + typecheck | static |
| AC-CAP-009-1/2 | `capsule-persistence.spec.ts` (open-session `armWriteAbortOnce` abort → `applied:true, persisted:false`, readable, `"error"`) | Chromium |
| AC-CAP-010-1 | `capsule-transfer.spec.ts` | Chromium |
| AC-CAP-010-2 | existing SDK/Persist/offline suites run unchanged | regression |

Property coverage (`merge.property.test.ts`, fast-check, seed 424242 / 200 runs):
commutativity (exchange order), associativity (grouped re-import), idempotency
(duplicate import), each asserted to converge against a direct Kit reference.

---

## Exact future verification commands (Windows PowerShell, from the workspace root)

Use `pnpm.cmd` (not `pnpm`). **Do not run these in the planning step.** Expected
new behavior is noted; actual results are recorded only when implementation runs.

Run from a **clean checkout** (a fresh clone/worktree of the implementation commit
with no `dist/` and no `node_modules`; never rely on stale build output). Script
names below were verified against the real `package.json` files: kit has
`typecheck|test|build`; persist has `typecheck|test|build|build:harness|test:browser`;
the planned capsule package mirrors kit (`typecheck|test|build`).

```powershell
# 1. Dependency graph. Adding packages/capsule (task 1.1) and the persist devDependency
#    (task 6.1) CHANGES pnpm-lock.yaml. In the working tree where the manifests were
#    edited, a normal install regenerates it; review the lockfile diff; THEN the frozen
#    check must pass (task 7.0). In the clean checkout (lockfile already committed) only
#    the frozen install is needed, and it must pass:
pnpm.cmd install
pnpm.cmd install --frozen-lockfile

# 2. Kit first: capsule's declarations and persist's src import kit's dist.
pnpm.cmd -F @ghostsync/kit build

# 3. Capsule (imports kit only): typecheck, tests, then build. Its dist/index.d.ts is what
#    the persist typecheck and the harness resolve.
pnpm.cmd -F @ghostsync/capsule typecheck
pnpm.cmd -F @ghostsync/capsule test
pnpm.cmd -F @ghostsync/capsule build

# 4. Persist typecheck (tsc --noEmit -p tsconfig.json; includes harness/**/*.ts). Needs the
#    kit and capsule dist from steps 2-3 (capsule is resolved via node_modules, not paths).
#    This is the evidence that a real PersistSession satisfies PersistTarget (AC-CAP-003-5):
pnpm.cmd -F @ghostsync/persist typecheck

# 5. Persist unit suite (existing, unchanged):
pnpm.cmd -F @ghostsync/persist test

# 6. Persist build: required because vite.config.ts resolves @ghostsync/persist for the
#    harness to its BUILT dist/index.js; the capsule is bundled from its own dist (step 3).
pnpm.cmd -F @ghostsync/persist build

# 7. Bundle the harness, then the Chromium specs (existing + capsule specs):
pnpm.cmd -F @ghostsync/persist build:harness
pnpm.cmd -F @ghostsync/persist test:browser

# 8. Kit suite (existing, unchanged):
pnpm.cmd -F @ghostsync/kit test

# 9. Repo hygiene:
git diff --check
git status --short --branch
```

Dependency note (why this order): `capsule -> kit` only, so steps 2-3 never need
persist; the persist **typecheck** maps `@ghostsync/persist` to `src` through
`tsconfig.json` `paths`, so it does not need the persist build, but it does need
capsule's `dist/index.d.ts`; the **Vite harness build** imports persist's built entry
and the capsule's built entry, so it needs steps 2, 3 and 6.

Expected baseline to preserve (NIT-3): the existing SDK, Persist unit, and Persist
Chromium suites must pass **unchanged from the pre-change baseline captured at
implementation time** — assert *unchanged*, do not hard-code case counts. From the
tree we can confirm only **test-file** counts (42 Kit test files, 7 Persist unit
test files, 9 Persist e2e spec files); the exact test-**case** totals are recorded
as the real baseline when the suites are first run (task 7.1/7.2), not asserted
here. This milestone adds a package and harness controls; it edits none of them.

---

## Post-verdict inline edits (after correction-4 CHANGES_REQUESTED; NOT independently reviewed)

After the correction-4 review returned **CHANGES_REQUESTED** (1 MEDIUM, 2 NIT; verdict
preserved in `.review/`), these were fixed inline with no new independent approval:
(1) AC-CAP-006-1 is scoped to capsule-content/operational `CapsuleError` codes with
`TypeError` retained for programmer misuse (`errors.test.ts`, AC-CAP-006-4);
(2) `buffer-ownership.test.ts` is consolidated into `snapshot-ownership.test.ts`
(AC-CAP-NFR3-1/2/3: mutation-during-async, non-aliasing returned buffers,
SharedArrayBuffer rejection); (3) task 6.4(c) measures the actual post-import
`exportHex` byteLength and asserts `S_merged > 1024` instead of the arithmetic
`2048 > 1024 − S1`. All tasks remain pending (`- [ ]`); no test has been executed.

---

## Snapshot verification (task 7.1) and property split (appended from ACTUAL results)

- Property split: each of commutativity/associativity/idempotency is now 4 separately named
  Vitest tests of exactly 50 generated cases (12 batch tests). Fixed seeds 424242, 424243,
  424244, 424245 (batches 1..4; the same four are reused by every property). Each batch asserts
  `numRuns === 50` and `numSkips === 0`; an `afterAll` asserts 4 x 50 = 200 per property.
  Generators, property bodies, assertions, shrinking and `reportRun` are unchanged.
- Capsule suite: 20 files / 111 tests before; 20 files / 120 tests after (111 - 3 + 12).
- The earlier 60 s property timeouts remain removed; the default 5 s timeout is in force. No retries,
  skips or timeout overrides.
- Working-tree run: capsule typecheck exit 0; capsule test exit 0, 20 files / 120 tests; all 12
  batches printed `result=PASS numRuns=50 numSkips=0 numShrinks=0`.
- Fresh snapshot (working tree copied by robocopy to a temp dir outside the repo, no node_modules,
  no dist, no .git/.agents/.review-artifacts; lockfile hash identical to the working copy), run
  in this order, ALL exit 0: `install --frozen-lockfile`; kit build; capsule typecheck; capsule test
  (20 files / 120 tests); capsule build; persist typecheck; persist test (7 files / 50 tests);
  persist build; persist build:harness; persist test:browser (Chromium, 37 passed); kit test
  (42 files / 112 tests). No `playwright install` was needed.
- Three sequential `vitest run --reporter=verbose` re-runs in the snapshot: all exit 0, 20 files /
  120 tests each, no timeouts. Slowest batch in them: associativity batch 2/4 and 3/4 around 215-220 ms
  (run 2). Slowest overall incl. the working-tree run: associativity batch 1/4, seed 424242, 668 ms.
- Status wording: implemented, unit-tested and browser-verified earlier in the working tree; now
  independently re-verified from a fresh snapshot. The independent code review is still a later step.

### Independent re-run of the snapshot verification (orchestrator, separate from the agent's run)
- A second, separate fresh snapshot was built by robocopy to a temp dir outside the repo: 199 files
  (equal to the working tree excluding generated output), `pnpm-lock.yaml` hash identical to the working copy,
  `packages/capsule`, `capsule-transfer.spec.ts` and `capsule-persistence.spec.ts` present, 0 `node_modules` / `dist` /
  `.git` / report directories before install. The real index and branch were not touched.
- From it, ALL exit 0: `install --frozen-lockfile`; kit build; capsule typecheck; capsule test (20 files / 120 tests);
  capsule build; persist typecheck; persist test (7 files / 50 tests); persist build; persist build:harness;
  `persist test:browser` (real Chromium, 37 passed in 25.7 s, 7 capsule scenarios; merged-size case printed
  `maxBytes=1024 S1=26 S_merged=2100`); kit test (42 files / 112 tests).
- Three sequential `vitest run --reporter=verbose` capsule invocations in that snapshot: all exit 0, 20 files / 120 tests,
  12 of 12 batches `numRuns=50 numSkips=0 numShrinks=0 PASS` each time, seeds 424242-424245, no timeouts. Slowest
  property batch: commutativity batch 1/4 (seed 424242, cold start), 262 ms against the default 5000 ms budget.
  Three more verbose runs in the working tree: all exit 0, slowest batch 145 ms.
- That snapshot was deleted after the run. A kit-suite failure (2 tests) was recorded once earlier in this milestone
  right after a browser run, then passed on rerun; it did not recur in any run above, and is noted as an unexplained
  one-off, not fixed (kit is out of scope here).
