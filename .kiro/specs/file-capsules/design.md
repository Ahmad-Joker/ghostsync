# file-capsules — Design

## Overview

`@ghostsync/capsule` is a new browser-safe package at `packages/capsule` that
turns a GhostSync replica's full-state update into a single, self-describing,
integrity-checked **file capsule** and back. It sits strictly above the Kit's
public update boundary: it reads bytes from `Replica.exportState()` and writes
bytes into `Replica.applyUpdate()` / `PersistSession.applyUpdate()`. It owns
**no CRDT logic and no storage**; merge stays a pure function inside the Kit, and
durability stays inside Persist. The capsule layer owns exactly three things:
the versioned **wire format**, the **validation pipeline** (size → framing →
metadata → decoded-size → checksum → identity → SDK apply), and the **typed error
contract**. The browser file-picker/download wiring is confined to the existing
Persist test harness and is not part of the shipped package.

**Async boundary (crypto.subtle).** SHA-256 is computed and verified with
`crypto.subtle.digest`, which returns a `Promise`. Every public function that
hashes or verifies a checksum is therefore **asynchronous** and returns a
`Promise`: `encodeCapsule` (computes the digest), `decodeCapsule` (verifies it),
and the two import helpers (`importCapsuleInto` / `importCapsuleIntoPersisted`,
both of which call `decodeCapsule`). The only synchronous helpers are the
purely-structural ones that do **no** hashing — header/length framing reads and
metadata field validation — and they are internal; the public surface is
uniformly async. No dependency is introduced to keep a synchronous signature.
See **Public API** and **Which functions are async vs sync** below.

**Snapshot-first (async ownership, correction pass 3).** Because every public
function awaits a digest, the caller could mutate its buffer between the call and
the digest resolving. Therefore each function does its synchronous argument/size
checks and then **copies the caller's bytes into an owned snapshot BEFORE its first
`await`**; parsing, hashing, the returned value, and (for import) the bytes handed to
`applyUpdate` are all derived from that one snapshot, never from the caller's
buffer again. See **Buffer ownership and copying**.

This design fits the established monorepo pattern: an ESM, strict-TS,
`src`-only-emitted package exactly like `packages/kit` and `packages/persist`,
picked up by the existing `pnpm-workspace.yaml` `packages/*` glob with no change to
`pnpm-workspace.yaml`. **Adding the new workspace package/importer DOES change
`pnpm-lock.yaml`** (a new `packages/capsule` importer entry, and later a
`@ghostsync/capsule` link under `packages/persist`); see **Dependency / build
order** for the install procedure.

## Technology stack (locked once approved)

- **Language/build:** TypeScript `7.0.2`, strict, `module`/`moduleResolution`
  `NodeNext`, `target` `ES2022`, `declaration: true`, `verbatimModuleSyntax`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — identical to the Kit
  and Persist tsconfigs. Two tsconfigs: `tsconfig.json` (typecheck incl.
  tests/config) and `tsconfig.build.json` (`src`-only emit to `dist/`).
- **Runtime dependency:** `@ghostsync/kit` (`workspace:*`) only (graph:
  `kit <- capsule`; **no** `capsule -> persist` edge, not even type-only). No other
  runtime dependency. SHA-256, `TextEncoder`/`TextDecoder`, and `DataView` come from the
  platform (Web Crypto + ECMAScript globals), available in both Node 24 and
  browsers.
- **Unit tests:** `vitest@5.1.0` (node environment), `fast-check@4.10.2` for
  merge-invariant properties, `@types/node@24.19.2` for test-only `node:` use.
- **Browser e2e:** reuse the Persist Playwright/Vite toolchain. New specs live in
  `packages/persist/e2e`; the harness (`packages/persist/harness`) gains
  download/import controls that consume the **built** `@ghostsync/capsule` entry.
  No separate Playwright project is introduced.
- **Package shape:** `type: "module"`, `exports`/`main`/`module`/`types` pointing
  at `dist`, `files: ["dist"]`, `private: true`, `version: "0.0.0"`, MIT — a copy
  of the Kit/Persist manifest shape.

The `@types/node` dev dependency is a type-checking convenience for the test
files only; `src` stays browser-safe and is proven so by a `no-node-imports`
static scan (NFR-CAP-001), mirroring `packages/kit/tests/no-node-imports.test.ts`.

## Confirmed Kit / Persist signatures this design builds on

Quoted from the real source (`packages/kit/src/types.ts`, `replica.ts`,
`adapter.ts`; `packages/persist/src/{session,types,record,errors}.ts`):

```ts
// @ghostsync/kit  (exact, from packages/kit/src/types.ts, adapter.ts, replica.ts)
type Scalar = string | number | boolean | null;
type State = Record<string, Scalar>;
interface TransportUpdate { readonly documentId: string; readonly kind: "full" | "diff"; readonly bytes: Uint8Array }
type ApplyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "documentIdMismatch" }
  | { readonly ok: false; readonly reason: "invalidCarrier" }
  | { readonly ok: false; readonly reason: "malformedUpdate" };
interface Replica {
  readonly documentId: string;
  exportState(): TransportUpdate;                 // Y.encodeStateAsUpdate(doc), kind "full"
  applyUpdate(carrier: unknown): ApplyOutcome;    // shape/kind/documentId checked before decode
  getState(): State; // Record<string, Scalar>
  // ...set/delete/get/has/exportStateVector/exportDiff/collection/subscribe/destroy
}
interface SchemaIdentity { readonly app: string; readonly schemaVersion: number; readonly entityType: string }

// @ghostsync/persist  (exact, from packages/persist/src/{types,identity,session,errors}.ts)
interface ResolvedIdentity { readonly app: string; readonly documentId: string; readonly replicaId: string }
interface PersistSession {
  readonly identity: ResolvedIdentity;   // { app, documentId, replicaId } — NO top-level documentId
  readonly state: SaveState;             // "dirty" | "saving" | "saved" | "error"
  applyUpdate(carrier: unknown): ApplyOutcome;   // routed import; marks dirty on ok
  flush(): Promise<void>;                        // resolves on durable oncomplete; rejects PersistenceError
  getState(): State;
  exportBytes(): Uint8Array;
  // ...get/has/collection/exportState/subscribe/set/delete/onStateChange/close/dispose
}
class PersistenceError extends Error { readonly code: PersistenceErrorCode } // QuotaExceededError | TransactionAbortError | CloseFailedError | ClosedError | ...
```

**These types are IMPORTED from the SDK, never redefined (MEDIUM-2).** The
capsule package imports `State`, `ApplyOutcome`, and `TransportUpdate` from
`@ghostsync/kit` and never declares a local `State`, `ApplyOutcome`, or
`TransportUpdate`. It does **not** import or re-export `ResolvedIdentity` (or
anything else) from `@ghostsync/persist` (correction pass 3): the capsule depends
on Kit only. `PersistTarget.identity` is instead the **minimal structural
projection** `{ readonly app: string; readonly documentId: string }` — an
*interface requirement*, not a second persisted-identity implementation. Under strict TypeScript
(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no `any`),
the public boundary accepts `unknown` / `Uint8Array` capsule inputs and performs
**runtime validation** — it never casts untrusted bytes to a typed shape.

The capsule depends on **structural** target surfaces, not concrete classes:

- **Replica path:** `{ documentId: string; applyUpdate(carrier: unknown):
  ApplyOutcome }` — satisfied by a real `Replica`.
- **Persisted path:** `{ readonly identity: { readonly app: string; readonly
  documentId: string }; applyUpdate(carrier: unknown): ApplyOutcome; flush():
  Promise<void>; getState(): State }`. A real `PersistSession` (whose `identity` is
  `ResolvedIdentity { app, documentId, replicaId }`) satisfies this **UNCHANGED, by
  structural typing** — the extra `replicaId` is fine, and there is no wrapper and
  no change to `PersistSession` (HIGH-1). It deliberately does **not** require a
  top-level `documentId`, because `PersistSession` exposes the id only as
  `session.identity.documentId`. Because the capsule cannot import Persist types
  (acyclic graph), satisfaction by a real `PersistSession` is proven where both
  packages are visible: the Persist **harness TypeScript** passes a value whose
  static type is the real `PersistSession` straight into
  `importCapsuleIntoPersisted(...)` (and into an explicit `PersistTarget`-typed
  binding), with **no cast and no `any`**. A hand-written structural fake alone does
  NOT prove this. If compatibility ever breaks, `pnpm.cmd -F @ghostsync/persist
  typecheck` (`tsc --noEmit -p tsconfig.json`, whose `include` has
  `harness/**/*.ts`) fails. See **Compile-time structural proof (correction pass 4,
  F2)** below and task 6.2.

Note on `PersistSession`: its identity is reachable as `session.identity.app` and
`session.identity.documentId` (there is no top-level `documentId`). The persisted
helper takes **both** the app and the document identity from `target.identity`;
the in-memory helper reads the document id from the `Replica`'s top-level
`documentId` and the app from an explicit `expected.app`. See **Public API**.

## The capsule file format (chosen: binary container + JSON metadata)

I choose a **small binary container with a length-prefixed UTF-8 JSON metadata
section and a raw binary update payload**, over the two alternatives (all-JSON
with base64 bytes; all-binary fixed-offset struct). All-JSON base64 inflates the
payload ~33% and forces a decode/re-encode of the largest region for no benefit;
an all-binary struct is compact but makes the metadata non-inspectable and
brittle to evolve. The chosen hybrid keeps the metadata **human-inspectable**
(GhostSync Studio and `git`-level debugging can read it), stores the update
bytes **verbatim** (no bloat, exact `Uint8Array` preservation), and leaves a
clean seam for future fields and format versions.

### Byte layout (format version 1)

All multi-byte integers are **unsigned, big-endian** (network byte order) via
`DataView`. Offsets are from the start of the capsule.

```
offset  size   field
------  -----  -------------------------------------------------------------
0       6      magic         ASCII "GSCAP\0"  = 0x47 0x53 0x43 0x41 0x50 0x00
6       1      formatVersion uint8, = 1
7       4      metaLength    uint32 BE, byte length of the metadata JSON region
11      N      metadata      UTF-8 JSON, exactly metaLength bytes
11+N    M      update        raw full-state Yjs update bytes (M = total - 11 - N)
```

The header is fixed 11 bytes. The capsule has **no trailing bytes**: total length
MUST equal `11 + metaLength + metadata.updateByteLength`.

### Metadata JSON (version 1 — exact fields and validation rules)

```jsonc
{
  "formatVersion": 1,          // integer, MUST equal the header formatVersion (== 1)
  "app": "fieldledger",        // non-empty string; the SchemaIdentity.app namespace
  "documentId": "doc-123",     // non-empty string; the Kit logical document id
  "updateByteLength": 4096,    // non-negative safe integer; MUST equal M (actual update region length)
  "sha256": "ab12…",           // 64 lowercase hex chars; appears EXACTLY ONCE; digest over the covered region (below)
  "createdAt": "2026-01-01T00:00:00.000Z" // STRICT ISO-8601 UTC (…Z, millisecond precision); informational only, not trusted
}
```

Per-field validation rules (all enforced in the metadata-parse step; any failure
→ a **malformed** error unless a more specific step owns it):

- `formatVersion`: an integer that `=== 1` and `=== header.formatVersion`. The
  **header version byte is authoritative** and is judged first (byte `1` supported,
  `0` → `Malformed`, `2..255` → `UnsupportedVersion`; see Validation order step 2).
  Once the header byte is `1`, a metadata `formatVersion` that is not exactly `1`
  (any other number, a non-integer, or a non-number — i.e. the header byte and
  `metadata.formatVersion` **DISAGREE**) is **`Malformed`**, rejected in the
  metadata step before hashing. It is never `UnsupportedVersion`: the capsule's own
  two version claims contradict each other, which is an inconsistent file, not a
  future version this reader could support after an upgrade.
