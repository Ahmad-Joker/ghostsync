# @ghostsync/capsule

Versioned, integrity-checked **file capsules** around a GhostSync full-state update.
The capsule owns the file format, byte validation, checksum, and import orchestration.
Merging stays in `@ghostsync/kit`; durability stays in `@ghostsync/persist`.
Runtime dependency: `@ghostsync/kit` only. The package imports nothing from Persist.

> **Integrity, not authenticity.** The SHA-256 checksum detects accidental or malicious
> corruption of the bytes. It does **not** authenticate the sender and gives no
> confidentiality. Anyone can craft a capsule with a correct checksum. Treat every
> capsule as untrusted input.

## Usage

```ts
import { createKit } from "@ghostsync/kit";
import {
  encodeCapsule,
  importCapsuleInto,
  importCapsuleIntoPersisted,
  isCapsuleError,
} from "@ghostsync/capsule";

const source = createKit().createReplica("incident-42");
source.set("status", "triage");

// Pass the whole TransportUpdate so kind === "full" and documentId are cross-checked.
const bytes = await encodeCapsule({
  app: "fieldledger",
  documentId: source.documentId,
  update: source.exportState(),
});

// In-memory replica: expected app is explicit, document id comes from the target.
const target = createKit().createReplica("incident-42");
await importCapsuleInto(target, bytes, { app: "fieldledger" }); // { applied: true, metadata }

// Persisted session: app and documentId both come from session.identity.
// A real PersistSession is passed as-is (no cast, no wrapper).
const r = await importCapsuleIntoPersisted(session, bytes);
if (!r.persisted) console.warn(r.saveError); // applied in memory, NOT saved
```

All four functions are `async` (SHA-256 uses `globalThis.crypto.subtle`).

### Results and errors

- Success is `{ applied: true, ... }`, never `ok: true`.
- `importCapsuleIntoPersisted` resolves `{ applied: true, persisted, saveError? }` only after a
  successful apply. A failed flush is `persisted: false` with the real Persist error
  (for example `QuotaExceededError` when the merged snapshot exceeds Persist's `maxBytes`),
  not a rejection.
- `CapsuleError` (`code`, optional `cause`) signals a bad capsule or a documented
  operational condition: `UnsupportedVersion`, `Malformed`, `AppIdentityMismatch`,
  `DocumentIdentityMismatch`, `OversizedRaw`, `OversizedDecoded`, `ChecksumMismatch`,
  `SdkRejection`, `TargetUnavailable` (target's `applyUpdate` threw, e.g. a closed session; nothing applied),
  `CryptoUnavailable` (digest missing or failing; `cause` preserved).
- `TypeError` signals programmer misuse: wrong argument types, a `diff` or
  mismatched-`documentId` `TransportUpdate` on encode, invalid `opts`, a non-canonical
  `createdAt`, an empty update, or `SharedArrayBuffer`-backed bytes.
- Defaults: `maxCapsuleBytes` 16 MiB (raw), `maxUpdateBytes` 8 MiB (decoded).

### Buffer ownership

Every function copies its byte input into an owned plain `Uint8Array` before its first
`await`. Validation, hashing, returned values and the bytes handed to `applyUpdate` all
derive from that snapshot. Later mutation of the caller's buffer (including a Node
`Buffer`) cannot change what was verified or applied, and returned buffers never alias
caller input.

## File format (version 1)

File extension `.gscap`, media type `application/vnd.ghostsync.capsule`
(both are UI hints; a file is only accepted by validating its bytes).

All integers are unsigned big-endian.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 6 | magic `GSCAP\0` (`47 53 43 41 50 00`) |
| 6 | 1 | formatVersion (`1`) |
| 7 | 4 | metaLength (uint32) |
| 11 | N | metadata: UTF-8 JSON |
| 11+N | M | raw full-state update; total length must equal `11 + N + updateByteLength` |

Header version byte: `1` supported, `0` is `Malformed`, `2..255` is `UnsupportedVersion`.

Metadata keys (exactly these, no others): `formatVersion` (must be `1`, matching the header,
otherwise `Malformed`), `app`, `documentId` (non-empty strings), `updateByteLength` (must equal M),
`sha256`, `createdAt` (canonical ISO-8601 UTC with milliseconds, informational only).

### Checksum

`sha256` is lowercase-hex SHA-256 over the received bytes from **offset 7 to the end**
with the 64-byte `sha256` value replaced by 64 ASCII `"0"` bytes. It is a fixed-width
in-place overwrite, so the digest is computed over the exact bytes received, never over
re-serialized JSON.

### Metadata scan

Metadata is decoded with `TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`.
A leading BOM (`EF BB BF`) is `Malformed` before scanning. A hand-written JSON token scan records
each top-level member's decoded name and its value span as UTF-8 **byte** offsets, rejects
duplicate decoded keys (including escaped spellings such as `"\u0073ha256"`), and requires the
`sha256` token to be exactly 64 literal lowercase hex characters with no escapes. Whitespace and
key order are free.

### Validation order

argument types, raw size, magic and version, length framing, metadata decode/scan/fields,
`updateByteLength`, decoded size, checksum (these make up `decodeCapsule`), then in the import helpers identity (app, then document) and the Kit's
`applyUpdate`. Only the final step mutates the target. Decoded size is checked before hashing.

## Limitations

- Full-state capsules only; no differential capsules, encryption, compression, or QR.
- Size caps bound memory, not CPU: a crafted in-bounds Yjs update can still be expensive to apply.
- The capsule neither predicts nor guards the merged document size against Persist's `maxBytes`.
