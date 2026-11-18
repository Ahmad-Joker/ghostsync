# file-capsules — Requirements

## Summary

`@ghostsync/capsule` (new `packages/capsule`) is a reusable, framework-agnostic
package that encodes a GhostSync replica's **full-state** update into a
versioned, integrity-checked **file capsule** and decodes/validates/imports one
back into a target replica. It is the first concrete realization of the product
**file-transfer tier** (the reliable baseline) and layers strictly on top of the
Kit's public update boundary (`Replica.exportState()` / `Replica.applyUpdate()`)
and, for the browser flow, the Persist session (`PersistSession`). It does **not**
reimplement CRDT merge or IndexedDB persistence, and it does **not** duplicate the
SDK's in-document `SchemaIdentity` collection metadata.

The capsule **codec and import logic** are pure, environment-neutral, and
browser-safe (no `node:` imports in `src`). The actual browser file-picker and
download wiring live **only in the existing Persist test harness** — never in the
shipped package and never as an application UI.

### Scope boundary (what this milestone builds vs. defers)

- **Builds:** full-state capsule encode/decode/validate/import; a versioned
  binary file format; app + document identity checks; SHA-256 integrity;
  pre-parse and pre-apply size bounds; a typed error contract; idempotent repeat
  import; reject-before-mutate; a browser import that distinguishes in-memory
  import success from durable persistence; harness-only download/import controls.
- **Defers:** differential (state-vector) capsules; QR / animated-QR transfer;
  schema editor; encryption; compression; network synchronization; any
  application UI. (`Replica.exportStateVector()` / `exportDiff()` already exist in
  the Kit but are explicitly out of scope for this capsule format version.)

### Assumptions (inferred; flagged for the design review)

1. The Kit full-state export is `Replica.exportState(): TransportUpdate` with
   `{ documentId: string; kind: "full"; bytes: Uint8Array }`
   (`packages/kit/src/types.ts`, `replica.ts`). The capsule carries **only**
   `kind: "full"` bytes for format version 1. **Confirmed against source.**
2. The in-memory import target is anything exposing
   `applyUpdate(carrier: unknown): ApplyOutcome` with a top-level
   `documentId: string` — satisfied by `Replica`. The persisted import target is
   the structural surface `{ identity: { readonly app: string; readonly
   documentId: string }; applyUpdate; flush; getState }` (a **minimal structural
   projection**, an interface requirement only — not a second persisted-identity
   implementation, and **not imported from `@ghostsync/persist`**). A real
   `PersistSession`, whose `identity` is `ResolvedIdentity { app, documentId,
   replicaId }`, satisfies it **unchanged by structural typing** (the extra
   `replicaId` is fine), without a wrapper and without any change to
   `PersistSession` — note `PersistSession` exposes its identity only as
   `session.identity.{app,documentId}`, **not** as a top-level `documentId`
   (`packages/persist/src/types.ts`, `identity.ts`). The capsule depends on these
   structural surfaces, not on a concrete class. **Confirmed against source.**
3. "App identity" is the existing `SchemaIdentity.app` namespace string
   (`packages/kit/src/adapter.ts`), e.g. `"fieldledger"` | `"patchboard"`. The
   capsule records a single top-level `app` string and does **not** introduce a
   second schema system; per-collection `SchemaIdentity` meta continues to travel
   inside the Yjs update bytes untouched. **Confirmed against source.**
4. SHA-256 is available via Web Crypto `crypto.subtle.digest("SHA-256", ...)` in
   both the browser and Node 24 (the Kit/Persist already rely on it —
   `packages/persist/src/record.ts` `sha256Hex`). No new runtime dependency is
   required. Because `crypto.subtle.digest` returns a `Promise`, **every public
   function that computes or verifies the checksum is asynchronous** (`encodeCapsule`,
   `decodeCapsule`, `importCapsuleInto`, `importCapsuleIntoPersisted` all return a
   `Promise`); only purely-structural internal helpers stay synchronous. No
   dependency is introduced to keep synchronous signatures. **Confirmed against
   source.**
5. Node 24 and modern browsers provide `TextEncoder`/`TextDecoder` and
   `DataView` globally; the codec uses only these platform primitives.

---

## Functional Requirements

### REQ-CAP-001 — Full-state capsule encode/decode (round trip)
The package exposes an **async** `encodeCapsule(input): Promise<Uint8Array>` that
produces a single self-describing capsule byte array from an app id, document id,
and a Kit **full-state** update, and an **async** `decodeCapsule(bytes, opts):
Promise<DecodedCapsule>` that parses and fully validates a capsule back into its
components without applying anything. `encodeCapsule` accepts the full-state bytes
or the whole `TransportUpdate`; a `TransportUpdate` whose `kind` is not `"full"`
(e.g. a diff) is rejected at the boundary, and a `TransportUpdate` whose
`documentId` differs from `input.documentId` is likewise a `TypeError` thrown
**before hashing** (and before any `await`). A raw `Uint8Array` input carries **no
independently checkable document identity**; its identity remains the **caller's
responsibility**. Both functions are asynchronous because
they compute/verify a SHA-256 via `crypto.subtle.digest`. Differential capsules
are out of scope for this version.