- `app`: `typeof === "string"` and `.length > 0`.
- `documentId`: `typeof === "string"` and `.length > 0`.
- `updateByteLength`: `Number.isSafeInteger` and `>= 0`; later cross-checked to
  equal the actual remaining byte count (`M`) and bounded by the decoded cap.
- `sha256`: the value token MUST be a JSON string of **exactly 64 literal ASCII
  lowercase hex characters (`0-9a-f`) with NO JSON escapes inside the value** (any
  backslash escape — even an escaped hex digit such as `\u0061` — wrong length,
  uppercase, or non-hex → **Malformed**). The `sha256` **key MUST appear exactly
  once by DECODED name** (see the token scan below); a representation in which it
  appears more than once (including via escaped equivalents), or in which the
  value span cannot be located unambiguously, is **Malformed** and is rejected
  *before* hashing.
- `createdAt` (NIT-2 — strict ISO-8601 UTC, chosen): `typeof === "string"` and
  the value round-trips as canonical UTC ISO-8601 with millisecond precision —
  i.e. `new Date(createdAt).toISOString() === createdAt` **and** it matches
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`. Both checks are required so
  that only the single canonical UTC spelling (`toISOString()` output) is
  accepted; non-canonical but `Date.parse`-able forms such as `"1/1/2026"` or a
  non-`Z` offset are **malformed**. The field is informational only (it is part
  of the hashed metadata bytes but carries no trust); `encodeCapsule` defaults it
  to `new Date().toISOString()`, which satisfies this rule by construction.
- **Duplicate / ambiguous keys and span location (correction pass 3):**
  `JSON.parse` neither reports source offsets nor preserves repeated keys (it
  silently keeps the last), so it cannot locate the `sha256` span or detect
  duplicates. The decoder instead runs the **JSON-aware token scan** specified in
  the next section over the received metadata bytes. Duplicate **decoded** keys
  (e.g. `"sha256"` and `"\u0073ha256"`) are **Malformed**, before hashing.

### Metadata token scan (byte-exact span location)

The metadata region is processed in this order (all synchronous, internal,
no hashing yet):

1. **Fatal UTF-8 decode, BOM kept then rejected (correction pass 4, F1).** Decode
   the metadata bytes with `new TextDecoder("utf-8", { fatal: true, ignoreBOM:
   true })`. Under WHATWG `TextDecoder` semantics, `ignoreBOM: true` **KEEPS** a
   leading U+FEFF in the decoded output, whereas `ignoreBOM: false` (the default)
   **STRIPS** it. (Earlier text claiming `ignoreBOM: false` retains the BOM was
   **wrong** and is superseded. Observed in Node 24 on `EF BB BF 7B 7D`: 2 decoded
   characters with `ignoreBOM: false`, 3 with `ignoreBOM: true`.) Stripping would
   silently drop 3 bytes from the text while the checksum offsets are measured in
   the original bytes, shifting every mapped span by 3, so the decoder deliberately
   keeps the BOM visible and then **explicitly rejects** it: **before the token
   scan** (and before `JSON.parse`/hashing), if the metadata region starts with the
   bytes `EF BB BF` (equivalently the decoded text starts with U+FEFF) → **Malformed**.
   JSON text has no BOM in its grammar, so this is a format violation, not
   something to normalize. A U+FEFF appearing *inside* a JSON string value is
   ordinary content (kept by `ignoreBOM: true`, counted as 3 UTF-8 bytes by the
   offset mapping). Invalid UTF-8 → **Malformed**. Never use a lenient decode that
   substitutes U+FFFD. Ordinary multi-byte metadata (e.g. `"app": "ünï-💾"`) keeps
   byte-offset correctness through the step-3 position mapping.
2. **Token scan** (a small hand-written scanner over the metadata, not a regex and
   not `JSON.parse`) that walks the JSON grammar for the single top-level object
   and records, for each top-level member: (a) the **DECODED name** (JSON string
   escapes resolved, so `"\u0073ha256"` records `sha256`), and (b) the **RAW value
   span** `[start, end)` of that member's value token. Nested values are skipped
   structurally (balanced braces/brackets and string-aware); only top-level
   members are recorded.
3. **Position mapping.** Scan positions are UTF-16 string indices; the checksum
   needs **UTF-8 byte offsets**. The scanner MUST map every recorded span to byte
   offsets within the metadata region (e.g. by accumulating the UTF-8 byte length
   of each code point as it advances, or by scanning the byte array directly), so
   multi-byte content (e.g. `"app": "ünï-💾"`) **before** the `sha256` member does
   not shift the span. A UTF-16-index span used as a byte offset is a defect.
4. **Duplicate rejection.** If any decoded top-level name occurs more than once →
   **Malformed**. Unknown top-level names → **Malformed** (as above).
5. **`sha256` value token rule.** The recorded `sha256` value span must be exactly
   a JSON string token: opening `"`, **64 literal ASCII bytes in `0-9a-f`**, closing
   `"`, with **no `\` anywhere inside** (no JSON escapes — an escaped value would
   make the replaced span width ambiguous). Any escape, length ≠ 64, uppercase, or
   non-hex → **Malformed**. The 64-byte hex payload span (excluding the quotes) is
   what the checksum rule neutralizes.
6. **Then** the remaining fields are validated from `JSON.parse` of the same
   already-decoded text (types, `createdAt`, `updateByteLength`, etc.). `JSON.parse`
   is used for *value validation only*, never to locate spans or to recompute the
   digest.

Whitespace and key order are free (the hash is over the received bytes), so
reordered keys or reformatted whitespace verify as long as the bytes are
internally consistent with the stored digest.

**Forbidden:** locating the checksum span with a regex-only key scan (e.g. matching
`"sha256":"…"` in the text) or verifying by re-serializing parsed JSON
(`JSON.stringify`). Both can mis-locate the span (escaped keys, string content that
looks like a key, Unicode offsets) or change the bytes being hashed.
- The metadata object MUST NOT contain unknown top-level keys for version 1
  (reject extras → **malformed**), keeping the format strict and forward changes
  gated behind a version bump.

### File identity

- **Extension:** `.gscap`
- **Media type:** `application/vnd.ghostsync.capsule`
- **Encoding:** binary (the metadata region is UTF-8 JSON; the rest is raw bytes).

### Checksum coverage (exact, reproducible)

`sha256` is the lowercase-hex SHA-256 digest over the **contiguous byte region
starting at offset 7 through the end of the capsule**, i.e. in order:

1. the 4 `metaLength` bytes (offset 7..10),
2. the `metadata` JSON bytes (offset 11..11+N-1), **with the `sha256` field's
   64-byte value neutralized to the `"0".repeat(64)` placeholder** (see the
   Canonical hashing rule below) — the digest covers the metadata text but not
   the digest of itself,
3. the `update` bytes (offset 11+N..end).

Equivalently: everything **after the fixed magic+version prefix (offsets 0..6)**,
with the single `sha256` value within the metadata zeroed to its placeholder.
The magic and format-version byte are excluded because they are the pre-checksum
framing the decoder must read to even locate the checksum field; the length
prefix, metadata (including `app`, `documentId`, `updateByteLength`, `createdAt`),
and the update payload are all covered, so tampering with any identity field or
any payload byte changes the digest.

The `sha256` field value is a **fixed-width 64-char lowercase-hex string**. We
exploit that fixed width so the field can be overwritten in place with no
re-layout, and so verification can hash the *received* bytes without ever
re-serializing parsed JSON:

> **Canonical hashing rule (deterministic, byte-exact).**
>
> *Encode.* Serialize the metadata JSON with the `sha256` value written as
> exactly 64 ASCII `"0"` characters (`"0".repeat(64)`). Assemble
> header + metadata + update. SHA-256 the region **offsets 7..end**. Then
> **overwrite those 64 placeholder bytes in place** with the computed lowercase
> hex digest — same width, so no byte shifts, no field re-ordering, no
> reserialization. The 64-byte placeholder position is located once (it is the
> sole `sha256` value; encode writes the metadata itself, so it knows the byte
> offset, and the codec's own output is re-checked by the same token scan in the
> round-trip tests) and the digest bytes are written over exactly that span.
>
> *Verify.* Operate on the **received bytes only** (the owned snapshot). (1) Run
> the **metadata token scan** (above) to obtain the single top-level `sha256`
> member's value span as **UTF-8 byte offsets** within the metadata region,
> translated to capsule offsets (`11 + metaStart`); the scan has already enforced
> unique decoded keys and the exactly-64-literal-lowercase-hex, no-escape token
> rule. (2) Read those 64 ASCII bytes as `claimed`. (3) Copy the received bytes
> from offset 7 to the end and overwrite just that 64-byte span with ASCII `"0"`.
> (4) `await` SHA-256 of that copy and compare the lowercase-hex result to
> `claimed` with a constant-shape string compare; mismatch → `ChecksumMismatch`.
>
> Verification **MUST NOT** locate the span with a regex-only key scan, and **MUST
> NOT** `JSON.stringify` the parsed metadata to recompute the digest:
> parse→reserialize can reorder keys, change whitespace, or normalize escapes and
> would make an untampered capsule fail. The hash is always taken over the exact
> received byte range with only the 64-byte placeholder swap. (Covered-region note:
> the `sha256` value's 64 bytes are the `"0".repeat(64)` placeholder during both
> encode-time and verify-time hashing.)

This keeps the digest stable and self-consistent without excluding the metadata
from coverage. Because `sha256` is a fixed-width 64-char hex string and appears
exactly once, both the encode overwrite and the verify placeholder swap are pure
in-place 64-byte operations with no JSON re-layout.

**Integrity, not authenticity.** The format documentation and the package README
state plainly: a SHA-256 checksum detects accidental or malicious **corruption**
of the bytes in transit or at rest; it does **not** authenticate the sender and
provides no confidentiality. Anyone can craft a valid capsule with a correct
checksum. Authentication/encryption is explicitly out of scope.

## Public API (concrete TypeScript)

All exported from `packages/capsule/src/index.ts`. `State`, `ApplyOutcome`, and
`TransportUpdate` are **imported from `@ghostsync/kit`** (the only SDK import); the
capsule re-exports the ones used in its public surface and defines **none** of them
locally (MEDIUM-2). Nothing is imported from `@ghostsync/persist`.

```ts
import type { ApplyOutcome, State, TransportUpdate } from "@ghostsync/kit";
export type { ApplyOutcome, State } from "@ghostsync/kit";

// ----- constants -----
export const CAPSULE_MAGIC: Uint8Array;            // "GSCAP\0"
export const CAPSULE_FORMAT_VERSION = 1 as const;
export const CAPSULE_EXTENSION = ".gscap" as const;
export const CAPSULE_MEDIA_TYPE = "application/vnd.ghostsync.capsule" as const;
export const DEFAULT_MAX_CAPSULE_BYTES = 16 * 1024 * 1024; // 16 MiB raw cap
export const DEFAULT_MAX_UPDATE_BYTES = 8 * 1024 * 1024;   // 8 MiB decoded cap (matches Persist DEFAULT_MAX_BYTES)

// ----- metadata & decoded result -----
export interface CapsuleMetadata {
  readonly formatVersion: 1;
  readonly app: string;
  readonly documentId: string;
  readonly updateByteLength: number;
  readonly sha256: string;
  readonly createdAt: string;
}
export interface DecodedCapsule {
  readonly metadata: CapsuleMetadata;
  readonly update: Uint8Array; // caller-owned copy of the update region
}

// ----- encode (ASYNC — computes the SHA-256) -----
export interface EncodeCapsuleInput {
  readonly app: string;
  // `update` MUST be a FULL-STATE update (Replica.exportState().bytes, kind "full").
  // Pass either the raw bytes or the whole TransportUpdate. A TransportUpdate MUST have
  // kind === "full" AND update.documentId === input.documentId (else TypeError, BEFORE any
  // hashing and before any await). A raw Uint8Array carries NO independently checkable
  // document identity: its identity is the CALLER's responsibility (input.documentId is
  // trusted as asserted). Prefer passing the whole TransportUpdate so the cross-check runs.
  readonly update: Uint8Array | TransportUpdate;
  readonly documentId: string;
  readonly createdAt?: string;     // default: new Date().toISOString() (strict ISO-8601 UTC)
}
// ASYNC. Programmer errors (wrong types, diff kind, TransportUpdate.documentId !==
// input.documentId, SharedArrayBuffer-backed bytes, bad createdAt/app/documentId) reject
// with TypeError. Inputs (update bytes, app, documentId, createdAt) are captured/copied
// BEFORE the first await. The ONLY CapsuleError encode can reject with is
// "CryptoUnavailable" (the platform cannot compute SHA-256; cause preserved) — it is
// not a programmer error and not a bad capsule.
export function encodeCapsule(input: EncodeCapsuleInput): Promise<Uint8Array>;

// ----- decode (ASYNC — verifies the SHA-256; validates only, applies nothing) -----
export interface DecodeCapsuleOptions {
  readonly maxCapsuleBytes?: number;  // default DEFAULT_MAX_CAPSULE_BYTES
  readonly maxUpdateBytes?: number;   // default DEFAULT_MAX_UPDATE_BYTES
}
// ASYNC. Wrong argument types / SharedArrayBuffer-backed bytes / bad opts => TypeError.
// Well-typed but invalid capsule bytes => CapsuleError. Raw size is checked first, then the
// bytes are COPIED into an owned snapshot before the first await.
export function decodeCapsule(bytes: Uint8Array, opts?: DecodeCapsuleOptions): Promise<DecodedCapsule>;

// ----- one-call import into an in-memory replica (ASYNC — awaits decode) -----
export interface ReplicaTarget {
  readonly documentId: string;
  applyUpdate(carrier: unknown): ApplyOutcome; // ApplyOutcome imported from @ghostsync/kit
}
export interface ImportExpectation {
  readonly app: string;          // the caller's expected app namespace — used ONLY by the plain REPLICA helper
  // documentId is taken from the TARGET, never trusted from the capsule (see identity rules below).
  // The persisted helper takes NO ImportExpectation: its app comes from target.identity.app.
}
// SUCCESS shape: { applied: true, metadata } — NOT `ok: true`. (`ok` is the Kit's
// ApplyOutcome field; capsule helper results never use it.) Every non-success is a
// rejection, so `applied` is only ever `true` on a resolved result.
export interface ImportResult {
  readonly applied: true;
  readonly metadata: CapsuleMetadata;
}
// ASYNC. Replica path: expected.app is EXPLICIT; the document id is target.documentId.
// Wrong argument types / SharedArrayBuffer => TypeError; invalid capsule / identity /
// SDK rejection / target.applyUpdate throwing => CapsuleError.
export function importCapsuleInto(
  target: ReplicaTarget,
  bytes: Uint8Array,
  expected: ImportExpectation,
  opts?: DecodeCapsuleOptions,
): Promise<ImportResult>;

// ----- one-call import into a persisted session (ASYNC — awaits decode, then durable flush) -----
// Structural surface a real PersistSession satisfies WITHOUT a wrapper or any change
// to PersistSession. It does NOT extend ReplicaTarget and does NOT require a
// top-level documentId; the governing document identity is target.identity.documentId.
export interface PersistTarget {
  // MINIMAL STRUCTURAL PROJECTION (interface requirement only — NOT a second persisted-
  // identity implementation, and NOT imported from @ghostsync/persist). A real
  // PersistSession.identity (ResolvedIdentity { app, documentId, replicaId }) satisfies it
  // unchanged: the extra replicaId is allowed by structural typing.
  readonly identity: { readonly app: string; readonly documentId: string };
  applyUpdate(carrier: unknown): ApplyOutcome;
  flush(): Promise<void>;
  getState(): State;
}
export interface PersistImportResult {
  readonly applied: true;                  // a resolved result means the apply happened
  readonly metadata: CapsuleMetadata;
  readonly persisted: boolean;             // true iff flush() resolved
  readonly saveError?: PersistLikeError;   // present iff persisted === false (apply succeeded, flush failed)
}
// ASYNC. NO expected-app argument: BOTH the app and the document id come from
// target.identity (target.identity.app and target.identity.documentId).
// Rejects with CapsuleError before apply/flush (format, size, checksum, AppIdentityMismatch,
// DocumentIdentityMismatch, SdkRejection, TargetUnavailable, CryptoUnavailable). TypeError for wrong argument
// types / SharedArrayBuffer / bad opts. Resolves { applied: true, persisted, saveError? }
// only after a SUCCESSFUL apply; a failed flush is persisted:false, not a rejection.
export function importCapsuleIntoPersisted(
  target: PersistTarget,
  bytes: Uint8Array,
  opts?: DecodeCapsuleOptions,
): Promise<PersistImportResult>;

// ----- typed error contract -----
export type CapsuleErrorCode =
  | "UnsupportedVersion"
  | "Malformed"
  | "AppIdentityMismatch"
  | "DocumentIdentityMismatch"
  | "OversizedRaw"
  | "OversizedDecoded"
  | "ChecksumMismatch"
  | "SdkRejection"
  | "TargetUnavailable"   // target.applyUpdate THREW (e.g. closed/recovery PersistSession => ClosedError); NOTHING applied
  | "CryptoUnavailable";  // crypto.subtle.digest missing or rejected/threw: a MISSING PLATFORM CAPABILITY, not a bad capsule; cause preserved