### REQ-CAP-002 — Explicit versioned file format
The capsule is a concrete, documented binary container with a fixed ASCII magic,
a numeric format version, a length-prefixed UTF-8 JSON metadata section, and the
raw full-state update bytes. The file has a defined **extension**, **media type**,
**byte encoding**, **endianness**, and **per-field validation rules**. Any input
that does not conform is rejected with a distinguishable typed error. The header
version byte maps `1` → supported, `0` → `Malformed`, `2..255` →
`UnsupportedVersion`; if the header byte is `1` but `metadata.formatVersion` is
not `1` (the two **disagree**) the capsule is `Malformed`. Metadata is
decoded with **fatal UTF-8** — `new TextDecoder("utf-8", { fatal: true, ignoreBOM:
true })`, where `ignoreBOM: true` **keeps** a leading U+FEFF rather than stripping
it — and a leading UTF-8 BOM (`EF BB BF` at metadata offset 0) is rejected
`Malformed` **before** the token scan. The decoded text is then processed by a **JSON-aware token scan** that
records each top-level member's decoded name and raw value span (as UTF-8 byte
offsets), rejects duplicate decoded keys (including escaped equivalents), and
requires the `sha256` value to be exactly 64 literal lowercase ASCII hex characters
with no JSON escapes (otherwise `Malformed`).

### REQ-CAP-003 — App + document identity carried and checked before apply
The capsule carries the source **app** identity and **documentId**. On import,
both are checked **before any bytes are applied** (and, on the persisted path,
before any flush) against **one authoritative source per path**:

- **Plain replica helper** `importCapsuleInto(target, bytes, expected, opts?)`:
  app against the explicit `expected.app`; document id against the `Replica`'s
  top-level `target.documentId`.
- **Persisted helper** `importCapsuleIntoPersisted(target, bytes, opts?)`: **both**
  `target.identity.app` **and** `target.identity.documentId` govern. There is **no
  expected-app argument and no `documentId` parameter**, so a caller cannot weaken
  the session's identity. A capsule with the *correct* `documentId` but belonging
  to *another app* is rejected `AppIdentityMismatch` before apply and flush.

A caller-supplied identity never overrides the target's actual identity. A
mismatch is a distinguishable rejection and mutates nothing. The capsule reuses
the Kit's identity notions (`SchemaIdentity.app`, `Replica.documentId`) and
introduces no competing schema system, and takes no dependency on
`@ghostsync/persist` types (`PersistTarget.identity` is the minimal structural
projection `{ readonly app: string; readonly documentId: string }`).

### REQ-CAP-004 — SHA-256 integrity with an exact covered-byte definition
The capsule carries a lowercase-hex SHA-256 digest over a **precisely defined,
reproducible byte region**. Decode recomputes the digest over the same region and
rejects a mismatch. The `sha256` value span is located by the metadata token scan
over the **received bytes** (hash over offsets 7..end with the 64-byte value
replaced by 64 ASCII `"0"`); a regex-only key scan or JSON re-serialization MUST
NOT be used. The format and docs state explicitly that the checksum
**detects corruption but does not authenticate the sender** (integrity, not
authenticity).

### REQ-CAP-005 — Finite size limits enforced before expensive work
The decoder enforces a configurable **raw capsule size cap before parsing** and a
configurable **decoded-update size cap before applying**. Both default to a
finite value. The docs state honestly that size limits bound memory but do **not**
protect against arbitrary CPU/memory attacks from maliciously crafted but
in-bounds Yjs bytes.

### REQ-CAP-006 — Distinguishable typed error contract
Every capsule-content or operational rejection path (malformed/untrusted capsule
bytes, identity, SDK, target, size limits, platform capability) yields a single,
documented error type carrying a discriminating `code`; programmer misuse is a
documented `TypeError` instead (see the per-function split below and AC-CAP-006-1).
Codes distinguish at least: unsupported version, malformed
input, app-identity mismatch, document-identity mismatch, oversized raw input,
oversized decoded update, checksum mismatch, SDK rejection (the Kit's
`ApplyOutcome` reasons mapped through), **target unavailable** (the target's
`applyUpdate` threw, e.g. a closed `PersistSession`; nothing applied), and
**`CryptoUnavailable`** (`crypto.subtle.digest` missing or failing: a missing
platform capability, `cause` preserved, never labelled `Malformed`). The full union
is `UnsupportedVersion | Malformed | AppIdentityMismatch | DocumentIdentityMismatch |
OversizedRaw | OversizedDecoded | ChecksumMismatch | SdkRejection | TargetUnavailable |
CryptoUnavailable`.

The contract separates two failure classes **per function**: a documented
**`TypeError`** is a *programmer error* (wrong argument types/shape,
`SharedArrayBuffer`-backed bytes, a diff-kind or document-id-mismatched
`TransportUpdate` or non-canonical `createdAt` at encode, invalid `opts`); a **`CapsuleError`** is an *input
rejection* of well-typed bytes that are not an acceptable capsule (or are rejected
by identity, SDK, or target). A missing/failing SHA-256 capability is neither: for
`encodeCapsule`, `decodeCapsule` and both import helpers it rejects
`CapsuleError("CryptoUnavailable")` (so `encodeCapsule`'s only possible
`CapsuleError` is `CryptoUnavailable`; all its other failures stay `TypeError`).
Successful capsule helper results are
`{ applied: true, … }` — never `ok: true` (`ok` is the Kit's `ApplyOutcome` field).
The per-function table lives in `design.md`.

### REQ-CAP-007 — Repeated imports are safe and converge
Importing the same capsule twice (or importing capsules in any order) is safe and
converges, inheriting the Kit's CRDT idempotency/commutativity via
`applyUpdate`. The capsule layer adds no state of its own that could break this.
Import is a merge: importing an **empty source document's** capsule **preserves an
existing target's data** (a fresh target stays empty; a populated target is
unchanged).

### REQ-CAP-008 — Rejected capsules never change replica state
On **any** rejection (format, version, identity, size, checksum), nothing is
applied and the target replica's observable state is byte-for-byte unchanged. The
only path that calls `applyUpdate` is after all pre-apply checks pass.