export class CapsuleError extends Error {
  readonly code: CapsuleErrorCode;
  readonly cause?: unknown;                 // e.g. the mapped ApplyOutcome.reason for SdkRejection; the original platform error for CryptoUnavailable / TargetUnavailable
  constructor(code: CapsuleErrorCode, message: string, cause?: unknown);
}
export function isCapsuleError(value: unknown, code?: CapsuleErrorCode): value is CapsuleError;
```

`PersistLikeError` is a minimal structural shape `{ name: string; message:
string; code?: string }`; the helper passes the caught `PersistenceError` through,
and its `code` (`QuotaExceededError` / `TransactionAbortError` /
`CloseFailedError` / `ClosedError`) survives. The capsule takes **no dependency of
any kind — runtime or type-only — on `@ghostsync/persist`**.
`importCapsuleIntoPersisted` lives in the capsule package but only requires the
structural `PersistTarget`; the harness supplies a real `PersistSession`, which
satisfies it directly.

**Package dependency graph (acyclic):** `kit <- capsule`. Persist already depends
on Kit (`persist -> kit`); Persist's **harness only** (via a `devDependency` added
to `packages/persist/package.json` at implementation) consumes the built capsule
(`persist(harness) -> capsule -> kit`). There is **no `capsule -> persist` edge**
(not runtime, dev, peer, or type-only), so no cycle. The capsule's own unit tests
use structural fakes whose `identity` carries `{ app, documentId, replicaId }` to
mirror a real session; the real-`PersistSession` satisfaction check lives in the
harness, where both packages are visible.

### Identity rules per path — ONE governing source each (HIGH-1 / MEDIUM-1)

Each import path has exactly **one authoritative document identity**, so there is
no dual-source ambiguity in the identity-gating step:

- **In-memory replica path (`importCapsuleInto`):** the governing document
  identity is **`target.documentId`** (the `Replica`'s own id). The caller passes
  the expected **app** explicitly in `expected.app`; there is no session. The
  capsule's claimed `documentId` is compared *against the target's* id and is
  never used to pick a target.
- **Persisted session path (`importCapsuleIntoPersisted`):** the governing
  identity is the **session's resolved identity** — **BOTH
  `target.identity.app` AND `target.identity.documentId`**. There is **no**
  expected-app argument and **no** `documentId` parameter: a caller cannot pass an
  identity that disagrees with (or weakens) the session's own. This closes the
  cross-app hole where a capsule with the *correct* `documentId` but belonging to
  *another app* would be accepted if the caller supplied a matching `expected.app`.
  A real `PersistSession` satisfies `PersistTarget` unchanged, because
  `identity.app` and `identity.documentId` are exactly where it exposes them.

In both paths the capsule-level app and document-identity checks run **before any
apply** and are independent of the Kit's own `documentIdMismatch` guard. A
caller-supplied identity never *overrides* the target's actual identity; on the
persisted path the target's identity simply **is** the source.

### Which functions are async vs sync (async-contract correction)

| Function | Hashes? | Signature |
| --- | --- | --- |
| `encodeCapsule` | yes (computes digest) | `Promise<Uint8Array>` — **async** |
| `decodeCapsule` | yes (verifies digest) | `Promise<DecodedCapsule>` — **async** (rejects `CapsuleError`) |
| `importCapsuleInto` | yes (awaits `decodeCapsule`) | `(target, bytes, expected: { app }, opts?) => Promise<ImportResult>` — **async** |
| `importCapsuleIntoPersisted` | yes (awaits `decodeCapsule`, then `flush()`) | `(target, bytes, opts?) => Promise<PersistImportResult>` — **async**, no expected-app argument |
| internal header/framing read, metadata token scan + field validation, `isCapsuleError` | no | **sync** (internal helpers; no public hashing surface) |

**TypeError vs CapsuleError boundary (per function).** A `TypeError` (delivered as a
rejected `Promise`, because the functions are `async`) signals a **programmer error**:
a wrong argument *type* or shape that no well-behaved caller produces. A
`CapsuleError` signals that **well-typed bytes are not an acceptable capsule** (or
the capsule is rejected by identity/SDK/target). Never the other way round.

| Function | `TypeError` (programmer error) | `CapsuleError` (input/capsule rejection) |
| --- | --- | --- |
| `encodeCapsule` | `input` not an object; `app`/`documentId` not non-empty strings; `update` neither `Uint8Array` nor `TransportUpdate`; `TransportUpdate.kind !== "full"` (diff); **`TransportUpdate.documentId !== input.documentId`** (F3); non-canonical `createdAt`; SharedArrayBuffer-backed bytes | `CryptoUnavailable` only (digest cannot be computed); no other `CapsuleError` |
| `decodeCapsule` | `bytes` not a `Uint8Array`; SharedArrayBuffer-backed `bytes`; invalid `opts` caps | `OversizedRaw`, `UnsupportedVersion`, `Malformed`, `OversizedDecoded`, `ChecksumMismatch`, `CryptoUnavailable` |
| `importCapsuleInto` | `target`/`expected` wrong shape; `bytes` not a `Uint8Array` or SharedArrayBuffer-backed; invalid `opts` | all decode codes (incl. `CryptoUnavailable`, propagated unchanged) + `AppIdentityMismatch`, `DocumentIdentityMismatch`, `SdkRejection`, `TargetUnavailable` |
| `importCapsuleIntoPersisted` | `target` wrong shape (missing `identity.app`/`identity.documentId` strings, etc.); `bytes` not a `Uint8Array` or SharedArrayBuffer-backed; invalid `opts` | same as `importCapsuleInto`; a failed `flush()` is **not** an error — it resolves `persisted:false` |

**`CryptoUnavailable` rule (stated once; correction pass 4 NIT).** A missing or
failing platform capability is neither a programmer argument error nor a bad
capsule. Whenever `crypto.subtle.digest` is absent (`globalThis.crypto?.subtle` not
usable) or its call throws/rejects, **every** function that hashes —
`encodeCapsule`, `decodeCapsule`, and both import helpers (which propagate the
decode rejection unchanged) — rejects with `CapsuleError("CryptoUnavailable", msg,
cause)`, preserving the original platform error as `cause`. It is **never**
labelled `Malformed` or `ChecksumMismatch`, and its message does not claim the
input was malformed. Because the digest runs last in decode (step 6), a capsule
that is structurally bad still fails with its own earlier code. On the import
paths nothing is applied and `flush` is not called. This is why `encodeCapsule` now
has exactly one possible `CapsuleError` (`CryptoUnavailable`) while every other
encode failure remains a `TypeError`.

Because `crypto.subtle.digest` returns a `Promise`, no public entry point can be
synchronous while still computing or verifying a checksum. No dependency is added
to fake a synchronous digest. All usage examples, the error contract, the tasks,
and the planned tests `await` these calls (`await expect(decodeCapsule(...))
.rejects` for rejection assertions).

### Decision: throw vs. Result for decode

`decodeCapsule` and `importCapsuleInto` **reject** their returned `Promise` with
a `CapsuleError` rather than resolve a `Result` union. Because the functions are
async (they verify a SHA-256), "throw" means "reject the promise": a caller writes
`try { await decodeCapsule(...) } catch (e) { if (isCapsuleError(e, "Malformed"))
… }`. Rationale: the Kit already models *recoverable* apply outcomes as a returned
`ApplyOutcome`, and the capsule maps a non-`ok` `ApplyOutcome` into a rejected
`CapsuleError("SdkRejection")` so all rejection handling converges on one
`try/catch` + `isCapsuleError(err, code)` branch. Rejecting keeps the happy-path
signatures clean (`await decodeCapsule(...)` yields the decoded value directly) and
matches Persist's `PersistenceError`-on-reject convention. The persisted helper
does **not** reject for a save failure — a save failure is a *successful import
with failed persistence*, so its promise **resolves** with `persisted: false` and
`saveError` (REQ-CAP-009).

## Buffer ownership and copying (NFR-CAP-003)

Rule (correction pass 3): **every public async function takes an owned snapshot of
its byte inputs after cheap synchronous checks and BEFORE its first `await`.** What
is validated is what is hashed, returned, and applied; the caller's buffer is never
re-read after an `await`, so a caller (or another task) mutating it mid-flight
cannot make the codec validate one payload and apply another.

- **`encodeCapsule`**: synchronously validates arguments (TypeErrors), then —
  before awaiting the hash — copies the update bytes into the output
  `Uint8Array` it is assembling and captures `app`, `documentId`, and `createdAt`
  as local string values. Hashing, the in-place digest overwrite, and the returned
  buffer all use that owned assembly; the input is not read again. The returned
  buffer is caller-owned; mutating the input at any time (including right after
  calling `encodeCapsule` and before awaiting it) does not affect the capsule.
- **`decodeCapsule`**: (1) synchronous type check and **raw-size check**
  (`bytes.length > maxCapsuleBytes` → `OversizedRaw`, with no copy made); (2)
  `const snap = bytes.slice()` (an owned copy) **before the first `await`**; (3)
  parse, token-scan, bound-check, and hash **`snap`** only; (4) return
  `DecodedCapsule.update` as a slice of `snap` (own `ArrayBuffer`, not a view over
  the caller's input). The returned `metadata` is a fresh object.
- **`importCapsuleInto` / `importCapsuleIntoPersisted`**: call `decodeCapsule` (so
  the snapshot is taken synchronously inside that call, before any `await` in the
  import function), then build the carrier from the **decoded snapshot-derived
  `update`** — never from `bytes`. The payload that passed the checksum is the
  payload passed to `applyUpdate`.
- **SharedArrayBuffer-backed input is REJECTED** for this milestone: if
  `bytes.buffer` (or an encode input's bytes) is a `SharedArrayBuffer`
  (`typeof SharedArrayBuffer !== "undefined" && buf instanceof SharedArrayBuffer`),
  the function rejects with a documented **`TypeError`**. The codec does not
  promise an atomic snapshot of memory another thread may be writing during the
  copy. This is a programmer-error rejection, not a `CapsuleError`.
- The owned copy also gives `crypto.subtle.digest` a tightly bounded buffer (no
  offset/shared-buffer leakage), mirroring the Persist `sha256Hex` `.slice()`
  practice.

Cost note: one copy of the whole capsule on decode (plus the update-region slice)
and one on encode. For the 8–16 MiB caps this is acceptable and avoids a whole
class of time-of-check/time-of-use bugs; it is documented so the tradeoff is
explicit.

## Validation order (cheapest / most-protective first)

`decodeCapsule(bytes, opts)` runs these steps in order; each failure throws the
named `CapsuleError` and **nothing is applied** (decode never applies — only
`importCapsuleInto*` applies, and only after decode fully succeeds and identity
matches):

0. **Argument type check** — `bytes` must be a non-SharedArrayBuffer-backed
   `Uint8Array`, `opts` valid (else `TypeError`, programmer error).
1. **Raw size bound** — if `bytes.length > maxCapsuleBytes` → `OversizedRaw`.
   First, before any read or copy. **Then take the owned snapshot
   (`bytes.slice()`) — still synchronous, before the first `await`.** Every later
   step reads only that snapshot.
2. **Minimum length + magic + version** — require `bytes.length >= 11`; bytes
   0..5 equal the magic (else `Malformed`); byte 6 is the format version (uint8).
   Exact mapping: **`1` → supported (proceed); `0` → `Malformed`; `2..255` →
   `UnsupportedVersion`.** (Version 0 was never a valid format version, so it is a
   corrupt header, not a future one.) This header byte is authoritative; the
   metadata `formatVersion` is cross-checked in step 4.
3. **Length framing** — read `metaLength` (uint32 BE at offset 7). Require
   `11 + metaLength <= bytes.length` (else `Malformed`). Compute the update region
   `M = bytes.length - 11 - metaLength`.
4. **Metadata decode + token scan + field validation** — fatal UTF-8 decode
   (`new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`; invalid UTF-8 →
   `Malformed`; **a leading BOM — bytes `EF BB BF` at metadata offset 0 /
   decoded leading U+FEFF — → `Malformed` BEFORE the token scan**), the
   JSON-aware **token scan** (decoded top-level names, raw value spans mapped to
   UTF-8 byte offsets, duplicate decoded keys → `Malformed`, `sha256` value must be
   exactly 64 literal lowercase hex chars with no escapes), then `JSON.parse` of the
   same text for value validation. Validate every field per the rules above; a bad
   field → `Malformed`. This includes `metadata.formatVersion !== 1` while the
   header byte is `1` (header/metadata version **disagreement** → `Malformed`, never
   `UnsupportedVersion`). Reject unknown top-level keys → `Malformed`.
   Cross-check `metadata.updateByteLength === M` (else `Malformed`, AC-CAP-006-3).
5. **Decoded-update size bound** — if `M > maxUpdateBytes` (equivalently
   `updateByteLength > maxUpdateBytes`) → `OversizedDecoded`, **before** hashing
   or applying.
6. **Checksum recompute + compare** — using the `sha256` byte span from the token
   scan, copy the snapshot's offsets 7..end, overwrite those 64 bytes with `"0"`×64,
   `await` SHA-256, compare to the stored value; mismatch → `ChecksumMismatch`.
   If the digest is unavailable or its call throws/rejects →
   `CapsuleError("CryptoUnavailable", …, cause)` (NOT `Malformed`; the capsule was
   not judged malformed). (No regex location, no JSON reserialization.)

`decodeCapsule` resolves with `{ metadata, update }` after step 6 (both derived
from the owned snapshot). Identity and apply are performed by the import helpers
(which `await decodeCapsule` first):

7. **App identity** — replica helper: `metadata.app === expected.app`; persisted
   helper: `metadata.app === target.identity.app` (no expected-app argument).
   Mismatch → `AppIdentityMismatch`.
8. **Document identity** — replica helper: `metadata.documentId ===
   target.documentId`; persisted helper: `metadata.documentId ===
   target.identity.documentId`. There is no third source. Mismatch →
   `DocumentIdentityMismatch`. Steps 7–8 run **before** any apply (and, on the
   persisted path, before any flush), independent of the Kit's own
   `documentIdMismatch` guard.
9. **Kit apply** — build the carrier `{ documentId: metadata.documentId, kind:
   "full", bytes: update }` from the decoded (snapshot-derived) `update` and call
   `target.applyUpdate(carrier)` inside a `try`. If it **throws** (e.g. a
   closed/recovery `PersistSession` throws `ClosedError` from `applyUpdate`) →
   reject `CapsuleError("TargetUnavailable", …, cause)`: nothing was applied, so the
   result is **never** `applied: true`. On `{ ok: true }` the apply happened. On
   `{ ok: false }` map the reason to `CapsuleError("SdkRejection", …, { reason })`
   (AC-CAP-006-2).
10. **Persisted path only — flush.** After a **successful** apply, `await
    target.flush()`. Only a failed flush *after a successful apply* may produce
    `{ applied: true, persisted: false, saveError }`.

Hashing (step 6) deliberately runs **after** cheap structural checks and after
the decoded-size bound, so a tiny malformed or oversized input never pays the
digest cost. The raw-size bound (step 1) and decoded-size bound (step 5) bound
memory; neither protects against a crafted in-bounds Yjs update that is expensive
for `Y.applyUpdate` to process — this is stated plainly (REQ-CAP-005, Out of
Scope).

### Why step order matters for non-mutation (REQ-CAP-008)

Steps 1–8 run entirely inside the capsule layer and touch **no** replica state.
`applyUpdate` (step 9) is the only mutation, reached only after the capsule has
confirmed framing, size, metadata, checksum, and both identities. Therefore any
rejection in steps 1–8 trivially leaves the target unchanged; a step-9 SDK
rejection is non-mutating because the Kit's `applyUpdate` itself guarantees
no-mutation-on-reject (`invalidCarrier` / `documentIdMismatch` return before
decode; `malformedUpdate` restores from a pre-apply snapshot — see
`packages/kit/src/replica.ts`).

## Browser integration (harness only) and the persistence distinction

### Import helper semantics (REQ-CAP-009)

`importCapsuleIntoPersisted(session, bytes, opts)` (async; **no expected-app
argument**):

1. `await decodeCapsule(bytes, opts)` (rejects `CapsuleError` on any
   format/size/checksum failure — nothing applied; the snapshot was taken before the
   first await).
2. App + document identity checks, **both from the session**:
   `metadata.app === session.identity.app` and `metadata.documentId ===
   session.identity.documentId`; any mismatch rejects (`AppIdentityMismatch` /
   `DocumentIdentityMismatch`) **before apply and before flush**.
3. `try { outcome = session.applyUpdate({ documentId: session.identity.documentId,
   kind: "full", bytes: decoded.update }) } catch (err) { reject
   CapsuleError("TargetUnavailable", …, err) }`. A **closed / recovery /
   terminated session throws `ClosedError` from `applyUpdate`
   (`#assertMutable`)**: the apply **never happened**, so this is a typed rejection,
   **not** `applied: true`. If `!outcome.ok` → reject `CapsuleError("SdkRejection")`
   (session unchanged; `applyUpdate` only marks dirty on `ok`).
4. Only now is the apply a fact. `try { await session.flush(); persisted = true }
   catch (err) { persisted = false; saveError = err }`. Resolve `{ applied: true,
   persisted, metadata, saveError? }`.

So a valid capsule that the session accepts but cannot durably persist resolves
with `applied: true, persisted: false, saveError: <PersistenceError>`; a session
that could not accept it at all **rejects** and is never reported as applied. Merge
semantics: importing a capsule merges via the Kit's CRDT `applyUpdate`, so it
**adds to** whatever the target already holds; an **empty source document's**
capsule leaves an existing target's data intact (it contributes no entries and
removes none).

**Merged size vs Persist's save limit (honest limit).** `maxUpdateBytes` bounds the
*incoming update*, not the *merged document*. After merging, the session's full
snapshot can exceed Persist's `maxBytes` (default `DEFAULT_MAX_BYTES`, 8 MiB)
even though both the incoming update and the prior state were each within limits.
`session.flush()` then enforces the limit pre-write (`session.ts` raises a
`QuotaExceededError` `PersistenceError` via `#failSave`, moving the open session to
`"error"` with the data kept in memory). That surfaces as `{ applied: true,
persisted: false, saveError }` — a **persistence failure per the Persist contract**,
**not** a capsule rejection and not an `OversizedDecoded`. The capsule neither
predicts nor guards the merged size.

Two **distinct, honest** failure cases after a successful apply (MEDIUM-3):

- **Still-readable open session (the recoverable case the test exercises).**
  `flush()` rejects on an **open** session — e.g. the harness's
  `armWriteAbortOnce` drives a genuine `TransactionAbortError`, or a
  `QuotaExceededError`/`checksum-failed` write error. These all route through the
  session's `#failSave` → `#setState("error")` (confirmed in
  `packages/persist/src/session.ts`). Here the accepted data **stays in the
  in-memory replica and is fully readable via `session.getState()`**, the
  session's `state` is `"error"`, and a later `flush()` retry can succeed. This is
  the case AC-CAP-009-2 is scoped to: `applied: true, persisted: false`, typed
  `saveError`, data readable, session visibly unsaved/recoverable.
- **Session terminated AFTER a successful apply, during flush (terminal path).**
  If `applyUpdate` succeeded (session was open) but the session is closed/disposed
  concurrently so `flush()` rejects with a `ClosedError` `PersistenceError`
  (`session.ts` "closed during flush"), the helper reports `applied: true,
  persisted: false, saveError`. The session's `state` is **not** necessarily
  `"error"` and, after a successful `close()`/`dispose()`, the in-memory data has
  been released — `getState()`/`exportBytes()` then reject `ClosedError`. The
  design does **not** claim the data remains accessible on this path; it is outside
  the recoverable-save guarantee.
- **Session already closed/recovery BEFORE apply is NOT in this list.** There the
  apply itself throws (step 3 above) and the helper rejects
  `CapsuleError("TargetUnavailable")`; `applied: true` is impossible because nothing
  was applied.

The helper never reports a save failure as success, never reports an unapplied
update as applied, and never discards in-memory data on the recoverable
(open-session) path.

### Harness controls (`packages/persist/harness`)

The harness `window.__gs` surface gains capsule methods that wire real browser
file I/O to the built `@ghostsync/capsule` and the existing `PersistSession`:

- `downloadCapsule(handle)` — `await encodeCapsule({ app:
  session.identity.app, documentId: session.identity.documentId, update:
  session.exportState() })` (passing the full `TransportUpdate` so `kind === "full"`
  is asserted at the boundary), wrap in a `Blob` with type
  `application/vnd.ghostsync.capsule`, and trigger a real download of a
  `*.gscap` file (anchor + `URL.createObjectURL`). Resolves the suggested filename.