### REQ-CAP-009 — Import success and durable persistence are distinct outcomes
For the browser/Persist path, the one-call async import reports **two distinct
facts**: (a) `applied` — whether the update was accepted into the in-memory
replica, and (b) `persisted` — whether the subsequent persist **flush** succeeded.
Only a **successful apply followed by a failed flush** may produce
`{ applied: true, persisted: false, saveError }`. When `flush()` fails on a
**still-open** session (e.g. `TransactionAbortError` / `QuotaExceededError`, which
route through the session's fail-save to the `"error"` state), the result is an
unsaved-but-**recoverable** state that **preserves the accepted in-memory data**
(readable via `getState()`). A session terminated after a successful apply but
during `flush()` (`ClosedError`) is a distinct terminal path: still `applied: true,
persisted: false` with the typed error, but in-memory access is **not** guaranteed
after disposal and this is **outside** the recoverable-save guarantee.

A target that is **closed/recovery/terminated BEFORE apply** cannot be reported as
applied: its `applyUpdate` throws, the apply never happened, and the helper rejects
`CapsuleError("TargetUnavailable")` (no flush attempted).

An incoming update's size limit does **not** guarantee the *merged* document fits
Persist's save limit (`maxBytes`, default `DEFAULT_MAX_BYTES`). A merged snapshot
exceeding it surfaces as a **persistence failure** per the Persist contract
(`applied: true, persisted: false`, `saveError` a `QuotaExceededError`), **not** as
a capsule rejection.

### REQ-CAP-010 — Browser controls live only in the existing harness
File download and file-picker upload controls are added to the **existing Persist
browser harness** (`packages/persist/harness`) only. No application UI, QR,
encryption, compression, or network synchronization is added anywhere.

---

## Non-Functional Requirements

### NFR-CAP-001 — Browser-safe, strict-TS source
`packages/capsule/src/**` contains no `node:` imports and no Node-only globals
(`process`, `__dirname`, `require`), mirroring the Kit's
`no-node-imports.test.ts` static scan. The package compiles under the same strict
tsconfig settings as the Kit/Persist (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `NodeNext`) with no `any`.

### NFR-CAP-002 — Minimal dependency graph
The package adds exactly one workspace dependency, `@ghostsync/kit`
(`workspace:*`), and reuses the pinned dev tooling already in the repo
(`typescript@7.0.2`, `vitest@5.1.0`, `@types/node@24.19.2`; `fast-check@4.10.2`
for property tests; the Persist Playwright/Vite toolchain for harness e2e). No new
runtime dependency. The dependency graph is acyclic: `kit <- capsule`; Persist's
harness alone consumes capsule (devDependency); there is **no `capsule -> persist`
edge** (not even type-only); the harness lives inside the persist package, so
`packages/persist/package.json` gains `@ghostsync/capsule: "workspace:*"` as a
**devDependency** (`persist -> capsule` is the only new cross edge; still acyclic
because capsule imports only kit). **Adding the new workspace package/importer DOES
change `pnpm-lock.yaml`.** The implementation MUST run a normal
`pnpm.cmd install` to regenerate the lockfile and **then** verify with
`pnpm.cmd install --frozen-lockfile`.

### NFR-CAP-003 — Deterministic, specified buffer ownership
Encode, decode, and import have explicit copy/alias semantics (stated in design and
asserted by tests): returned buffers are caller-owned and the codec retains no
reference to caller-supplied buffers. Because the functions are async, each
**copies the caller's bytes into an owned snapshot after the raw-size check and
BEFORE its first `await`**; parsing, hashing, the returned value, and the bytes
applied are all derived from that same snapshot (never re-read from the caller's
buffer), so the validated payload is always the applied payload even if the caller
mutates its buffer mid-flight. `SharedArrayBuffer`-backed input is **rejected with
a documented `TypeError`** for this milestone (no atomic-snapshot promise).

### NFR-CAP-004 — No secrets or PII in artifacts
The capsule format, package, and any harness controls carry no keys, tokens, or
PII, consistent with the security steering.

---

## Acceptance Criteria

Each criterion is testable and maps to a named planned test in `design.md` /
`tasks.md`. **No test is claimed to have run** in this planning milestone.

### Round trip and format
1. **AC-CAP-001-1** — GIVEN a replica with scalar + collection data, WHEN its
   `exportState().bytes` are `await encodeCapsule(...)`-ed and the result
   `await decodeCapsule(...)`-ed, THEN decode resolves the original `app`,
   `documentId`, and an `update` byte array **deep-equal** to the input bytes
   (async round-trip).
2. **AC-CAP-001-2** — GIVEN a decoded capsule's update bytes applied to a fresh
   target replica with the same `documentId` via `importCapsuleInto`, THEN the
   helper resolves `{ applied: true, … }` and the target's `getState()` equals the
   source's.
3. **AC-CAP-002-1** — GIVEN an encoded capsule, THEN its first 6 bytes equal the
   ASCII magic `GSCAP\0`, byte 6 equals format version `1`, and the metadata JSON
   parses to an object with exactly the specified fields and types, with
   `createdAt` in strict ISO-8601 UTC (`toISOString()` form).
4. **AC-CAP-002-2** — WHEN the magic, version byte, or length framing is altered,
   THEN decode rejects (`await … .rejects`) with the mapped typed error and applies
   nothing.
5. **AC-CAP-002-3** — GIVEN `encodeCapsule` called with a `TransportUpdate` whose
   `kind` is `"diff"`, THEN it rejects with a `TypeError` at the boundary and
   produces no capsule (format v1 is full-state only).
6. **AC-CAP-002-4** — GIVEN metadata whose raw text repeats a top-level key
   (including a second `sha256` or an escaped equivalent such as `"\u0073ha256"`),
   WHEN decoded, THEN decode rejects with a **malformed** error **before** hashing
   (so the `sha256` placeholder span is unambiguous). A non-canonical `createdAt` (e.g. `"1/1/2026"` or a non-`Z`
   offset) is likewise **malformed** on decode / a `TypeError` on encode.
6a. **AC-CAP-002-5** — GIVEN `encodeCapsule` called with a `TransportUpdate` (not raw
    bytes), THEN it requires `kind === "full"` **and** `update.documentId ===
    input.documentId`; a disagreement rejects with a `TypeError` **before hashing**
    (and before any `await`; `crypto.subtle.digest` is not called) and produces no
    capsule. A matching full `TransportUpdate` encodes. A raw `Uint8Array` input has
    no independently checkable identity: it encodes with the **caller-asserted**
    `input.documentId` (no cross-check is possible; identity is the caller's
    responsibility). Planned tests (`encode-kind.test.ts`): "encode rejects a
    TransportUpdate whose documentId differs from input.documentId (TypeError, before
    hashing)", "encode accepts a matching full TransportUpdate", "encode of raw bytes
    uses the caller-asserted documentId".
6b. **AC-CAP-002-6** — Header version byte: `1` → decodes; `0` → `Malformed`;
    `2` and `255` (and the whole `2..255` range) → `UnsupportedVersion`. GIVEN header
    byte `1` but `metadata.formatVersion` ≠ `1` (e.g. `2`), THEN decode rejects
    `Malformed` (the header and metadata versions disagree), before hashing, never
    `UnsupportedVersion`. Planned tests (`version.test.ts`).

### Identity
7. **AC-CAP-003-1** — GIVEN a capsule whose `app` differs from the explicit
   `expected.app` passed to the **plain replica helper** `importCapsuleInto`, THEN
   the result is an **app-identity-mismatch** rejection and the target state is
   unchanged. (The persisted helper has no expected-app argument; see AC-CAP-003-3/4.)
8. **AC-CAP-003-2** — GIVEN a capsule whose `documentId` differs from the target
   replica's `documentId`, WHEN imported via `importCapsuleInto`, THEN the result
   is a **document-identity-mismatch** rejection and the target state is unchanged
   (this check precedes any apply and does not rely on the Kit's own
   `documentIdMismatch`).
9. **AC-CAP-003-3** — GIVEN a `PersistSession` target and a capsule whose
   `documentId` differs from `target.identity.documentId`, WHEN imported via
   `importCapsuleIntoPersisted(target, bytes, opts?)`, THEN the result is a
   **document-identity-mismatch** rejection governed by the **target's** identity
   (there is no `documentId` or expected-app parameter, so no caller value can
   override it), and the state is unchanged and `flush` was not called.
9a. **AC-CAP-003-4** — GIVEN a persisted target and a capsule with the **correct
    `documentId` but belonging to ANOTHER app** (`metadata.app !==
    target.identity.app`), WHEN imported via `importCapsuleIntoPersisted`, THEN it
    rejects `AppIdentityMismatch` **before apply and before flush**, the replica
    state is deep-equal before/after, and `flush` was not called (planned test:
    "persisted import rejects correct documentId with another app before apply and
    flush").
9b. **AC-CAP-003-5** — GIVEN a value whose static type is the real `PersistSession`,
    THEN the Persist **harness TypeScript** passes it to
    `importCapsuleIntoPersisted(...)` (and binds it as `const target: PersistTarget`)
    **unchanged — no cast, no `any`, no wrapper** (extra `replicaId` allowed). Because
    the capsule cannot import Persist, this is proven only in the harness, and a hand-
    written structural fake alone is not evidence. It is verified by
    `pnpm.cmd -F @ghostsync/persist typecheck` (`tsc --noEmit -p tsconfig.json`, whose
    `include` has `harness/**/*.ts`), which fails if the compatibility breaks and which
    requires the Kit and Capsule builds to have run first (capsule resolves through
    its `dist/index.d.ts`). A passing result is recorded only when it is actually run
    at implementation time.

### Integrity
10. **AC-CAP-004-1** — GIVEN a valid capsule with a single flipped **update-payload**
    byte (a mutation that still passes magic/version/framing/metadata/size
    checks), WHEN decoded, THEN decode rejects with **checksum-mismatch**. This is
    **not** claimed for every flipped byte: flipping a magic, version,
    length-prefix, or metadata byte may correctly fail *earlier* with its own code
    (`Malformed`, `UnsupportedVersion`, `OversizedDecoded`, …). The tamper tests
    assert the specific expected code per mutation class.
10a. **AC-CAP-004-3** — The `sha256` span is located by the JSON-aware token scan
    (fatal UTF-8 via `TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`;
    decoded member names; raw value spans as UTF-8 byte offsets), so: multi-byte
    (Unicode) content **before** the `sha256` member keeps byte offsets correct and the
    round trip verifies (planned test: "Unicode content before sha256 keeps byte
    offsets correct (round trip verifies)"); escaped-equivalent duplicate keys →
    `Malformed`; any JSON escape, wrong length, uppercase, or non-hex character in the
    `sha256` token → `Malformed`; whitespace/key-order variants verify when the bytes
    are internally consistent (hash is over the received bytes); invalid UTF-8
    metadata → `Malformed`.
10b. **AC-CAP-004-4** — GIVEN metadata that begins with a UTF-8 BOM (bytes `EF BB BF`
    at metadata offset 0, equivalently a decoded leading U+FEFF; the test prepends
    the 3 bytes and adjusts `metaLength` so framing stays consistent), WHEN decoded,
    THEN decode rejects `Malformed` **before the token scan and before hashing**
    (so the code is `Malformed`, not `ChecksumMismatch`). Rationale: `ignoreBOM: true`
    keeps the BOM, and silently accepting it would shift every mapped byte offset by
    3. Planned test: "BOM-prefixed metadata is Malformed".
11. **AC-CAP-004-2** — The checksum is computed over the exact region defined in
    design (metadata-length prefix + metadata bytes + update bytes, in that order),
    the verify recomputes the digest over the **received bytes** with only the
    64-byte `sha256` span swapped to the `"0".repeat(64)` placeholder (it does
    **not** reserialize parsed JSON), and recomputing on an untampered capsule
    reproduces the stored digest exactly (async).

### Size limits
12. **AC-CAP-005-1** — GIVEN a raw input whose length exceeds the configured raw
    cap, WHEN decoded, THEN decode rejects with an **oversized-raw** error
    **before** parsing the metadata or hashing.
13. **AC-CAP-005-2** — GIVEN a capsule whose metadata `updateByteLength` (or the
    actual update region) exceeds the configured decoded cap, WHEN decoded, THEN
    decode rejects with an **oversized-decoded** error **before** `applyUpdate`.

### Error contract
14. **AC-CAP-006-1** — Every failure caused by malformed or untrusted capsule
    CONTENT, or by a documented operational condition (identity mismatch, SDK
    rejection, target unavailable, missing/failing SHA-256 capability, size
    limits), surfaces via a rejected `Promise` as the single capsule error type
    (`CapsuleError`) with a `code` from the documented union; none of these
    surfaces as a bare `Error` or a raw thrown Yjs error. **Programmer misuse is
    explicitly NOT a `CapsuleError`:** wrong argument types/shape,
    `SharedArrayBuffer`-backed bytes, a diff-kind or document-id-mismatched
    `TransportUpdate`, a non-canonical `createdAt`, and invalid `opts` reject with a
    documented `TypeError`, exactly as defined by the per-function error table in
    `design.md` and by AC-CAP-006-4.
15. **AC-CAP-006-2** — GIVEN a capsule whose update bytes are well-formed framing
    but rejected by the Kit (e.g. a `documentIdMismatch` that slips past because
    the caller mis-set expectations, or a `malformedUpdate`), WHEN imported after
    all capsule checks pass, THEN the Kit's `ApplyOutcome.reason` is mapped to the
    capsule **sdk-rejection** code and the target state is unchanged.
16. **AC-CAP-006-3** — GIVEN metadata that lies about `updateByteLength`
    (declared length ≠ remaining bytes) or a truncated capsule, WHEN decoded,
    THEN decode rejects with a **malformed** error.
16a. **AC-CAP-006-4** — Programmer errors (non-`Uint8Array` bytes,
    `SharedArrayBuffer`-backed bytes, wrong-shaped target/expected, invalid `opts`,
    diff-kind or document-id-mismatched `TransportUpdate` or bad `createdAt` at encode) reject with
    `TypeError`; well-typed but invalid capsule bytes reject with `CapsuleError`
    (never the other way round), per the per-function table in `design.md`.
16b. **AC-CAP-006-5** — GIVEN a target whose `applyUpdate` throws (a closed
    `PersistSession`), WHEN imported, THEN the helper rejects
    `CapsuleError("TargetUnavailable")`, **never** resolves `applied: true`, and
    `flush` is not called.

16c. **AC-CAP-006-6** — GIVEN `crypto.subtle` is unavailable or `digest` rejects/throws
    (stubbed in a test and restored afterwards), WHEN `encodeCapsule`, `decodeCapsule`,
    `importCapsuleInto` or `importCapsuleIntoPersisted` needs the digest, THEN it
    rejects `CapsuleError("CryptoUnavailable")` with the original error preserved as
    `cause`; the code is **not** `Malformed`/`ChecksumMismatch` and the message does
    not claim the input was malformed; on the import paths nothing is applied and
    `flush` is not called. A structurally bad capsule still fails with its own earlier
    code (the digest runs last). Planned test: `crypto-unavailable.test.ts`.

### Convergence and non-mutation
17. **AC-CAP-007-1** — Importing the same valid capsule twice resolves
    `{ applied: true, … }` both times and an identical final state after the second
    import (idempotent).
17a. **AC-CAP-007-3** — Importing the capsule of an **empty source document**
    preserves target data: into a *fresh (empty)* target the state stays `{}`; into
    a *populated* target the state is deep-equal before/after.
18. **AC-CAP-007-2** — Two replicas that each make disjoint offline edits,
    exchange capsules **both ways**, and import, converge to one identical state
    regardless of exchange order.
19. **AC-CAP-008-1** — For **every** rejection category, a deep snapshot of the
    target replica state taken before the import equals the snapshot taken after
    the rejected import.

### Persistence distinction (browser)
20. **AC-CAP-009-1** — GIVEN a `PersistSession` target and a valid capsule, WHEN
    imported through the one-call async browser import helper, THEN the result
    reports `applied: true` and, after a successful `flush()`, `persisted: true`;
    a subsequent reopen of the same storage key restores the imported data.
21. **AC-CAP-009-2** — GIVEN an **open** `PersistSession` whose next write fails
    (e.g. an armed `TransactionAbortError` via the harness `armWriteAbortOnce`, or
    a `QuotaExceededError`, which route through the session's fail-save), WHEN a
    valid capsule is imported, THEN the result reports `applied: true` and
    `persisted: false` with the typed persistence error, the in-memory data is
    still present and readable via `getState()`, and the session is in the visibly
    unsaved/recoverable `"error"` state (not silently reported as saved). This
    criterion is scoped to the **still-readable open-session** case; a
    `ClosedError` flush on an already closed/recovery/disposed session is a
    separate terminal/programmer-error path and is **not** covered by this
    recoverability guarantee.
21a. **AC-CAP-009-3** — GIVEN a capsule whose own update is within `maxUpdateBytes`
    but whose merge into the target yields a snapshot above Persist's `maxBytes`,
    WHEN imported via the persisted helper, THEN the result is `applied: true,
    persisted: false` with the Persist `saveError` (`QuotaExceededError`) — a
    persistence failure, **not** a capsule rejection. This is verified by an
    **unconditional (never skipped, never `if`-guarded) real-Chromium test** in
    `capsule-persistence.spec.ts`, using the harness's **existing** `open(handle,
    OpenOptions)` forwarding of `maxBytes` (no persistence-engine change), with this
    deterministic scenario: target opened with `maxBytes: 1024` holding
    `{"t":"small"}` (initial snapshot byteLength `S1`, measured via the same public
    session export API, asserted `S1 < 1024`, and a first flush reaching `"saved"`); incoming capsule from a distinct replica carrying
    `{"payload": "x".repeat(2048)}` (≈ 2.1 KB update, within the default capsule limits
    of 16 MiB / 8 MiB). After the import resolves, the test MEASURES the actual
    post-import full-state update with the existing public session export API
    (`PersistSession.exportBytes()`, surfaced by the harness `exportHex`) and asserts
    its `byteLength` (`S_merged`) is strictly greater than `maxBytes`
    (`S_merged > 1024`); no payload-length arithmetic stands in for that
    measurement. Expected: `applied: true`, `persisted: false`, `saveError.code ===
    "QuotaExceededError"` (message contains "snapshot exceeds maxBytes"), merged data
    readable via `get` (both `"t"` and `"payload"`), session `state === "error"`
    (visibly unsaved), in-memory data preserved (a repeat `flush` still fails, no
    silent success). A fake-flush unit test in `merge-semantics.test.ts` additionally
    covers the mapping only; it is not the sole evidence.
21b. **AC-CAP-009-4** — GIVEN a persisted target closed/terminated **before** the
    import, THEN the helper rejects `TargetUnavailable` (AC-CAP-006-5); only a
    successful apply followed by a failed flush yields `applied: true, persisted:
    false`.

### Buffer ownership (async snapshot)
21c. **AC-CAP-NFR3-1** — GIVEN an ordinary `Uint8Array`, WHEN the caller mutates it
    **immediately after invoking** `encodeCapsule` / `decodeCapsule` /
    `importCapsuleInto` / `importCapsuleIntoPersisted` but **before awaiting**
    completion, THEN the produced/validated/applied payload equals the bytes at call
    time (the validated payload is the applied payload; a later-mutated payload is
    never applied).
21d. **AC-CAP-NFR3-2** — GIVEN `SharedArrayBuffer`-backed bytes, THEN each function
    rejects with a documented `TypeError`.
21e. **AC-CAP-NFR3-3** — GIVEN a completed `encodeCapsule` / `decodeCapsule` call,
    THEN the returned buffers (the encoded capsule; the decoded `update`) are
    caller-owned and do **not** alias the caller's input: mutating the input after
    completion does not change a returned buffer, and mutating a returned buffer
    does not change the input or any later call's result. (Both ownership categories,
    AC-CAP-NFR3-1 mutation-during-async and this non-aliasing-after-completion
    category, are covered by the single `snapshot-ownership.test.ts`.)

### Harness / suite integrity
22. **AC-CAP-010-1** — Two independent browser contexts (distinct `replicaId`s)
    use the harness to **download** a capsule file from one and **upload** it via
    the file picker into the other; the imported data appears in the receiver and
    survives a reload after a successful flush.
23. **AC-CAP-010-2** — The existing SDK, Persist unit, and Persist Chromium suites
    (and the offline acceptance suite) pass **unchanged from the pre-change
    baseline captured at implementation time** — i.e. the assertion is *unchanged*,
    not a fixed count. The current tree contains 42 Kit test **files**, 7 Persist
    unit test **files**, and 9 Persist e2e **spec files** (file counts, confirmable
    from the tree); exact test-**case** counts are **not** asserted here and are
    captured as the baseline when the suites are first run during implementation.
    This milestone adds a package and harness controls; it edits none of the
    existing suites.

---

## Out of Scope

- Differential / state-vector capsules; delta transfer.
- QR and animated-QR transfer tiers; schema editor.
- Encryption, authentication of the sender, signatures, key management.
- Compression of the update payload.
- Network synchronization / any transport other than a file.
- Application UI in `apps/*`; the only UI is harness download/import controls.
- Protecting against arbitrary CPU/memory exhaustion from in-bounds but hostile
  Yjs bytes (explicitly **not** promised; size limits bound memory only).
- Any change to `packages/kit/*`, `packages/persist/src/*`, the harness sync
  logic, apps, manifests, lockfile, dependencies, or existing tests during this
  planning step.

---

## Requirement → acceptance-criteria → planned-test traceability

| Requirement | Acceptance criteria | Planned tests (see design/tasks) |
| --- | --- | --- |
| REQ-CAP-001 | AC-CAP-001-1/2 | `roundtrip.test.ts` |
| REQ-CAP-002 | AC-CAP-002-1/2/3/4/5/6 | `format.test.ts`, `tamper.test.ts`, `encode-kind.test.ts` (incl. documentId cross-check, F3), `metadata.test.ts`, `token-scan.test.ts`, `version.test.ts` |
| REQ-CAP-003 | AC-CAP-003-1/2/3/4/5 | `identity.test.ts` (incl. "persisted import rejects correct documentId with another app before apply and flush"); `pnpm.cmd -F @ghostsync/persist typecheck` over the harness (real `PersistSession` → `importCapsuleIntoPersisted`) for AC-CAP-003-5 |
| REQ-CAP-004 | AC-CAP-004-1/2/3/4 | `checksum.test.ts`, `tamper.test.ts`, `token-scan.test.ts` (incl. "BOM-prefixed metadata is Malformed" and "Unicode content before sha256 keeps byte offsets correct") |
| REQ-CAP-005 | AC-CAP-005-1/2 | `size-limits.test.ts` |
| REQ-CAP-006 | AC-CAP-006-1/2/3/4/5/6 | `errors.test.ts`, `sdk-rejection.test.ts`, `tamper.test.ts`, `target-closed.test.ts`, `crypto-unavailable.test.ts` |
| REQ-CAP-007 | AC-CAP-007-1/2/3 | `converge.test.ts`, `merge.property.test.ts`, `merge-semantics.test.ts` |
| REQ-CAP-008 | AC-CAP-008-1 | `no-mutation.test.ts` |
| REQ-CAP-009 | AC-CAP-009-1/2/3/4 | `capsule-persistence.spec.ts` (Chromium; AC-CAP-009-3 is an unconditional `maxBytes: 1024` merged-size case), `merge-semantics.test.ts` (fake flush, mapping only), `target-closed.test.ts` |
| REQ-CAP-010 | AC-CAP-010-1/2 | `capsule-transfer.spec.ts` (Chromium), unchanged existing suites |
| NFR-CAP-001 | — | `no-node-imports.test.ts`, `typecheck` |
| NFR-CAP-002 | — | `pnpm.cmd install` (regenerates lockfile) then `pnpm.cmd install --frozen-lockfile`; graph review `kit <- capsule` |
| NFR-CAP-003 | AC-CAP-NFR3-1/2/3 | `snapshot-ownership.test.ts` (mutation during the async window; SharedArrayBuffer rejection; returned buffers do not alias caller input) |
| NFR-CAP-004 | — | manual review of format + harness |

---

## Responses to review findings (correction pass)

Revised against `.review/review.md` (CHANGES_REQUESTED: HIGH-1, MEDIUM-1/2/3,
NIT-1/2/3/4) plus the async-contract and checksum-ambiguity corrections. Stable
requirement IDs (REQ-CAP-001..010, NFR-CAP-001..004) are retained; new acceptance
criteria were added (AC-CAP-002-3/4, AC-CAP-003-3) without renumbering existing
IDs. Summary of what changed in this file:

- **HIGH-1 / MEDIUM-1 (identity sources):** REQ-CAP-003 and assumption 2 now state
  one governing document-identity source per path — `Replica.documentId` for the
  in-memory path, `session.identity.documentId` for the persisted path (no
  overriding caller value, no top-level `PersistSession.documentId`). New
  AC-CAP-003-3 covers the session-governed persisted check.
- **MEDIUM-2 (SDK types / strict TS):** stated in design; requirements note the
  async contract and runtime validation on untrusted inputs.
- **MEDIUM-3 (save-failure scope):** REQ-CAP-009 and AC-CAP-009-2 are scoped to
  the still-readable open-session case; the `ClosedError`/terminal path is called
  out as outside the recoverable guarantee.
- **NIT-1 (encode kind):** REQ-CAP-001 + AC-CAP-002-3 require full-state input and
  reject a diff `kind`.
- **NIT-2 (createdAt):** strict ISO-8601 UTC, consistent with design
  (AC-CAP-002-1/4).
- **NIT-3 (test counts):** AC-CAP-010-2 now asserts *unchanged from baseline* and
  distinguishes test-file counts (42/7/9) from unasserted test-case counts.
- **NIT-4 (helper naming):** reflected in design/tasks (`fc-report.ts`).
- **Async-contract:** REQ-CAP-001/004/009 and ACs marked async (`await`,
  `.rejects`).
- **Checksum-ambiguity:** AC-CAP-002-4 (duplicate-key rejection) and AC-CAP-004-2
  (recompute over received bytes, no reserialization) added/strengthened.


## Responses to external findings (correction pass 3)

This pass supersedes older wording above that mentions a `ResolvedIdentity` import,
an expected-app argument on the persisted helper, `ok: true` helper results, or "no
lockfile change". Stable IDs are retained; new acceptance criteria were added
without renumbering. **All tests named are PLANNED; none has been executed.**

| # | Finding | Requirement / AC | Task | Named planned test |
| --- | --- | --- | --- | --- |
| 1 | Persisted identity = `target.identity.app` + `.documentId`; no expected-app argument | REQ-CAP-003; AC-CAP-003-3/4 | 4.3, 5.1 | `identity.test.ts` › "persisted import rejects correct documentId with another app before apply and flush" |
| 2 | No Persist type import; structural `PersistTarget.identity`; acyclic graph; lockfile procedure | REQ-CAP-003; NFR-CAP-002; AC-CAP-003-5 | 1.1, 4.1, 6.1, 6.2, 7.0 | harness use of a real `PersistSession` + `-F @ghostsync/persist typecheck` (strengthened in pass 4, F2); graph/lockfile checks at 7.0 |
| 3 | Byte-exact metadata/checksum token scan | REQ-CAP-002/004; AC-CAP-002-4, 004-2/3 | 2.3, 2.4, 3.2 | `token-scan.test.ts` (Unicode-before-sha256; escaped-equivalent duplicate keys; escaped checksum chars; whitespace/reorder; invalid UTF-8) |
| 4 | Async snapshot ownership; SharedArrayBuffer rejected | NFR-CAP-003; AC-CAP-NFR3-1/2 | 3.1, 3.2, 4.2, 4.3 | `snapshot-ownership.test.ts` |
| 5a | Empty-source import preserves target | REQ-CAP-007; AC-CAP-007-3 | 4.2, 5.1 | `merge-semantics.test.ts` (fresh + populated) |
| 5b | Merged size vs Persist limit | REQ-CAP-009; AC-CAP-009-3 | 4.3, 6.4 | `merge-semantics.test.ts` (fake flush), `capsule-persistence.spec.ts` |
| 5c | Success shape `{ applied: true }` | REQ-CAP-006; AC-CAP-001-2, 007-1 | 3.x, 4.x | `roundtrip.test.ts`, `converge.test.ts` |
| 5d | TypeError vs CapsuleError boundary | REQ-CAP-006; AC-CAP-006-4 | 3.1, 3.2, 4.2, 4.3 | `errors.test.ts` |
| 5e | Flipped-byte claim scoped | REQ-CAP-004; AC-CAP-004-1 | 5.1 | `tamper.test.ts` |
| 5f | Closed-before-apply is not applied | REQ-CAP-009; AC-CAP-006-5, 009-4 | 4.3, 5.1 | `target-closed.test.ts` |


## Responses to correction-3 review findings (correction pass 4)

Source: `.review/correction-3-review.md`. This pass supersedes older wording above
that mentions `ignoreBOM: false`, a conditional "if the harness can open with a small
`maxBytes`" browser test, `Malformed` for a digest failure, an unspecified header
version `0`, or an encode that can never reject with a `CapsuleError`. Stable IDs are
retained; new criteria were added (AC-CAP-002-5/6, 004-4, 006-6) without renumbering,
and AC "10a" now sits directly after AC 10. **All tests named are PLANNED; none has
been executed.**

| # | Finding | Requirement / AC | Task | Named planned test |
| --- | --- | --- | --- | --- |
| F1 | `TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`; leading BOM rejected `Malformed` before the scan; byte offsets preserved for Unicode | REQ-CAP-002/004; AC-CAP-004-3/4 | 2.3, 5.1 | `token-scan.test.ts` › "BOM-prefixed metadata is Malformed", "Unicode content before sha256 keeps byte offsets correct (round trip verifies)" |
| F2 | Real `PersistSession` → `importCapsuleIntoPersisted` in harness TS; persist typecheck after Kit + Capsule builds; clean-checkout order; harness→capsule devDependency | REQ-CAP-003; NFR-CAP-002; AC-CAP-003-5 | 6.1, 6.2, 7.0, 7.1 | `pnpm.cmd -F @ghostsync/persist typecheck` |
| F3 | Encode `TransportUpdate`: `kind === "full"` AND `documentId` equals `input.documentId`, else `TypeError` before hashing; raw bytes = caller responsibility | REQ-CAP-001/006; AC-CAP-002-5 | 3.1, 5.1 | `encode-kind.test.ts` (three named cases) |
| F4 | Concrete unconditional merged-size browser test (`maxBytes: 1024`, existing harness `OpenOptions` forwarding) | REQ-CAP-009; AC-CAP-009-3 | 6.2, 6.4 | `capsule-persistence.spec.ts` |
| F5 | Header version `1` ok / `0` Malformed / `2..255` UnsupportedVersion; header-vs-metadata disagreement `Malformed` | REQ-CAP-002; AC-CAP-002-6 | 2.2, 2.3, 5.1 | `version.test.ts` |
| F6 | `CryptoUnavailable` code (encode, decode, import); `cause` preserved; not `Malformed` | REQ-CAP-006; AC-CAP-006-6 | 2.1, 2.4, 3.1, 3.2, 5.1 | `crypto-unavailable.test.ts` |
| F7 | Acceptance-criterion ordering tidied (IDs unchanged) | — | — | — |

---

## Post-verdict inline edits (after correction-4 CHANGES_REQUESTED; NOT independently reviewed)

The correction-4 review (`.review/correction-4-review.md`, `correction-4-verdict.json`)
returned **CHANGES_REQUESTED** (1 MEDIUM, 2 NIT). Its verdict stands as recorded. The
three findings were then fixed **inline** by the orchestrator with no author/reviewer
workflow and **no new independent approval**:

1. **AC-CAP-006-1** is scoped to malformed/untrusted capsule-content failures and
   documented operational `CapsuleError` codes; programmer misuse stays a documented
   `TypeError` per the per-function table (REQ-CAP-006 intro aligned).
2. **`buffer-ownership.test.ts` is consolidated into `snapshot-ownership.test.ts`**
   (both categories preserved: mutation during the async window, AC-CAP-NFR3-1; and
   returned buffers not aliasing caller input after completion, new **AC-CAP-NFR3-3**;
   SharedArrayBuffer rejection remains AC-CAP-NFR3-2). No existing ID was renumbered.
3. **AC-CAP-009-3** no longer uses the arithmetic `2048 > 1024 − S1`; it measures the
   actual post-import full-state update via the public session export API
   (`PersistSession.exportBytes()` / harness `exportHex`) and asserts its `byteLength`
   `S_merged > maxBytes` (1024). The initial `S1 < 1024` saved-snapshot assertion and
   the `applied:true`, `persisted:false`, `QuotaExceededError`, readable merged data,
   `"error"` state and repeat-flush assertions are unchanged.

All tests named remain **PLANNED; none has been executed.**