- `importCapsuleFile(handle, bytes)` — `await importCapsuleIntoPersisted(session,
  bytes)` (**no expected-app and no documentId argument**: both come from
  `session.identity`) and return `{ applied, persisted, saveError? }` (codes
  stringified like the existing `asError` helper) so a Playwright test can assert
  both facts. The `session` argument there is a **real `PersistSession`** (the
  harness's existing `session(handle): PersistSession` lookup), passed with no cast,
  so the Persist typecheck proves it satisfies `PersistTarget` unchanged. See
  **Compile-time structural proof** below.
- **Test-driving hooks (F4; harness-only, additive).** To keep the merged-size
  regression deterministic without parsing files in the test, the harness also
  exposes `exportCapsuleHex(handle): Promise<string | ErrorInfo>` (same
  `encodeCapsule` call as `downloadCapsule`, returned as hex via the existing
  `toHex`) and `importCapsuleHex(handle, hex)` (hex → bytes via the existing
  `fromHex`, then `importCapsuleIntoPersisted`). The existing `fromHex`/`toHex`
  helpers are reused. **No `maxBytes` hook is needed**: see **Merged-size
  regression (F4)**.

#### Compile-time structural proof (correction pass 4, F2)

A hand-written structural fake (used in the capsule's own unit tests) cannot prove
that the *real* `PersistSession` satisfies `PersistTarget`. The proof lives in the
harness source (`packages/persist/harness/harness.ts`), which imports the built
public entries of `@ghostsync/persist` and `@ghostsync/capsule`:

- **Use site (the real proof):** `importCapsuleFile`/`importCapsuleHex` call
  `importCapsuleIntoPersisted(session(handle), bytes)` where `session(handle)` has
  the declared type `PersistSession` (from `@ghostsync/persist`). No `as`, no `any`,
  no wrapper object.
- **Explicit guard:** one binding in the harness, `const target: PersistTarget =
  session(handle);` (with `import type { PersistTarget } from "@ghostsync/capsule"`),
  so a break is reported at an obvious line with a clear message.
- **Which typecheck covers it (verified from the real files):**
  `packages/persist/package.json` script `typecheck` = `tsc --noEmit -p
  tsconfig.json`; `packages/persist/tsconfig.json` `include` lists
  `harness/**/*.ts` (plus `src`, `tests`, `e2e`, config files), `lib` has `DOM`,
  `types: ["node"]`, and `paths` maps only `@ghostsync/persist` →
  `./src/index.ts`. Consequences: (a) `PersistSession` is resolved from Persist
  **source** in this typecheck, so the Persist build is *not* required for it;
  (b) `@ghostsync/capsule` is **not** in `paths`, so it resolves through
  `node_modules` to `@ghostsync/capsule`'s `exports.types` = `dist/index.d.ts`, so
  **the capsule build must run first**, and capsule's declarations import
  `@ghostsync/kit` types from kit's `dist`, so **the Kit build must run before the
  capsule build**. `packages/persist/tsconfig.build.json` *excludes* `harness`, so
  `pnpm.cmd -F @ghostsync/persist build` does NOT check it, and `build:harness`
  (Vite/esbuild) strips types without checking — only `typecheck` does.
- Therefore `pnpm.cmd -F @ghostsync/persist typecheck` is **required evidence** for
  AC-CAP-003-5 (it is in the verification list, after the Kit and Capsule builds).

#### Merged-size regression (F4) — concrete browser scenario

Facts verified from source: `OpenOptions` (`packages/persist/src/types.ts`) already
exposes `readonly maxBytes?: number` ("Reject/refuse a record whose bytes exceed
this cap. Default: 8 MiB"); `openReplica` resolves `options.maxBytes ??
DEFAULT_MAX_BYTES` (`8 * 1024 * 1024`, `record.ts`) and throws `TypeError` unless it
is a positive integer; the harness `open(handle, options: OpenOptions)` **forwards
`options` verbatim** to `openReplica(options)` and existing specs already use it
(`errors-lifecycle.spec.ts` opens with `maxBytes: 4`). **So the harness-only
passthrough already exists; this correction needs no change to `harness.ts` for
`maxBytes` and no change to the persistence engine** (the earlier "the harness
exposes no `maxBytes` option" premise was inaccurate — `window.__gs.open("s", {
…, maxBytes })` is the existing path). The only harness additions are the capsule
hooks above.

The size error is the pre-write check in `session.ts` `#saveOnce`:
`captured.length > this.#maxBytes` ⇒ `#failSave(new PersistenceError(
"QuotaExceededError", "GhostSync Persist: snapshot exceeds maxBytes (N > M)"))` ⇒
session state `"error"`, in-memory replica untouched, `flush()` rejects. The
existing e2e asserts `flush` → `{ ok: false, code: "QuotaExceededError" }` and
`get` still returning the value.

Deterministic scenario (`capsule-persistence.spec.ts` › "merged snapshot above
maxBytes ⇒ applied:true, persisted:false"), two sessions in one Chromium page, same
`app`/`documentId` (`"a"`/`"d"`), distinct `replicaId`s and distinct `dbName`s:

1. **Source** `"src"` (`replicaId: "rS"`, default `maxBytes`): `set("payload",
   "x".repeat(2048))`; `exportCapsuleHex("src")` → `capsuleHex`. The capsule update
   is ≈ 2.1 KB, far below the capsule defaults (`maxCapsuleBytes` 16 MiB,
   `maxUpdateBytes` 8 MiB), so it passes every capsule limit.
2. **Target** `"tgt"` (`replicaId: "rT"`) opened with **`maxBytes: M = 1024`**
   (fixed constant). `set("t", "small")`; `flush("tgt")` must be `{ ok: true,
   state: "saved" }` (proves the existing snapshot fits). Read `S1 =
   exportHex("tgt").length / 2` and **assert `S1 < M`** (expected a few dozen
   bytes; the margin is ~1 KB, which absorbs the few-byte variation a random Yjs
   client id causes).
3. **How M is chosen deterministically:** rather than a measured `S1 + headroom`
   (which would need a probe session because `maxBytes` is fixed at open), choose a
   fixed `M = 1024`. The scenario's validity is established by **measurement of
   real update bytes, not arithmetic over the payload length**: before the import the
   test asserts `S1 < M` (the target's saved snapshot fits), and after the import it
   measures `S_merged` (step 5) and asserts `S_merged > M`. The payload is sized
   (≈ 2.1 KB against M = 1024) so the merge is expected to exceed `M` by a wide
   margin that absorbs the few-byte variation a random Yjs client id causes, but the
   assertion itself is the measured byteLength, never an inequality derived from the
   string length.
4. `importCapsuleHex("tgt", capsuleHex)` ⇒ **expected** `{ applied: true,
   persisted: false, saveError: { code: "QuotaExceededError", message containing
   "snapshot exceeds maxBytes" } }` (the real text from `session.ts`; the test
   asserts on `code` and on the stable substring, not on exact byte counts).
5. **Measure the actual post-import snapshot** with the existing public session
   export API: `S_merged = exportHex("tgt").length / 2`, i.e. the byteLength of
   `PersistSession.exportBytes()` (the harness `exportHex` calls
   `session(handle).exportBytes()`; `exportBytes()` stays available because the
   session is open in `"error"`, not closed or disposed), and **assert `S_merged >
   1024`** (the byteLength exceeds `maxBytes`). Post-conditions asserted in the same
   test: `state("tgt") === "error"` (visibly unsaved); `get("tgt", "t") === "small"` **and** `get("tgt", "payload") ===
   "x".repeat(2048)` (merged data readable: both target and imported keys); the
   in-memory snapshot is preserved (a second `flush` also fails with
   `QuotaExceededError`, no silent success). The test is **unconditional**: no `if`,
   no `test.skip`, no `test.fixme`.

The capsule layer neither predicts nor guards this: the failure is the Persist
contract, reported as `persisted: false`, not as a capsule rejection and not as
`OversizedDecoded`.
- A file `<input type="file" accept=".gscap">` and a "download capsule" button in
  `index.html`, keyboard-reachable and focus-visible (harness is a test page, but
  the UI steering's keyboard/focus rules are cheap to honor here).

These are **test instrumentation**, consistent with the existing harness comment
"NOT an application UI". The shipped `@ghostsync/capsule` package contains no DOM
or file code.

## Error handling (concrete, per operation)

All async functions signal failure by **rejecting** their returned `Promise`
(read "throws" below as "rejects with"); `encodeCapsule`'s input-shape checks are
synchronous TypeErrors raised before the hash (so they reject the promise too).

| Operation / failure condition | Recoverable? | Caller receives | Logged? |
| --- | --- | --- | --- |
| `decodeCapsule`: raw too large | fatal for this input | rejects `CapsuleError("OversizedRaw")` | no (package never writes console) |
| `decodeCapsule`: bad magic / too short / bad length framing / JSON parse fail / bad field / unknown key / **duplicate/ambiguous metadata key** / `updateByteLength` ≠ M / truncated | fatal for this input | rejects `CapsuleError("Malformed")` | no |
| `decodeCapsule`: header version byte `2..255` | fatal for this input | rejects `CapsuleError("UnsupportedVersion")` | no |
| `decodeCapsule`: header version byte `0`; or header byte `1` but `metadata.formatVersion !== 1` (header/metadata **disagree**) | fatal for this input | rejects `CapsuleError("Malformed")` (never `UnsupportedVersion`) | no |
| `decodeCapsule`: metadata begins with a UTF-8 BOM (`EF BB BF` / decoded U+FEFF) | fatal for this input | rejects `CapsuleError("Malformed")` **before** the token scan and before hashing | no |
| `decodeCapsule`: decoded update too large | fatal for this input | rejects `CapsuleError("OversizedDecoded")` | no |
| `decodeCapsule`: metadata not valid UTF-8 (fatal decode) / escaped or non-64/uppercase/non-hex `sha256` token / duplicate **decoded** key | fatal for this input | rejects `CapsuleError("Malformed")` | no |
| `decodeCapsule` / `encodeCapsule` / import: `bytes` or encode input is `SharedArrayBuffer`-backed, wrong type, or bad `opts` | programmer error | rejects `TypeError` (documented; not a `CapsuleError`) | no |
| `decodeCapsule` / `encodeCapsule` / import: `crypto.subtle` missing or `digest` rejects/throws | environment / missing platform capability (the input is **not** judged malformed) | rejects `CapsuleError("CryptoUnavailable", …, cause)`; `cause` preserved; import: nothing applied, `flush` not called | no |
| `decodeCapsule`: checksum ≠ stored | fatal for this input | rejects `CapsuleError("ChecksumMismatch")` | no |
| `importCapsuleInto*`: app mismatch | fatal for this input | rejects `CapsuleError("AppIdentityMismatch")`; no apply | no |
| `importCapsuleInto*`: document mismatch | fatal for this input | rejects `CapsuleError("DocumentIdentityMismatch")`; no apply | no |
| `importCapsuleIntoPersisted`: capsule `app` ≠ `target.identity.app` (correct documentId, other app) | fatal for this input | rejects `CapsuleError("AppIdentityMismatch")` **before apply and before flush**; state unchanged; `flush` not called | no |
| `importCapsuleInto*`: `applyUpdate` returns `!ok` | fatal for this input | rejects `CapsuleError("SdkRejection", …, { reason })`; target unchanged | no |
| `importCapsuleInto*`: `target.applyUpdate` **throws** (target closed/recovery/terminated **before** apply, e.g. `ClosedError`) | terminal for this target | rejects `CapsuleError("TargetUnavailable", …, cause)`; nothing applied; **never** `applied: true`; `flush` not called | no |
| `importCapsuleIntoPersisted`: `flush()` rejects on an **open** session after a successful apply (`TransactionAbortError`/`QuotaExceededError`/checksum-failed → `#failSave`→`error`) | **recoverable** | resolves `{ applied: true, persisted: false, saveError }`; in-memory data readable via `getState()`; session `state === "error"` | no |
| `importCapsuleIntoPersisted`: merged snapshot exceeds Persist `maxBytes` (flush's pre-write check → `QuotaExceededError`) | **recoverable** (persistence failure, not capsule rejection) | resolves `{ applied: true, persisted: false, saveError }`; data readable; state `"error"` | no |
| `importCapsuleIntoPersisted`: apply succeeded, then session terminated during `flush()` (`ClosedError`) | terminal | resolves `{ applied: true, persisted: false, saveError }`; in-memory access **not** guaranteed after disposal; NOT the recoverable guarantee | no |
| `encodeCapsule`: `update` is a `TransportUpdate` with `kind !== "full"` (e.g. a diff) | programmer error | rejects `TypeError` ("encodeCapsule requires a full-state update") at the boundary, before hashing | no |
| `encodeCapsule`: `update` is a `TransportUpdate` whose `documentId !== input.documentId` (F3) | programmer error | rejects `TypeError` at the boundary, before any hashing and before any `await` | no |
| `encodeCapsule`: non-`Uint8Array`/non-`TransportUpdate` update / empty / invalid app or documentId / non-canonical `createdAt` | programmer error | rejects `TypeError` (fail fast at the boundary) | no |

The package never writes to `console` and never includes byte contents, keys, or
PII in error messages (NFR-CAP-004) — messages name the failing check only,
mirroring Persist's `PersistenceError` discipline.

## Validation rules for each external input

- **`bytes: Uint8Array` (decode/import):** required; must be a `Uint8Array`
  (else `TypeError`). Everything about its contents is untrusted and validated by
  the pipeline above. Limits: `maxCapsuleBytes` (default 16 MiB), `maxUpdateBytes`
  (default 8 MiB). Behavior on failure: typed `CapsuleError`.
- **`bytes` additionally:** must not be backed by a `SharedArrayBuffer` (`TypeError`,
  see Buffer ownership). The bytes are snapshotted before the first `await`.
- **`expected.app` (REPLICA helper `importCapsuleInto` only):** required non-empty
  string; the trust anchor for the capsule's claimed `app`. Mismatch:
  `AppIdentityMismatch`. The persisted helper has **no** such argument.
- **`target.documentId` (replica helper) / `target.identity.app` and
  `target.identity.documentId` (persisted helper):** required non-empty strings; the
  trust anchors for the capsule's claimed `app`/`documentId`. The capsule's claimed
  identity is **never** trusted to select a target — the caller supplies the target.
  Mismatch: `AppIdentityMismatch` / `DocumentIdentityMismatch`. A persisted target
  lacking these strings is a `TypeError` (programmer error).
- **`update` (encode):** required; either a `Uint8Array` or a `TransportUpdate`.
  If a `TransportUpdate` is passed, `kind` MUST be `"full"` (a `"diff"` is a
  `TypeError` at the boundary, NIT-1) **and `update.documentId` MUST equal
  `input.documentId`** (else `TypeError`, thrown/rejected **before hashing and
  before any `await`**, F3) — the capsule never labels one document's bytes with
  another document's id. A bare `Uint8Array` is treated as full-state bytes and
  carries **no independently checkable document identity**: its `documentId` is
  whatever the caller asserts in `input.documentId`, and that identity remains the
  **caller's responsibility** (the importing end still checks it against the
  target). The caller is documented to pass `exportState()` (the whole
  `TransportUpdate`) so the cross-check runs.
- **`createdAt` (encode):** optional; defaults to `new Date().toISOString()`.
  Validated as **strict ISO-8601 UTC** (round-trip `new
  Date(s).toISOString() === s` and the millisecond-`Z` regex); informational only.
  A non-canonical string is a `TypeError`.
- **`opts.maxCapsuleBytes` / `opts.maxUpdateBytes`:** optional positive integers;
  a non-positive or non-integer value is a `TypeError` at the boundary.

## Invariants and owning layers

- **Merge correctness / convergence / idempotency** — owned by the **Kit**
  (`Y.applyUpdate`). The capsule never reorders or dedups; it hands bytes to
  `applyUpdate` and inherits CRDT guarantees (REQ-CAP-007).
- **Durability** — owned by **Persist** (`flush()` / save-state machine). The
  capsule only *observes* durability via the flush promise (REQ-CAP-009).
- **Format integrity, size bounds, identity gating, checksum** — owned by the
  **capsule** layer. These are the only invariants this package enforces.
- **In-doc `SchemaIdentity` per collection** — owned by the **Kit**, carried
  inside the update bytes. The capsule's top-level `app` is a transport-level
  identity namespace and deliberately does **not** duplicate or re-validate the
  per-collection schema meta (no competing schema system).

## Files to create

```
packages/capsule/
  package.json              # @ghostsync/capsule, workspace:* dep on kit; scripts mirror kit
  tsconfig.json             # strict; includes src + tests + config
  tsconfig.build.json       # src-only emit to dist
  vitest.config.ts          # node env
  vitest.setup.ts           # fast-check global seed/numRuns (mirror kit)
  src/
    index.ts                # public re-exports
    format.ts               # magic/version/layout constants, header read/write, DataView helpers
    metadata.ts             # CapsuleMetadata type + field validation + fatal-UTF-8 decode
    token-scan.ts           # JSON-aware top-level token scan: decoded names, raw value spans -> UTF-8 byte offsets
    checksum.ts             # sha256Hex over the covered region (crypto.subtle); zero-placeholder swap by scanned span; hex compare
    errors.ts               # CapsuleError + CapsuleErrorCode + isCapsuleError
    encode.ts               # encodeCapsule
    decode.ts               # decodeCapsule (validation pipeline)
    import.ts               # importCapsuleInto / importCapsuleIntoPersisted
    types.ts                # ReplicaTarget/PersistTarget/ImportResult/PersistImportResult/PersistLikeError
  tests/
    roundtrip.test.ts
    format.test.ts
    metadata.test.ts        # includes duplicate/ambiguous-key rejection + strict createdAt
    checksum.test.ts        # async round-trip; recompute-over-received-bytes (no reserialize)
    token-scan.test.ts      # Unicode-before-sha256 offsets; BOM-prefixed metadata => Malformed (before scan); escaped-equivalent duplicate keys; escapes in checksum token; whitespace/reorder; invalid UTF-8
    version.test.ts         # header byte 0 => Malformed; 1 ok; 2..255 => UnsupportedVersion; header/metadata formatVersion disagreement => Malformed
    crypto-unavailable.test.ts # digest missing/rejecting => CapsuleError("CryptoUnavailable") for encode/decode/import; cause preserved; not Malformed; nothing applied
    tamper.test.ts          # flipped payload byte => ChecksumMismatch; flipped header/metadata bytes may fail earlier
    size-limits.test.ts
    identity.test.ts        # app + doc identity, incl. persisted path governed by target.identity.{app,documentId}; cross-app regression
    errors.test.ts          # TypeError vs CapsuleError boundary per function
    sdk-rejection.test.ts
    encode-kind.test.ts     # rejects a TransportUpdate with kind "diff" (NIT-1); TransportUpdate.documentId !== input.documentId => TypeError before hashing; matching full TransportUpdate encodes; raw bytes encode with caller-asserted identity (F3)
    no-mutation.test.ts
    converge.test.ts
    merge-semantics.test.ts # empty-source capsule into fresh AND populated target; merged-size => persisted:false mapping (fake flush)
    target-closed.test.ts   # target closed before apply => TargetUnavailable, never applied:true, flush not called
    snapshot-ownership.test.ts # BOTH ownership categories: (a) mutate caller input right after invoking encode/decode/import, before await => validated/applied data unchanged; (b) returned buffers (encoded capsule, decoded update) do not alias caller input after completion; SharedArrayBuffer => TypeError
    merge.property.test.ts
    no-node-imports.test.ts
    fc-report.ts            # shared fast-check reporter helper — NOT *.test.ts (NIT-4), mirrors the Kit
```

Per **NIT-4**: any shared property-test helper (the fast-check reporter) is named
`fc-report.ts` — deliberately **without** the `.test.ts` suffix — so the
`tests/**/*.test.ts` Vitest include does not collect it as an empty suite,
mirroring `packages/kit/tests/fc-report.ts`.

## Files to modify (implementation milestone only — NOT this planning step)

- `packages/persist/harness/harness.ts` + `harness/index.html` — add the
  download/import controls and the `exportCapsuleHex`/`importCapsuleHex` hooks
  described above (consume the built `@ghostsync/capsule`; include the real
  `PersistSession` → `PersistTarget` compile-time use). No `maxBytes` passthrough
  change is needed (already forwarded via `open(handle, OpenOptions)`).
- `packages/persist/e2e/capsule-transfer.spec.ts` (new) and
  `packages/persist/e2e/capsule-persistence.spec.ts` (new) — Chromium specs.
- `packages/persist/package.json` — add `@ghostsync/capsule: "workspace:*"` as a
  **devDependency** (harness consumer only; Persist `src` never imports it). Like
  creating `packages/capsule`, this changes `pnpm-lock.yaml`; see the install
  procedure below. Flagged, not done now.

The persist *source*, the Kit, apps, and existing tests are **not** touched.

## Dependency / build order

```
@ghostsync/kit  (build → dist)      # already built; unchanged
   ↓ workspace:*   (kit <- capsule)
@ghostsync/capsule (build → dist)   # new; depends ONLY on kit; NO edge to persist
   ↓ devDependency of persist, consumed by the harness (typecheck + Vite build) only
@ghostsync/persist (build → dist; src imports kit only)
@ghostsync/persist harness (vite build → harness/dist; imports persist dist + capsule dist + kit) → Playwright serves
```

Edges: `capsule -> kit`, `persist -> kit` (existing), `persist(harness-only
devDependency) -> capsule`. **Acyclic, stated explicitly (correction pass 4, F2):**
the harness lives *inside* the persist package, so `packages/persist/package.json`
gains `"@ghostsync/capsule": "workspace:*"` under `devDependencies` (exact
workspace spec, no version range). That adds the package-level edge `persist ->
capsule`; because `capsule` imports only `@ghostsync/kit` (no import, dependency,
peer, or type-only reference to `@ghostsync/persist` anywhere in `packages/capsule`),
there is no path from `capsule` back to `persist`, so the graph stays a DAG:
`kit <- capsule <- persist(devDep)` and `kit <- persist`. Persist `src/**` never
imports capsule (the `devDependency` is test/harness only), so Persist's published
runtime surface is unchanged. Evidence checked: `packages/persist/package.json`
today has `dependencies: { "@ghostsync/kit": "workspace:*" }` and no capsule entry;
`packages/persist/node_modules/@ghostsync` contains only `kit`; `pnpm-workspace.yaml`
globs `packages/*` and `apps/*`, so no workspace-file change is needed. I found no
repo fact that makes this edge problematic, so no alternative is needed; (had it
been problematic, the accurate alternative would be to host the harness capsule
glue in a separate private package that depends on both, at the cost of moving the
Vite/Playwright harness — rejected as larger than the requirement). **Lockfile
consequence:** adding the `packages/capsule` importer *and* this devDependency both
change `pnpm-lock.yaml`; run a normal `pnpm.cmd install` to regenerate it, inspect
the diff, then `pnpm.cmd install --frozen-lockfile` must pass.

**Lockfile / install procedure (corrected).** Adding the `packages/capsule`
importer **changes `pnpm-lock.yaml`** (new importer entry; later the
`@ghostsync/capsule` link under `packages/persist`). It is therefore wrong to expect
`pnpm.cmd install --frozen-lockfile` to pass before the lockfile is regenerated.
The implementation MUST: (1) create the package, (2) run a normal
`pnpm.cmd install` from the workspace root to regenerate the lockfile (review the
lockfile diff: only the new importer/link entries, no unrelated version drift), and
(3) **then** verify with `pnpm.cmd install --frozen-lockfile`, which must succeed.
Do none of this in the planning step.

Future verification order (from a **clean checkout with no `dist/` or
`node_modules`**, so no stale artifact can mask a missing build step; exact
PowerShell commands are in `tasks.md`): install (lockfile regenerate, then
`--frozen-lockfile`) → build kit → capsule typecheck/test/build → **persist
typecheck** (needs kit + capsule `dist`; proves the real-`PersistSession`
compatibility) → persist unit tests → **persist build** (the Vite harness resolves
`@ghostsync/persist` to its built `dist/index.js`, per `vite.config.ts`) → persist
`build:harness` → Chromium specs → kit tests. The capsule package never imports
persist, so capsule steps do not wait on persist. SHA-256 uses Web Crypto
`crypto.subtle` in `src` (browser-safe, available in Node 24); no `node:crypto`
import appears in `src`. Test-only files may import `node:` builtins (the
`no-node-imports` scan covers `src/**` only, exactly as the Kit does).

## Testability

- **Unit (vitest, node):** everything except the real file I/O — encode/decode
  round trip, each rejection category, tampering, size bounds, checksum,
  identity, non-mutation snapshots, idempotent/bidirectional convergence, and
  buffer ownership. These drive the Kit through its public API in-memory, so no
  browser is needed.
- **Property (fast-check):** merge invariants over capsule-wrapped updates —
  commutativity (exchange order), associativity (grouping via re-import),
  idempotency (duplicate import) — asserting convergence against a direct Kit
  reference, reusing the seed/numRuns discipline already in the Kit
  (`seed 424242`, `numRuns 200`).
- **Integration (Playwright/Chromium):** the two things that genuinely need a
  browser — real file download + file-picker upload between two independent
  contexts (distinct `replicaId`s), survival across reload after a successful
  flush, the save-failure path using the harness's existing one-shot
  real-IndexedDB abort hook (`armWriteAbortOnce`) to drive a genuine
  `TransactionAbortError`, and the **merged-size** regression (target opened with
  `maxBytes: 1024` through the harness's existing `open(handle, OpenOptions)`
  forwarding; see **Merged-size regression (F4)**).

The design is testable because the codec is a pure function of bytes and the
import helpers depend only on a tiny structural target interface, which a test can
satisfy with a real `Replica` or a minimal structural fake (a persisted fake
carries `identity { app, documentId, replicaId }`, an injectable `applyUpdate`
outcome/throw, and a spy `flush`). The capsule's unit tests do not import a real
`PersistSession` (no `capsule -> persist` edge); real-session satisfaction and
behavior are covered by the harness typecheck and the Chromium specs.

## Edge cases

- **Empty-document capsule:** a fresh replica's `exportState().bytes` is non-empty
  Yjs bytes; the capsule encodes/decodes/imports it and it is **not** rejected as
  empty. Because import is a CRDT merge, importing an empty source **preserves an
  existing target's data**: a *fresh (empty) target* stays `{}`, and a *populated
  target* keeps every entry unchanged (state deep-equal before/after). Both are
  planned tests (`merge-semantics.test.ts`).
- **Merged document larger than Persist's limit:** see Browser integration — the
  incoming update was within `maxUpdateBytes` but the merged snapshot exceeds
  `maxBytes`; this is `{ applied: true, persisted: false, saveError }`, not a
  capsule rejection.
- **Zero-length update region (`M === 0`):** `updateByteLength: 0` is structurally
  valid metadata but produces `bytes: new Uint8Array(0)`, which the Kit rejects as
  `invalidCarrier`; import maps it to `SdkRejection`. The capsule does not special-
  case it.
- **Metadata lies about `updateByteLength`:** caught in step 4
  (`updateByteLength !== M`) → `Malformed` before hashing.
- **Duplicate / ambiguous metadata key:** a metadata object whose raw text repeats
  a top-level key (including a second `sha256`) → `Malformed` in step 4, **before**
  hashing — so the `sha256` placeholder span is always unambiguous for the
  byte-exact verify.
- **Diff passed to `encodeCapsule`:** a `TransportUpdate` with `kind: "diff"` →
  `TypeError` at the boundary (NIT-1); format v1 is full-state only.
- **Non-canonical `createdAt`:** e.g. `"1/1/2026"` or a non-`Z` offset →
  `TypeError` on encode / `Malformed` on decode (strict ISO-8601 UTC only).
- **Truncated capsule** (`11 + metaLength > length`, or total < 11): `Malformed`.
- **Trailing garbage:** total length ≠ `11 + metaLength + updateByteLength` →
  `Malformed`.
- **Duplicate import:** second import resolves `{ applied: true, … }` (the Kit
  returns `{ ok: true }` internally; the capsule result never uses `ok`) and the
  state is unchanged from the first (idempotent).
- **Byte tampering — claim scoped correctly:** a single flipped byte yields
  `ChecksumMismatch` **only if the mutated capsule still passes every earlier
  structural check** (size bounds, magic, version, length framing, UTF-8 and
  token-scan/metadata validation, `updateByteLength === M`). Flipping a payload
  byte reliably lands in this class. Flipping a magic/version/length-prefix/metadata
  byte may fail *earlier* with its own code (`Malformed`, `UnsupportedVersion`,
  `OversizedDecoded`, …), and flipping a hex digit of the stored `sha256` yields
  `ChecksumMismatch` (still well-formed). The tamper tests assert the specific
  expected code per mutation class, never a blanket "any flip ⇒ ChecksumMismatch".
- **Checksum field tampering:** editing the checksum to match tampered bytes is
  possible (no authenticity) but still a *consistent* capsule — documented as
  expected, since the checksum is integrity-only.
- **Target closed before apply:** `CapsuleError("TargetUnavailable")`, never
  `applied: true`, `flush` not called (`target-closed.test.ts`).

## Decision summary (all routine choices made)

| Decision | Choice |
| --- | --- |
| Format | binary container: 11-byte header + length-prefixed UTF-8 JSON metadata + raw update |
| Magic | ASCII `GSCAP\0` (6 bytes) |
| Format version | uint8 `1` in header; mirrored in metadata |
| Extension / media type | `.gscap` / `application/vnd.ghostsync.capsule` |
| Endianness | big-endian for all length fields (`DataView`) |
| Checksum coverage | offsets 7..end with `sha256` field zeroed to `"0"`×64; covers length prefix + metadata + update |
| SHA-256 source | Web Crypto `crypto.subtle.digest("SHA-256", …)` in `src` (browser-safe, Node 24 ok) |
| Async contract | encode/decode/import helpers return `Promise` (SHA-256 via `crypto.subtle.digest`); internal framing/metadata-validation helpers stay sync |
| Encode input `kind` | accepts `Uint8Array` or `TransportUpdate`; a `TransportUpdate` with `kind !== "full"` is a `TypeError` (diffs rejected) |
| `createdAt` format | strict ISO-8601 UTC (`toISOString()` round-trip + ms-`Z` regex) |
| Decode API | rejects `CapsuleError`; `ApplyOutcome` non-ok → `SdkRejection` |
| Persisted target | structural `{ identity: { readonly app: string; readonly documentId: string }; applyUpdate; flush; getState }` — a real `PersistSession` satisfies it unchanged (extra `replicaId` fine); does NOT extend `ReplicaTarget`; no `ResolvedIdentity` import |
| Persisted identity | governed by `target.identity.app` AND `target.identity.documentId`; `importCapsuleIntoPersisted(target, bytes, opts?)` has NO expected-app argument |
| Replica identity | `importCapsuleInto(target, bytes, { app }, opts?)`: explicit expected app; document id from `target.documentId` |
| Success shape | `{ applied: true, … }` (never `ok: true`); persisted adds `persisted`, `saveError?` |
| Persisted import API | resolves `{ applied: true, persisted, saveError? }` only after a successful apply; save failure (incl. merged size > Persist `maxBytes`) is `persisted:false`, not a rejection; target closed before apply rejects `TargetUnavailable` |
| Metadata parsing | fatal UTF-8 + JSON-aware token scan (decoded names, byte-offset value spans, duplicate-decoded-key rejection, `sha256` = 64 literal lowercase hex, no escapes); no regex location, no reserialization |
| Metadata decoder / BOM | `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` (`ignoreBOM: true` KEEPS a leading U+FEFF); a leading BOM (`EF BB BF`) is rejected `Malformed` before the token scan |
| Header version byte | `1` supported; `0` → `Malformed`; `2..255` → `UnsupportedVersion`; header `1` but `metadata.formatVersion !== 1` → `Malformed` |
| Encode identity | `TransportUpdate` input: `kind === "full"` AND `update.documentId === input.documentId`, else `TypeError` before hashing; raw `Uint8Array` identity is the caller's responsibility |
| Digest unavailable | `CapsuleError("CryptoUnavailable", …, cause)` for encode, decode and import; never `Malformed` |
| Real-session proof | harness passes a real `PersistSession` to `importCapsuleIntoPersisted` (no cast); `pnpm.cmd -F @ghostsync/persist typecheck` after Kit + Capsule builds |
| Merged-size browser test | target `maxBytes: 1024` via existing harness `open(handle, OpenOptions)`; unconditional; `applied:true, persisted:false, QuotaExceededError`, state `"error"`, data readable |
| Buffer ownership | snapshot-first: copy after raw-size check, before first `await`; parse/hash/return/apply from the same snapshot; SharedArrayBuffer-backed input => `TypeError` |
| Raw / decoded caps | 16 MiB / 8 MiB defaults, both configurable |
| Runtime deps | `@ghostsync/kit` only (`workspace:*`); graph `kit <- capsule`, no `capsule -> persist`; new importer DOES change `pnpm-lock.yaml` (`pnpm.cmd install`, then `--frozen-lockfile`) |

## Unresolved decisions (genuinely open — each with a recommendation)

- **U1 — Should `importCapsuleIntoPersisted` call `flush()` or rely on the
  session's auto-save plus a state check?** The Persist session auto-schedules a
  save on every accepted import; `flush()` deterministically awaits the specific
  generation. **Recommendation:** call `flush()` so `persisted` reflects *this*
  import's durability deterministically (chosen in the design above). Confirm at
  review that gating `persisted` on `flush()` resolution is the contract we want.
- **U2 — Default cap values (16 MiB raw / 8 MiB decoded).** The decoded cap
  intentionally matches Persist's `DEFAULT_MAX_BYTES` (8 MiB) so a standalone
  capsule is not oversized for persistence on its own (this does **not**
  guarantee the *merged* document fits — see Browser integration); the raw cap adds headroom for header+metadata+future
  growth. **Recommendation:** keep 16/8 MiB; revisit only if a real payload
  approaches it.

## Responses to review findings (correction pass)

This design was revised against `.review/review.md` / `.review/verdict.json`
(verdict CHANGES_REQUESTED: 1 HIGH, 3 MEDIUM, 4 NIT) plus an async-contract
correction and a checksum-ambiguity correction. Every finding is **addressed**;
none is backlogged or ignored.

- **HIGH-1 — `PersistTarget extends ReplicaTarget` not satisfied by a real
  `PersistSession`.** Addressed. `PersistTarget` no longer extends `ReplicaTarget`
  and no longer requires a top-level `documentId`. It is defined structurally as
  `{ readonly identity: <minimal structural {app, documentId}> [pass 3; was a
  Persist type]; applyUpdate(carrier: unknown):
  ApplyOutcome; flush(): Promise<void>; getState(): State }`, which a real
  `PersistSession` satisfies with no wrapper and no change to `PersistSession`
  (confirmed against `packages/persist/src/types.ts`). The persisted helper reads
  the document id from `target.identity.documentId`.
- **MEDIUM-1 — dual document-id sources on the persisted path.** Addressed. The
  explicit `documentId` parameter was removed from `importCapsuleIntoPersisted`;
  the governing sources are `target.identity.documentId` (and, since pass 3,
  `target.identity.app` with no expected-app argument). Validation-order
  step 8 now states one source per path (`target.documentId` for the replica
  helper; `target.identity.documentId` for the persisted helper). A caller cannot
  override the target's identity. See **Identity rules per path**.
- **MEDIUM-2 — `State`/SDK types not stated as imported; strict/no-any.**
  Addressed. The Public API now shows `State`, `ApplyOutcome`, `TransportUpdate`
  imported from `@ghostsync/kit` only (pass 3 removed the earlier Persist
  `ResolvedIdentity` import), never redefined. Strict
  TS with runtime validation on `unknown`/`Uint8Array` inputs is stated; no
  `any`-based workarounds.
- **MEDIUM-3 — save-failure "state is error and recoverable" over-claim.**
  Addressed. The recoverable guarantee is scoped to an **open** session whose
  `flush()` fails via `#failSave` → `"error"` (the `armWriteAbortOnce`
  `TransactionAbortError` case). A `ClosedError` flush on a closed/recovery/
  disposed session is documented as a separate terminal/programmer-error path
  where in-memory access is **not** guaranteed. AC-CAP-009-2 is scoped to the
  still-readable case.
- **NIT-1 — `encodeCapsule` assumes `kind: "full"`.** Addressed. `encodeCapsule`
  accepts `Uint8Array | TransportUpdate`; a `TransportUpdate` with `kind !==
  "full"` is a `TypeError` at the boundary. The rule is stated even for the bare
  `Uint8Array` form (must be `exportState().bytes`).
- **NIT-2 — `createdAt` admits non-ISO strings.** Addressed. Chosen: **strict
  ISO-8601 UTC**, enforced by a `toISOString()` round-trip plus a millisecond-`Z`
  regex, stated identically in `requirements.md` and `design.md`.
- **NIT-3 — hard-coded test counts.** Addressed in `requirements.md`/`tasks.md`:
  replaced `112/8/50/30` with "unchanged from the pre-change baseline captured at
  implementation time", and distinguished test-**file** counts (42 kit / 7 persist
  unit / 9 e2e, confirmable from the tree) from test-**case** counts (not
  asserted).
- **NIT-4 — shared fast-check helper must not match the test glob.** Addressed.
  The helper is named `tests/fc-report.ts` (no `.test.ts` suffix), listed in
  **Files to create** with the explicit note, and reinforced in `tasks.md` 5.1.
- **Async-contract correction.** Addressed. `encodeCapsule`, `decodeCapsule`,
  `importCapsuleInto`, and `importCapsuleIntoPersisted` are all `async`/`Promise`
  because `crypto.subtle.digest` is async; only internal, non-hashing framing/
  metadata helpers stay sync. Reflected in signatures, examples, the error
  contract (rejections), tasks, and planned tests (`await`).
- **Checksum-ambiguity correction.** Addressed. The `sha256` field is a
  fixed-width 64-char lowercase-hex string that appears exactly once (duplicate/
  ambiguous keys → `Malformed` before hashing); encode writes `"0".repeat(64)`,
  hashes offsets 7..end, then overwrites those 64 bytes in place; verify hashes the
  **received** bytes with only that 64-byte span swapped to the placeholder and
  **never** reserializes parsed JSON.


## Responses to external findings (correction pass 3)

Five external finding groups were addressed in this pass. Each is mapped to
requirement IDs (`requirements.md`), a task (`tasks.md`), and named **planned**
tests. **No test has been run.** This section supersedes any older wording above
that mentions a `ResolvedIdentity` import, an expected-app argument on the
persisted helper, or "no lockfile change" (those described earlier passes).

1. **Persisted identity.** `importCapsuleIntoPersisted(target, bytes, opts?)` has no
   expected-app argument; `target.identity.app` AND `target.identity.documentId`
   govern. The replica helper keeps explicit `expected.app`. Regression: correct
   `documentId`, other app ⇒ `AppIdentityMismatch` before apply and flush, state
   deep-equal, flush not called. (REQ-CAP-003, AC-CAP-003-4; task 4.3/5.1;
   `identity.test.ts` › "persisted import rejects correct documentId with another
   app before apply and flush".)
2. **Dependency / type resolution.** No `ResolvedIdentity` import/re-export;
   `PersistTarget.identity` is `{ readonly app: string; readonly documentId: string }`;
   a real `PersistSession` satisfies it unchanged (proven in the harness by passing a
   real `PersistSession` to `importCapsuleIntoPersisted`; strengthened in pass 4, F2).
   Graph `kit <- capsule`, no `capsule -> persist`. New importer changes the
   lockfile: `pnpm.cmd install`, then `pnpm.cmd install --frozen-lockfile`.
   (NFR-CAP-002, REQ-CAP-003; tasks 1.1/4.1/6.1/6.2/7.0.)
3. **Byte-exact metadata/checksum parsing.** Fatal UTF-8 + JSON-aware token scan;
   decoded names + raw value spans in UTF-8 byte offsets; duplicate decoded keys
   rejected; `sha256` = exactly 64 literal lowercase hex, no escapes; regex-only
   location and reserialization forbidden. (REQ-CAP-002/004, AC-CAP-002-4,
   AC-CAP-004-2/3; task 2.3/2.4; `token-scan.test.ts`.)
4. **Async snapshot ownership.** Copy after raw-size check and before the first
   `await`; parse/hash/return/apply from the snapshot; encode captures inputs before
   hashing; SharedArrayBuffer ⇒ `TypeError`. (NFR-CAP-003, AC-CAP-NFR3-1/2; tasks
   3.1/3.2/4.2/4.3; `snapshot-ownership.test.ts`.)
5. **Merge / results / errors.** (a) empty source preserves target (fresh and
   populated); (b) merged size vs Persist limit ⇒ `persisted:false`; (c) success is
   `{ applied: true }`; (d) TypeError vs CapsuleError table per function;
   (e) flipped-byte claim scoped to mutations passing earlier checks; (f) target
   closed before apply ⇒ `CapsuleError("TargetUnavailable")`, never applied.
   (REQ-CAP-006/007/008/009; AC-CAP-007-3, 009-3, 009-4, 004-1; tasks 4.2/4.3/5.1;
   `merge-semantics.test.ts`, `errors.test.ts`, `tamper.test.ts`,
   `target-closed.test.ts`.)


## Responses to correction-3 review findings (correction pass 4)

Source: `.review/correction-3-review.md` (F1-F4 MEDIUM, F5-F7 NIT). **No test has
been run**; every test below is PLANNED. This section supersedes any older wording
above that conflicts (notably `ignoreBOM: false`, "if the harness can open with a
small `maxBytes`", `Malformed` for a digest failure, an unspecified version byte
`0`, and "encode never rejects with a CapsuleError").

- **F1 - BOM / byte offsets.** Decoder is `new TextDecoder("utf-8", { fatal: true,
  ignoreBOM: true })`; `ignoreBOM: true` keeps a leading U+FEFF, `false` strips it
  (previous claim corrected). A leading `EF BB BF` is rejected `Malformed` before the
  token scan. Named planned tests in `token-scan.test.ts`: "BOM-prefixed metadata is
  Malformed" and "Unicode content before sha256 keeps byte offsets correct (round
  trip verifies)".
- **F2 - real structural check.** Harness passes a real `PersistSession` to
  `importCapsuleIntoPersisted` plus an explicit `PersistTarget` binding;
  `pnpm.cmd -F @ghostsync/persist typecheck` (covers `harness/**/*.ts`) is required
  after the Kit and Capsule builds; clean-checkout verification order in
  `tasks.md`. Graph: `kit <- capsule`, `persist(harness devDependency) -> capsule`,
  no `capsule -> persist`; lockfile regenerated by install then `--frozen-lockfile`.
- **F3 - encode identity.** `TransportUpdate`: `kind === "full"` AND `documentId`
  equals `input.documentId`, else `TypeError` before hashing/await. Raw bytes: caller
  responsibility. Planned tests in `encode-kind.test.ts`.
- **F4 - merged-size browser test.** The harness already forwards `OpenOptions`
  (including `maxBytes`) to `openReplica`; scenario fixed at `M = 1024`, target
  `{"t":"small"}`, incoming `{"payload": "x".repeat(2048)}`; unconditional test in
  `capsule-persistence.spec.ts`.
- **F5 - version byte.** `1` ok, `0` Malformed, `2..255` UnsupportedVersion;
  header/metadata disagreement is `Malformed`. Planned `version.test.ts`.
- **F6 - digest failure.** New code `CryptoUnavailable` (encode, decode, import);
  `cause` preserved; not `Malformed`. Planned `crypto-unavailable.test.ts`.
- **F7 - ordering.** Acceptance-criterion list reordered in `requirements.md`
  (IDs unchanged).

---

## Post-verdict inline edits (after correction-4 CHANGES_REQUESTED; NOT independently reviewed)

After the correction-4 review returned **CHANGES_REQUESTED** (1 MEDIUM, 2 NIT; verdict
preserved in `.review/`), three mechanical fixes were applied inline with no new
independent approval:

- **Error contract:** AC-CAP-006-1 (requirements) is scoped to capsule-content and
  documented operational `CapsuleError` codes; `TypeError` for programmer misuse is
  unchanged and remains defined by the per-function error table in this document.
- **Test consolidation:** the file layout lists a single `snapshot-ownership.test.ts`
  covering mutation-during-async, returned-buffer non-aliasing, and SharedArrayBuffer
  rejection; there is no separate `buffer-ownership.test.ts`.
- **Merged-size assertion:** the Chromium scenario measures the actual post-import
  full-state update bytes through `PersistSession.exportBytes()` (harness `exportHex`)
  and asserts `S_merged > maxBytes` (1024); the arithmetic stand-in
  (`payload length 2048 > M − S1`, `S_merged ≥ S1 + 2048`) is retired. Any older
  wording above that uses that arithmetic is superseded by this note.

All tests named remain **PLANNED; none has been executed.**
