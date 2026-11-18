# PatchBoard MVP: Design

Status: PLANNED. Nothing here is implemented, built or run. Baseline `690cffd`, branch
`feat/patchboard`. Requirement IDs refer to `requirements.md`. Every signature quoted below from the
Kit, Persist, Capsule or FieldLedger was read from source at the baseline; the app signatures are
proposals.

## 1. Architecture overview

```
apps/patchboard (plain TypeScript, Vite build, root-hosted)
  ui/*            DOM views (textContent only), announcer, focus handling
  session/*       SessionController: the ONLY holder of the PersistSession
  model/*         pure: adapter, placement, position, ordering, read model, write helpers, diff
  transfer/*      filename, export (download helper), capsule metadata display
  offline/*       service worker registration and readiness (adapted from FieldLedger)
  identity/*      board ID rules, replica ID store
  state/*         save label, error mapping
        |  built public entries only
@ghostsync/persist  openReplica -> PersistSession (IndexedDB, Web Lock, save state)
@ghostsync/capsule  encodeCapsule, importCapsuleIntoPersisted, decodeCapsule, CapsuleError
@ghostsync/kit      createKit/Replica, Collection<T>, EntityAdapter<T>, listResults, GetResult
```

- Merge is the Kit's per-field last-writer-wins over `ghostsync:records:v1`. PatchBoard adds no merge
  code (steering `architecture.md`). It only chooses WHICH fields a user action writes.
- Storage (Persist), transport (file capsules) and merge (Kit) stay separate. IndexedDB persistence and
  offline app loading (service worker) are separate concerns and share no code.
- Read path: `GuardedCollection.listResults()` is the single read path for rendering. `list()` is never
  used for rendering. `getResult(id)` is used only to read the CURRENT record immediately before a write.

Real signatures used (read from source):

```ts
// @ghostsync/kit
interface SchemaIdentity { readonly app: string; readonly schemaVersion: number; readonly entityType: string }
type Fields = Record<string, Scalar>;                       // Scalar = string | number | boolean | null
interface EntityAdapter<T> { readonly schema: SchemaIdentity; validate(e: T): void; toFields(e: T): Fields; fromFields(f: Fields): T }
type GetResult<T> =
  | { ok: true; entity: T } | { ok: false; reason: "absent" }
  | { ok: false; reason: "invalidRecord"; id: string; fields: Fields; cause: unknown };
// Collection<T>: put(id, entity) get getResult list listResults delete has
// @ghostsync/persist
openReplica(options: OpenOptions): Promise<PersistSession>
interface OpenOptions { app: string; documentId: string; replicaId?: string; dbName?: string; maxBytes?: number; onStateChange?: SaveStateListener }
type SaveState = "dirty" | "saving" | "saved" | "error";   // SaveStateInfo { sequence: number; error?: PersistenceError }
// PersistSession: identity{app,documentId,replicaId} restored state collection(adapter) exportState() exportBytes()
//   subscribe(listener) applyUpdate(carrier) flush() onStateChange(l) close() dispose()
// @ghostsync/capsule
encodeCapsule({ app, documentId, update: TransportUpdate | Uint8Array, createdAt? }): Promise<Uint8Array>
importCapsuleIntoPersisted(target, bytes, opts?): Promise<{ applied: true; persisted: boolean; metadata: CapsuleMetadata; saveError?: PersistLikeError }>
decodeCapsule(bytes, opts?): Promise<{ metadata: CapsuleMetadata; update: Uint8Array }>
// CapsuleMetadata { formatVersion: 1; app; documentId; updateByteLength; sha256; createdAt }
// CapsuleError.code: UnsupportedVersion Malformed AppIdentityMismatch DocumentIdentityMismatch OversizedRaw
//   OversizedDecoded ChecksumMismatch SdkRejection TargetUnavailable CryptoUnavailable
```

Kit behaviors the design depends on (read in `collection.ts`):

- `put(id, entity)` validates, then writes only leaf keys whose scalar value differs from the CURRENT
  LOCAL value, deletes leaf keys of fields the adapter omits (the `toDelete` loop over stored fields not in
  `toFields(entity)`), and writes nothing when nothing changed. A stale full entity can therefore still
  overwrite a newer local value (its changed fields win), and a stored field the adapter does not emit is
  removed by ANY put of that card. These are the stale-move hazard (section 13.3) and the unknown-field
  behavior (section 5.7).
- `getResult(id)` runs `adapter.fromFields(fields)` then `adapter.validate(entity)`; a throw from either
  becomes `invalidRecord` with the stored `fields`. Extra stored fields never cause that: PatchBoard's
  `fromFields` reads only the three known keys, so a card with extras is `ok`.
- Every collection operation rechecks the stored schema identity and throws an untyped
  `Error("GhostSync Kit: schema mismatch ...")` when it differs, including `listResults()`.
- `listResults()` returns every stored id with at least one live field, as `ok` or `invalidRecord`
  with the preserved `fields`; nothing is repaired or deleted.

## 2. Identity model

| Item | Value | Source of truth | Notes |
| --- | --- | --- | --- |
| App namespace | `patchboard` | `config.ts APP_ID` | passed as `OpenOptions.app` and `encodeCapsule.app` |
| Board ID | normalized user text | join form or `#/b/<id>` | IS the `documentId` for Kit, Persist and Capsule |
| Replica ID | UUID v4 text | `localStorage` `patchboard.replicaId.v1.<boardId>` | generated once per (profile, board); not the Yjs clientID |
| Card ID | `card-<UUID v4>` | `crypto.randomUUID()` at creation | collision-safe offline; independent of position, column, title |
| DB name | `patchboard` | `config.ts DB_NAME` | one IndexedDB database, store `replicas` (Persist) |
| Last board | board ID | `localStorage` `patchboard.lastBoardId.v1` | optional convenience |

Board ID rules (`identity/board-id.ts`, same rules as FieldLedger's document ID):

```ts
const BOARD_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
normalizeBoardId(raw: string): string            // trim, lowercase
validateBoardId(raw: string): { ok: true; boardId: string } | { ok: false; message: string }
parseRoute(hash: string): string | undefined     // "#/b/<encoded id>" -> valid normalized id or undefined
formatRoute(boardId: string): string             // "#/b/" + encodeURIComponent(boardId)
```

How two profiles join the same board: both users type the same board ID (or open the same
`#/b/<id>` link). Persist keys storage by `(app, documentId, replicaId)`. Each profile has its own
`localStorage`, so each generates its own replica ID; the two replicas start empty, are independent,
and become one board only through capsule exchange (the Kit merges them because they share a
`documentId` and `app`). A second tab of the SAME profile uses the same replica ID, so Persist's
exclusive Web Lock refuses it (`StorageInUseError`, AC-PB-003-1).

Replica ID store (`identity/replica-id.ts`), over an injected store so it is unit-testable:

```ts
interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
replicaStorageKey(boardId: string): string       // `patchboard.replicaId.v1.${boardId}`
getOrCreateReplicaId(store: KeyValueStore, boardId: string, randomUUID: () => string): string
// returns the stored value if it matches the lowercase UUID pattern, else creates, stores and returns a new one.
// Storage errors propagate to the caller (AC-PB-002-5).
```

Card IDs (`model/ids.ts`): `newCardId(randomUUID: () => string): string` returns `card-${randomUUID()}`.

## 3. Data model and adapter

Each card is its own record in ONE Kit collection. A record is a set of independent leaf fields; the
Kit merges per field. The board has no container record: the set of cards is the set of ids in the
collection, so concurrent adds never conflict and concurrent edits to different fields never conflict.

```ts
export const COLUMNS = ["todo", "doing", "done"] as const;
export type ColumnId = (typeof COLUMNS)[number];
export const COLUMN_LABEL: Record<ColumnId, string> = { todo: "To do", doing: "Doing", done: "Done" };

export interface Card {
  readonly title: string;      // 1..120 characters
  readonly notes: string;      // 0..2000 characters; "" when none
  readonly placement: string;  // "<column>|<8-digit position>", validated by the adapter
}
export const LIMITS = { title: 120, notes: 2000 } as const;
```

Adapter (`model/adapters.ts`), mirroring FieldLedger's strict `fromFields`:

```ts
export const cardAdapter: EntityAdapter<Card> = {
  schema: { app: "patchboard", entityType: "card", schemaVersion: 1 },
  validate(e: Card): void {
    bounded(e.title, "title", 1, LIMITS.title);       // TypeError on type or length
    bounded(e.notes, "notes", 0, LIMITS.notes);
    if (typeof e.placement !== "string" || parsePlacement(e.placement) === undefined) {
      throw new TypeError("placement is not valid");
    }
  },
  toFields(e: Card): Fields { return { title: e.title, notes: e.notes, placement: e.placement }; },
  fromFields(f: Fields): Card {                       // throws TypeError for a missing or non-string field
    return { title: str(f, "title"), notes: str(f, "notes"), placement: str(f, "placement") };
  },
};
```

Rules:

- Exactly three scalar string fields; no timestamp, no author, no order field other than `placement`.
  No wall-clock value is stored, so no behavior depends on clocks.
- `notes` is always present (`""` when empty) so that "notes missing" always means "incomplete record",
  never "no notes" (OD-2). A record missing any field is an `invalidRecord`.
- `fromFields` does not validate placement syntax; `getResult` runs `fromFields` and then `validate`, so
  a malformed placement string makes the card an `invalidRecord` with its fields preserved.
- Unknown extra fields are ignored on read (the card is valid) and deleted by any later `put` of that card
  (L-7, AC-PB-004-7, section 5.7). PatchBoard does not preserve, show or flag them.

## 4. Placement decision: one `placement` field

Decision: the column and the position are encoded in ONE scalar string field, `placement`, as
`<column>|<position>`, for example `doing|00001024`. Fixed format:

```
placement = column "|" position
column    = "todo" | "doing" | "done"
position  = 8 ASCII digits, 00000001 .. 99999999   (00000000 is invalid)
regex     = /^(todo|doing|done)\|(\d{8})$/
```

```ts
export const POSITION_MIN = 1;
export const POSITION_MAX = 99_999_999;
export interface ParsedPlacement { readonly column: ColumnId; readonly position: number }
formatPlacement(column: ColumnId, position: number): string   // throws RangeError outside 1..99_999_999 or non-integer
parsePlacement(value: string): ParsedPlacement | undefined    // undefined for anything not matching the regex or position 0
```

### 4.1 Why not two fields

The Kit merges per field. With separate `column` and `position` fields, one logical move is two
independent last-writer-wins decisions, and the Kit does not promise that both decisions come from the
same replica. Worse, the Kit's changed-fields `put` does not write a field whose value is unchanged,
so one replica can legitimately write only one of the two fields.

Concrete mixed outcome with two fields (X starts at `todo`, position 1024):

- A reorders X inside To do. A writes only `position` = 1536.
- B moves X to Doing, which is empty, so the new position is 1024, equal to the current one. The Kit
  writes only `column` = `doing`.
- After exchange: `column` = `doing` (from B) and `position` = 1536 (from A). Nobody chose
  `doing` at 1536. In a populated column the same pattern places the card at an arbitrary point, and
  can tie with another card.

With one `placement` field, every move and reorder writes the whole placement as one value, so the
Kit's single winner is one coherent (column, position) pair chosen by one user. There is one card
record in both models, so neither duplicates a card; the benefit is coherence, not deduplication.

| Option | Concurrent moves of one card | Cost | Verdict |
| --- | --- | --- | --- |
| A. One field `placement` (`doing\|00001024`) | One winner, one coherent placement | Fixed-width format and validation; parse needed to sort by number; a malformed string makes the card incomplete | CHOSEN |
| B. Two fields `column`, `position` | Can mix column from one replica and position from the other | Simple types, numeric sort without parsing | Rejected: incoherent merge |
| C. Two fields, always written together | Still not guaranteed to resolve from one replica; unchanged field is not written | Needs a promise the Kit does not make | Rejected |
| D. A per-column ordered list (CRDT array of IDs) | A card may appear in two lists | Not available through the Kit's `Collection`; needs Kit changes | Rejected: out of scope, can duplicate |

Honest tradeoffs of A:

- Sorting needs parsing. Because the position is fixed-width zero-padded, string order within one column
  equals numeric order. The app still parses to a number, and validates the format.
- Format validation is mandatory (`validate` rejects bad strings). Any malformed value, for example from a
  hand-made or damaged capsule, makes the card an `invalidRecord`. It is surfaced in the incomplete-card
  region (section 9) and repaired only by an explicit "Restore card: <label>", never silently.
- A concurrent reorder and a concurrent column move of the same card cannot both survive: one placement
  wins. The loser's intent for that card is lost. This is accepted and stated in the UI help text.
- Position range is 8 digits. With step 1024 that allows over 97,000 appends per column before the
  between-rule has to renormalize.

## 5. Operations and write sets

All write helpers live in `model/write.ts` and operate on this slice of the guarded collection:

```ts
interface WritableCards {
  put(id: string, entity: Card): void;
  getResult(id: string): GetResult<Card>;
  listResults(): ReadonlyArray<readonly [string, GetResult<Card>]>;
  delete(id: string): void;
}
type WriteOutcome = "ok" | "noop" | "absent" | "invalid";
```

Scope of every "written set" statement in this section and in section 13: it is about the SUPPORTED record
fields (`title`, `notes`, `placement`). "Exactly `{placement}`" means exactly that for a stored card that holds
only those three fields. A card that also holds unknown fields additionally loses them on any write
(section 5.7); the detector, which diffs RAW stored fields, then reports them too.

### 5.1 Read CURRENT, never the UI model (AC-PB-006-6)

Every helper that changes an existing card starts with `getResult(id)`:

- `absent` returns `"absent"` and writes nothing. `invalidRecord` returns `"invalid"` and writes nothing.
- `ok` yields the CURRENT stored card; the helper then calls `put(id, { ...current, <changed fields> })`.
  Because the base is the current stored card, every field not being changed carries its current stored
  value, which the Kit's changed-fields rule does not rewrite. A caller may therefore never pass the UI's
  cached card as the base.

### 5.2 Add

`addCard(cards, id, title, notes): WriteOutcome`

1. `position = nextPosition(positions of valid cards in "todo", sorted)` (from `listResults()`, valid only); if
   `undefined`, renormalize To do (section 5.4) and append at the end of the renormalized range.
2. `cards.put(id, { title, notes, placement: formatPlacement("todo", position) })`. This is a new record:
   the written set is `{title, notes, placement}`.

### 5.3 Edit title and notes (OD-10)

The edit form opens with a BASELINE `{ title, notes }` copied from the model when the user clicks "Edit
card". On "Save card" the view computes `changes` = the fields among `title`, `notes` whose draft differs
from the BASELINE (not from the current store). If `changes` is empty the form closes with no write.

`commitCardFields(cards, id, changes: { title?: string; notes?: string }): WriteOutcome` reads the current
card (5.1), then `put(id, { ...current, ...changes })`. Written set: exactly the touched fields; never
`placement`; an untouched field, even one that is stale in the form, keeps its current stored value
(AC-PB-006-2).

### 5.4 Move to a column and reorder; position computation; renormalization

Constants: `POSITION_STEP = 1024`.

```ts
positionBetween(lo: number | undefined, hi: number | undefined): number | undefined
// both undefined            -> 1024
// lo undefined, hi defined  -> c = hi - 1024 >= 1 ? hi - 1024 : floor(hi / 2);          valid iff 1 <= c < hi
// hi undefined, lo defined  -> c = lo + 1024 <= 99_999_999 ? lo + 1024 : ceil((lo + 99_999_999) / 2);  valid iff lo < c <= 99_999_999
// both defined              -> valid iff lo < hi; c = floor((lo + hi) / 2);              valid iff lo < c < hi
// returns undefined when no valid integer exists
nextPosition(sortedColumnPositions: ReadonlyArray<number>): number | undefined
// = positionBetween(last element or undefined, undefined)
renormalizeColumn(column: ColumnId, desired: ReadonlyArray<{ id: string; placement: string }>): Map<string, string>
// n = desired.length; step = min(1024, floor(99_999_999 / (n + 1)));
// card at index i gets formatPlacement(column, (i + 1) * step); the Map holds ONLY cards whose current
// placement string differs from the new one.
```

Literal cases for `positionBetween` (U-PB-06):

| lo | hi | result |
| --- | --- | --- |
| undefined | undefined | 1024 |
| undefined | 2048 | 1024 |
| undefined | 1024 | 512 |
| undefined | 2 | 1 |
| undefined | 1 | undefined |
| 2048 | undefined | 3072 |
| 99999000 | undefined | 99999500 |
| 99999999 | undefined | undefined |
| 1024 | 2048 | 1536 |
| 1 | 2 | undefined |
| 1 | 3 | 2 |
| 5 | 5 | undefined |
| 2048 | 1024 | undefined |

`moveCard(cards, id, column): WriteOutcome` (move to the END of a column, OD-1):

1. Read current card (5.1). If it is already in `column`, return `"noop"`.
2. `dest` = valid cards of `column` from `listResults()`, sorted (section 7). `p = nextPosition(dest positions)`.
3. If `p !== undefined`: `put(id, { ...current, placement: formatPlacement(column, p) })`. Written set:
   exactly `{placement}` of this one card.
4. Else renormalize: `desired = [...dest, movedCard]`; `writes = renormalizeColumn(column, desired)`; for
   each `[cid, placement]` apply `put(cid, { ...currentOf(cid), placement })` using the current stored card of
   `cid` (re-read with `getResult`). Each written set is exactly `{placement}` of that card.

`reorderCard(cards, id, delta: -1 | 1): WriteOutcome` (one step within the column):

1. Read current card (5.1) and its `(column, position)`. `sorted` = valid cards of that column, sorted.
   `from` = index of `id`; `to = from + delta`; if `to` is out of range return `"noop"`.
2. `desired` = `sorted` with the card removed and reinserted at `to`.
   `lo = position of desired[to - 1]`, `hi = position of desired[to + 1]` (undefined at the ends).
3. `c = positionBetween(lo, hi)`. If `c !== undefined`: `put(id, { ...current, placement: formatPlacement(column, c) })`.
   Written set: exactly `{placement}` of this one card.
4. Else renormalize `column` with `desired`: written set is exactly `{placement}` for each card whose position
   changed, and for no other card or field.

Hand-checkable renormalize fixture RN-FIX-1 (U-PB-08, P-PB-05). To do holds three cards with consecutive
positions, so no integer lies between them:

| id | placement before | title |
| --- | --- | --- |
| card-p1 | `todo\|00000001` | One |
| card-p2 | `todo\|00000002` | Two |
| card-p3 | `todo\|00000003` | Three |

"Move up: Three" gives `desired = [card-p1, card-p3, card-p2]`, `lo = 1`, `hi = 2`, `positionBetween(1, 2)`
is `undefined`, so the column is renormalized with `n = 3`, `step = 1024`. Expected writes, literally:

```
card-p1 -> "todo|00001024"
card-p3 -> "todo|00002048"
card-p2 -> "todo|00003072"
```

Each of the three writes has written set `["placement"]`; titles stay `One`, `Two`, `Three`. If card-p1 had
already been `todo|00001024` it would not appear in the Map and would not be written.

Two concurrent reorders that choose the same position for different cards produce equal positions; the
order is then decided by card ID (section 7). Renormalization is a rare, local, placement-only write
(limitation L-8).

### 5.5 Delete

`deleteCard(cards, id)` calls `cards.delete(id)` after the view's inline confirmation (OD-9): activating
"Delete card: <title>" reveals "Confirm delete: <title>" and "Keep card: <title>"; "Confirm delete: <title>" deletes. The Kit
removes all leaf keys in one local transaction. Delete is a hard delete (OD-4).

### 5.6 Restore and Discard

`restoreCard(cards, id, endPosition: () => number | undefined): WriteOutcome`:

1. `getResult(id)`. `ok` returns `"noop"` (already repaired). `absent` returns `"absent"`. Otherwise use the
   CURRENT `fields` from the result.
2. `title` = existing string of length 1..120 else `"Untitled card"`.
   `notes` = existing string of length 0..2000 else `""`.
   `placement` = existing value if it parses, else `formatPlacement("todo", endPosition())` (end of To do;
   renormalize To do first if `endPosition()` is undefined).
3. `put(id, { title, notes, placement })`. Fields with a valid stored value are unchanged, so the Kit does
   not write them. Fields with a missing or malformed value are replaced. Unknown extra fields are deleted by
   the Kit (L-7); the confirm text says so.

Discard is `cards.delete(id)` after inline confirmation: activating "Discard card: <label>" reveals "Confirm
discard: <label>" and "Keep incomplete card: <label>"; only "Confirm discard" deletes.

### 5.7 Unknown fields (L4, AC-PB-004-7)

What the real source does (read in `packages/kit/src/collection.ts` and the adapter above):

- `fromFields` ignores keys other than `title`, `notes`, `placement`, so a card with an extra stored field
  (say `legacy: "x"`) is an `ok` card, not an `invalidRecord`.
- `put` deletes every stored field of that id that `toFields` does not emit. So the next move, reorder, edit
  or Restore of that card removes `legacy`. The helpers build `{ ...current, <changed> }` from the adapter's
  `Card`, which has no slot for extras, so nothing carries them forward.

Chosen behavior (recommended, honest, smallest): PatchBoard does NOT preserve unknown fields. They are not
shown, not flagged, and are dropped by the first write to that card. Alternatives rejected for the MVP:
treat such a card as invalid (hides a working card and forces Restore for data PatchBoard never wrote),
or widen `Card` with an `extras` map so `toFields` re-emits them (a larger adapter contract that would let
foreign data persist through edits, and the Kit already rejects a NEWER schema version through the schema
mismatch error, so only same-version extras are affected). The restore confirmation text already says
unknown fields are removed; limitation L-7 says the same for move, reorder and edit.

Planned characterization test U-PB-22 `tests/unknown-fields.test.ts` (real Kit, raw fields via the probe
adapter): store `{ title: "Keep me", notes: "", placement: "todo|00001024", legacy: "x" }` through the probe
adapter. (a) `cards.getResult(id)` is `ok`. (b) After `moveCard(..., "doing")` the raw fields have no `legacy`
and `writtenFields(before, after)` is `["legacy","placement"]`. (c) The same fixture with `commitCardFields`
changing notes gives `["legacy","notes"]`. (d) `reorderCard` and `restoreCard` (on an invalid variant) also
drop `legacy`. The test documents the behavior; it does not claim it is desirable for newer data.

## 6. Merge analysis (what the Kit does with these writes)

Two replicas A and B diverge offline, then each imports the other's full-state capsule.

| Case | A | B | Converged result | Why |
| --- | --- | --- | --- | --- |
| Move vs edit | move X (writes `placement`) | edit X title and notes (writes `title`, `notes`) | X in the new column with the new title and notes | different leaf keys, no conflict |
| Same-card moves | move X to Doing | move X to Done | one placement, identical on both, equal to one of the two; one record | one key, one LWW winner; which one is not promised |
| Different-card moves | move Y | move Z | both moves kept | different records |
| Same-field edits | title "Alpha" | title "Beta" | exactly one of them | per-field LWW; not by clock time (help text) |
| Concurrent adds | add N1 | add N2 | both cards; equal placements ordered by card ID | different records |
| Delete vs edit existing field | delete X | edit X.title | CHARACTERIZED (section 12) | delete removes leaves; concurrent write may survive |
| Delete vs move | delete X | move X | CHARACTERIZED (section 12) | same mechanism on `placement` |
| Reorder vs move same card | reorder | move | one placement wins | one key; documented in help text |

The same-field and same-card cases are exactly where the Kit makes no wall-clock promise. The UI help
text (`merge-help`) says: "If two people change the same field of a card while offline, one of the two
values is kept after you exchange files. Which one is not decided by clock time. Changes to different
fields of a card, or to different cards, are both kept." It never says which side wins for delete cases.

## 7. Ordering

### 7.1 Rule

Within a column, valid cards sort by ascending numeric position, then by card ID in JavaScript code-unit
order (`a < b`, not `localeCompare`). The sort is independent of read order. Cards are grouped into
columns by the parsed `placement.column`. Invalid cards belong to no column (section 9).

```ts
interface Placed { readonly id: string; readonly card: Card; readonly column: ColumnId; readonly position: number }
toPlaced(entries: ReadonlyArray<readonly [string, Card]>): Placed[]       // parses placement (valid by adapter)
compareCards(a: Placed, b: Placed): number                                  // position asc, then id code-unit
sortPlaced(items: ReadonlyArray<Placed>): Placed[]                          // sorted copy
groupByColumn(items: ReadonlyArray<Placed>): Record<ColumnId, Placed[]>     // each list sorted
```

### 7.2 Fixture ORD-FIX-PB-1 (literal, in scrambled insertion order)

Board ID for browser use: `order-fixture`. Titles are chosen only for readability.

| Insertion order | card ID | placement | title |
| --- | --- | --- | --- |
| 1 | card-c3 | `doing\|00002048` | Write tests |
| 2 | card-f6 | `done\|00001024` | Ship v1 |
| 3 | card-a1 | `todo\|00002048` | Draft spec |
| 4 | card-B2 | `todo\|00002048` | Review spec |
| 5 | card-e5 | `todo\|00000512` | Collect notes |
| 6 | card-a | `todo\|00002048` | Plan sprint |
| 7 | card-d4 | `doing\|00001024` | Set up repo |
| 8 | card-b2 | `todo\|00002048` | Estimate work |
| 9 | card-g7 | `done\|00001024` | Tag release |
| 10 | card-h8 | `doing\|00002048` | Build UI |

Hand derivation (never computed with `compareCards`):

- To do: position 512 comes first: `card-e5`. Four cards tie at 2048, so compare the text after the common
  prefix `card-` in code-unit order: `B2` (U+0042) < `a` (U+0061), and `a` is a proper prefix of `a1`, so
  `a` < `a1`, and `a1` < `b2` (U+0062). Order: `card-e5`, `card-B2`, `card-a`, `card-a1`, `card-b2`.
- Doing: 1024 first: `card-d4`. Then 2048 ties between `card-c3` and `card-h8`: `c3` < `h8`.
  Order: `card-d4`, `card-c3`, `card-h8`.
- Done: both at 1024: `card-f6`, `card-g7` (`f6` < `g7`).

Literal expectations:

```ts
export const ORD_TODO_EXPECTED  = ["card-e5", "card-B2", "card-a", "card-a1", "card-b2"];
export const ORD_DOING_EXPECTED = ["card-d4", "card-c3", "card-h8"];
export const ORD_DONE_EXPECTED  = ["card-f6", "card-g7"];
```

Concurrent-insert case. Two replicas each append one card to To do with the same computed position
(`3072` = last position 2048 + 1024): `card-n2` titled "Concurrent B" and `card-n1` titled "Concurrent A", both
`todo|00003072`, delivered in the order n2 then n1. Literal To do expectation:

```ts
export const ORD_TODO_CONCURRENT_EXPECTED =
  ["card-e5", "card-B2", "card-a", "card-a1", "card-b2", "card-n1", "card-n2"];
```

`U-PB-07` asserts these through `groupByColumn`, for the scrambled order and for its reverse. `E2E-PB-09`
builds the fixture with a Node replica and the REAL card adapter, exports it as a capsule for board
`order-fixture`, imports it into a profile, and reads the rendered DOM order from `data-card-id`
attributes inside `[data-testid="column-todo"]`, `column-doing`, `column-done`, compared to the literals.
The test never calls `compareCards`, `sortPlaced` or any app helper to build an expectation.

## 8. Session, startup, autosave and errors

### 8.1 Startup (`session/session-controller.ts`)

Phases: `join | in-use | error | ready | recovery` (reflected as `html[data-session]`).

```ts
interface SessionDeps { openReplica: typeof openReplica }          // default: the real one; injected in unit tests
class SessionController {
  constructor(storage: Storage, notify: () => void, announce: (t: string) => void, deps?: SessionDeps);
  start(hash: string): Promise<void>;       // route, else remembered board, else join form
  open(raw: string): Promise<boolean>;
  refresh(): boolean;                        // re-read with listResults(); keeps the LAST GOOD model if it throws
  // edits (each wrapped in guard()):
  addCard(title: string, notes: string): void;           // "Enter a title." handled in the view-controller boundary
  saveCard(id: string, changes: { title?: string; notes?: string }): void;
  move(id: string, column: ColumnId): void;
  reorder(id: string, delta: -1 | 1): void;
  deleteCard(id: string): void;
  restoreInvalid(id: string): void;
  discardInvalid(id: string): void;
  retrySave(): Promise<void>; settle(): Promise<boolean>;
  buildCapsule(kind: "export" | "backup"): Promise<{ bytes: Uint8Array; filename: string } | undefined>;
  importFile(file: File): Promise<void>;
  changeBoard(): Promise<void>; discardAndSwitch(): Promise<void>; openJoin(): void;
  model: Model | undefined;                  // last good read model, `{ columns: Record<ColumnId, Placed[]>; invalid: InvalidRow[] }`
  revision: number;                          // +1 after every successful refresh; rendered as data-board-revision
}
```

The view calls exactly these methods (`move(cardId, column)`, `reorder(cardId, delta)`, `saveCard(cardId,
changes)`, ...) with a card ID and never a card object. The model helpers underneath are `moveCard`,
`reorderCard`, `commitCardFields` (section 5). Like FieldLedger's controller, the fields `phase`, `replicaId`,
`cards` and `model` are plain class members, so a unit test can fill them with a cast (FieldLedger's
`edit-error.test.ts` does this with its `Seams` interface) and drive `guard()` without a browser. This
is the only seam the planned controller tests (U-PB-17, U-PB-21) need: no production code is added for tests,
and `SessionDeps.openReplica` is not used by them. Because that route never calls `open()`, no
`session.subscribe` listener exists, so the controller's model is not refreshed behind the test's back.

`open(raw)`:

1. `validateBoardId(raw)`; invalid sets `joinMessage`, stays on `join`, writes nothing (AC-PB-001-2).
2. `getOrCreateReplicaId(localStorage, boardId, () => crypto.randomUUID())`; a thrown error shows the
   storage-blocked message, phase `error`, no session (AC-PB-002-5).
3. `openReplica({ app: "patchboard", documentId: boardId, replicaId, dbName: "patchboard", maxBytes: 8 * 1024 * 1024, onStateChange })`.
   A rejection maps by `PersistenceError.code` (8.3): `StorageInUseError` gives phase `in-use`, others `error`.
4. `cards = session.collection(cardAdapter)` and the first `readBoard(cards)` run inside one `try`. A thrown
   schema mismatch disposes the session and shows the schema message (AC-PB-003-6); any other throw shows
   the unexpected-error message and disposes.
5. Subscribe to `session.subscribe(() => this.refresh())`, remember the board, `history.replaceState` to
   `#/b/<boardId>`, clear import and edit-error views, phase `ready`.

### 8.2 Edits, `guard()`, refresh

`guard(fn)` mirrors FieldLedger: it runs `fn` only in phase `ready`. A throw sets
`editError = mapEditError(isSchemaMismatch(err) ? "schema-mismatch" : "unexpected")`, notifies, and
returns WITHOUT calling `refresh()`: a rejected `put` validates before it mutates, and on a schema
mismatch every collection operation (including `listResults()`) would throw the same error, so the last
good model is kept (AC-PB-009-4). A success clears `editError` and calls `refresh()`.

`refresh()` returns `false` when `readBoard` throws and keeps `this.model`; on success it replaces `this.model`
and increments `this.revision`. The view re-renders on every `notify()` but rebuilds the board's card DOM, and
increments `data-board-revision`, only from a successful read (section 9.3).

After a move or reorder the controller sets `focusRequest = { cardId: id }` and calls `announce(...)` with
the text from section 9.4 AFTER `refresh()` succeeded, so the position in the sentence comes from the
re-read board.

### 8.3 Autosave and save label

`onStateChange(state, info)` stores `{state, info}`; label from `state/save-label.ts`, the only source:

| state | label | symbol | live announce |
| --- | --- | --- | --- |
| `dirty` | Changes not yet saved | … | no |
| `saving` | Saving to this device... | ↻ | no |
| `saved`, `sequence > 0` | Saved locally | ✓ | yes |
| `saved`, `sequence = 0` | Nothing to save yet | – | no |
| `error` | NOT saved to this device | ⚠ | yes (role alert) |

A restored session shows "Nothing to save yet" until its first save because Persist does not expose the
restored sequence (FieldLedger deviation 4); that is honest, not a "saved" claim (AC-PB-008-4). The
indicator carries `data-save-state` (raw state) and `data-save-sequence`.
A `beforeunload` listener is registered only while the state is `error` (AC-PB-009-5).

### 8.4 Error mapping

Persist (open) errors, `mapPersistError(code)`:

| Code | Message (board wording) | Actions |
| --- | --- | --- |
| `StorageInUseError` | This board is already open in another tab or window on this device. Close the other one, then try again. | Try again |
| `UnsupportedEnvironmentError` | This browser cannot store data safely (Web Locks or IndexedDB are unavailable). Use a current Chrome, Edge, Firefox or Safari. | none |
| `StorageUnavailableError`, `DatabaseOpenError` | Browser storage is not available (private mode, blocked storage, or disk full). Check browser settings, then try again. | Try again |
| `BlockedError` | Another tab is blocking the database. Close other PatchBoard tabs, then try again. | Try again |
| `InvalidRecordError` | The saved data for this board on this device is damaged or does not match. Nothing was changed, and the damaged data was kept. PatchBoard cannot open or export it. Other boards are not affected: use "Open a different board". | Open a different board |
| `ClosedError` | This board was closed. Reload the page. | none |
| `CloseFailedError` | Could not save on close. Download a backup capsule, or discard unsaved changes and switch. | Download backup capsule |
| `QuotaExceededError`, `TransactionAbortError`, unknown | save-error copy below | Retry save, Download backup capsule |

Every `in-use` and `error` screen also shows a button "Open a different board" that calls `openJoin()` (as
FieldLedger's error screen does with a link; here a native `button`, so Enter and Space both work).

Save failures, `mapSaveError(code)`: quota gives "Not enough space, or the board is over the 8 MiB local limit. Download a backup capsule first. Then free browser storage or start a new board. Retrying will keep failing until space or size changes."; abort gives "The browser aborted the write. Retry save usually works."; anything else gives "The save failed. Try Retry save. If it keeps failing, download a backup capsule first."

Capsule errors, `mapCapsuleError(code, current, meta?)`, every message ends "Nothing was changed.":

| Code | Message |
| --- | --- |
| `DocumentIdentityMismatch` | This capsule is for a different board (<other, capped 80>). You have <open board> open. |
| `AppIdentityMismatch` | This capsule was made by a different app (<other, capped 80>), not PatchBoard. |
| `ChecksumMismatch` | This file looks damaged (its checksum does not match). Ask the sender to export it again. |
| `Malformed` | This is not a valid PatchBoard capsule file, or it is truncated. Ask the sender to export it again. |
| `UnsupportedVersion` | This capsule uses a newer or unknown capsule format version. Update PatchBoard or ask the sender to export with a compatible version. |
| `OversizedRaw` | This file is larger than the 16 MiB limit. |
| `OversizedDecoded` | The board data inside is larger than the 8 MiB limit. |
| `SdkRejection` | The sync engine rejected the data in this capsule. Ask the sender to export it again. |
| `TargetUnavailable` | This board is not open for editing right now. Reload the page. |
| `CryptoUnavailable` | This browser cannot verify capsules (secure crypto is unavailable). Use HTTPS or localhost. |
| `ReadFailed` | Could not read that file. |
| `TypeError` | Unexpected error. |

Edit errors, `mapEditError(kind)` (distinct from save and import):

- title for both kinds: "Your edit was NOT applied".
- `schema-mismatch`: "This device's PatchBoard version cannot edit data written with a newer schema. This board was created by an incompatible PatchBoard version. Nothing was changed. Reload the app to get the latest version. You can download a backup capsule first." Actions: Dismiss, Download backup capsule, Reload app (`location.reload()`, as FieldLedger).
- `unexpected`: "Something went wrong while applying your last edit, so it was not made. You can try the edit again, or reload the page. If it keeps happening, download a backup capsule first."

`isSchemaMismatch(err)`: `err instanceof Error && err.message.startsWith("GhostSync Kit: schema mismatch")`,
pinned by a unit test against the real Kit (L-9).

### 8.5 Recovery

- Applied but unsaved: see 11.2.
- `changeBoard()`: `session.close()` (flushes). Success returns to `join`. A `CloseFailedError` sets phase
  `recovery`: the board is still shown (read from the still-open in-memory collection), `recovery-panel` offers
  "Download backup capsule" and "Discard unsaved changes and switch". `discardAndSwitch()` calls `dispose()`,
  drops the session and shows `join`. Reopening shows the last saved state. `exportState()`/`exportBytes()`
  keep working in recovery; collection access is not re-opened in recovery (Persist rejects it).

## 9. UI contract

### 9.1 Selectors and data attributes (the only ones tests rely on)

| Where | Selector / attribute | Meaning |
| --- | --- | --- |
| `html` | `data-session` = `join` `in-use` `error` `ready` `recovery` | session phase |
| `html` | `data-offline-state` = `unsupported` `registering` `installing` `waiting` `ready` `failed`; `data-offline-ready` = `true` `false` | offline readiness |
| `main` | `data-board-id`, `data-replica-id` | open board and replica (in `ready`/`recovery`) |
| join form | label "Board ID", button "Open board", `#board-error` (`role=alert`), `#board-preview` | join |
| status | `[data-testid="network-chip"]` "Network: online/offline"; `[data-testid="transfer-mode"]` "Transfer: file (.gscap)"; `[data-testid="offline-indicator"]`; `[data-testid="first-visit-notice"]`; `[data-testid="update-banner"]` with "Update now" | device status |
| save | `[data-testid="save-indicator"]` with `data-save-state`, `data-save-sequence`; `[data-testid="announcer"]` (`role=status`, `aria-live=polite`, `aria-atomic=true`, visually hidden) | autosave and announcements |
| board | `[data-testid="board"]` with `data-board-revision` (integer, starts at 1, +1 each time the card DOM is rebuilt from a successful `refresh()`; a render marker added to the UI contract by correction 1, M2); `[data-testid="column-todo"]`, `column-doing`, `column-done` (each a `section` with `data-column` and an `h3`) | columns |
| card | `li[data-card-id]` with `data-column`, `data-placement`, `tabindex="-1"`, `aria-label="Card: <title>"`; `[data-testid="card-title"]`, `[data-testid="card-notes"]` | card |
| accessible-name scheme | ONE scheme (AC-PB-017-2): card-scoped controls are `<Action>: <card label>`; the label is the stored title of a valid card, and for an incomplete card the stored title if it is a non-empty string, else the card ID (capped at 80 code points). Plain names for non-card controls (listed in AC-PB-017-2). Native `button` elements only, so Enter and Space both activate | names |
| card buttons | `Move to To do: <title>`, `Move to Doing: <title>`, `Move to Done: <title>` (not shown for the current column), `Move up: <title>`, `Move down: <title>` (disabled at the ends), `Edit card: <title>`, `Delete card: <title>`; each with `data-action` = `move-todo` `move-doing` `move-done` `up` `down` `edit` `delete` | actions |
| add form | label "New card title" (`name="new-title"`), label "Notes (optional)" (`name="new-notes"`), button "Add card", `#add-error` | add |
| edit form | `form[data-testid="card-edit-form"]` with inputs `name="title"` (label "Title") and `name="notes"` (label "Notes"), buttons `Save card: <title>` and `Cancel edit: <title>` (title = the card's stored title at render time, not the draft) | edit |
| delete confirm | buttons `Confirm delete: <title>` and `Keep card: <title>` | delete |
| invalid | `[data-testid="invalid-cards"]`; rows `li[data-card-id][data-invalid="true"]` with the text "Conflicted or incomplete card", preserved fields as `key: value` lines, buttons `Restore card: <label>` and `Discard card: <label>`; after Discard, `Confirm discard: <label>` and `Keep incomplete card: <label>`. There is no button whose name is a bare "Restore" or "Discard" | incomplete cards |
| help | `[data-testid="merge-help"]` | honest merge help |
| transfer | button "Export capsule (.gscap)"; `[data-testid="import-input"]` (visible native file input with the label "Import capsule file (.gscap)", `accept=".gscap,application/vnd.ghostsync.capsule"`, normal 3 px focus ring, never `display:none`) | transfer |
| import result | `[data-testid="import-result"]` (`role=status`, `aria-live=polite`) with `data-import-state` = `importing` `applied-saved` `applied-unsaved` `rejected` and `data-import-code`; `import-meta-app`, `import-meta-document-id`, `import-meta-created-at`; `[data-testid="merge-summary"]`; `[data-testid="import-stale-notice"]` | import |
| alerts | `[data-testid="save-error-alert"]` (`role=alert`, `data-save-error-kind` = `import` `edit`, `data-save-error-code`); `[data-testid="edit-error-alert"]` (`role=alert`, `data-edit-error-kind`) with `edit-error-dismiss` ("Dismiss"), "Download backup capsule" and, for kind `schema-mismatch`, "Reload app"; `[data-testid="recovery-panel"]` (`role=alert`); `[data-testid="session-message"]` (`role=alert`) with "Try again" (when the mapped error allows it) and "Open a different board" | errors |
| leaving | `[data-testid="change-board"]` "Change board" | leaving |

### 9.2 Copy and states

- Offline copy (`offline/status-copy.ts`, adapted): `registering`/`installing` "Preparing offline use... Stay
  online until this says "Ready to work offline"."; `waiting` "A new version is ready. Save your work, then
  update."; `ready` "Ready to work offline."; `failed` "Offline use is not available: <reason>. You can keep
  working while online. Your edits still save to this device."; `unsupported` "Offline use is not available in
  this browser or context. PatchBoard needs HTTPS or localhost. Your edits still save to this device while the
  page is open." First-visit notice: "Opening PatchBoard offline for the very first time will not work. Open it
  once while online." shown whenever readiness is not `ready`.
- Transfer text: "Capsule files are integrity-checked (a checksum detects corruption). They are not
  authenticated: a checksum does not prove who sent a file."
- Import states: `importing` "Importing capsule..."; `applied-saved` "Capsule applied and saved locally.";
  `applied-unsaved` alert "Capsule applied, but NOT saved to this device" plus the loss warning "If you close or
  reload this page before the save succeeds, the imported changes and your newest edits are lost from this
  device. Download a backup capsule first."; after Retry save succeeds "Saved locally. The imported changes are
  now stored on this device."
- Stale notice (AC-PB-013-5): "The board could not be re-read after this import, so it is showing its last
  readable data. Reload the app, or download a backup capsule first." with "Download backup capsule".
- Incomplete-card region heading: "Conflicted or incomplete cards (N)". Row text: "Conflicted or incomplete
  card", then one line per preserved field `field: value` (textContent, long values capped at 200 characters in
  display only). Restore explainer: "Restore keeps every valid field, puts a missing or invalid placement at the
  end of To do, uses "Untitled card" for a missing or invalid title, and removes fields PatchBoard does not
  know." Nothing is auto-repaired and nothing is hidden.
- Merge summary lines (`model/diff.ts`, computed from the before and after boards read with `listResults()`):
  `Added: <title> in <Column>`, `Removed: <title>`, `Moved: <after title>, <Old column> to <New column>`,
  `Reordered: <title> in <Column>`, `Title changed: <old> to <new>`, `Notes changed: <title>`,
  `Now incomplete: <card id>`; "No changes" when empty. Suppressed when the post-import read failed.

### 9.3 Layout and focus

- Plain CSS in `src/styles.css`, same base as FieldLedger: `:focus-visible { outline: 3px solid #1a56db;
  outline-offset: 2px; }`, 16 px base font, `.alert` styling, `.sr-only`, reduced-motion rule.
- `#board` is a CSS grid: one column by default (columns stack; mobile first); three equal columns at
  `min-width: 48em`. Cards use `overflow-wrap: anywhere`. Controls wrap (`flex-wrap`). No fixed widths. No
  horizontal scrolling at 320 px (AC-PB-017-6).
- Card order in the DOM is the reading order in each column; buttons follow the title and notes.
- Draft preservation (AC-PB-006-8). The card list is rendered keyed by card ID. While a card's edit form
  is open, the view keeps that form's DOM node (its inputs, values, selection and focus) across refreshes:
  only the rest of that card's row and the other cards are updated from the new model. The form's baseline
  (`{title, notes}` at open time) is not changed by a refresh. If the card becomes absent or invalid after a
  refresh, the form stays open with the draft; "Save card" then writes nothing and shows the notice of
  AC-PB-006-6. The view never calls `focus()` on a refresh; focus changes only through `focusRequest` (9.4).
  A refresh that fails (`refresh()` returns `false`) does not rebuild anything and does not bump
  `data-board-revision`.

### 9.4 Announcements and focus after a move

`ui/announce.ts` (pure, unit tested as U-PB-19):

```ts
announceMove(title: string, column: ColumnId, position: number, total: number): string
// Moved "<title>" to <Column label>, position <position> of <total>.
announceReorder(title: string, direction: "up" | "down", column: ColumnId, position: number, total: number): string
// Moved "<title>" <up|down>, position <position> of <total> in <Column label>.
announceAdd(title, column, position, total) // Added "<title>" to <Column label>, position <n> of <m>.
announceDelete(title): string               // Deleted card "<title>".
shortTitle(title: string): string           // titles over 40 code points are cut to 39 plus "…"
```

Examples: `Moved "Alpha" to Doing, position 1 of 1.` and `Moved "Alpha" down, position 2 of 3 in To do.`
The text is written to `[data-testid="announcer"]` after the board re-render (clear first, then set, so
repeated identical messages are announced again).

Focus after a move or reorder (AC-PB-017-3): the controller exposes `focusRequest = { cardId, action }`.
After render the view focuses, in order: (1) the control with the same `data-action` on that card if it
exists and is enabled, (2) the card `li` itself (`tabindex="-1"`). The "Move to Doing" button disappears when
the card is already in Doing, so a column move normally ends on the card `li`; a reorder normally stays on
the same Up/Down button. After a delete, focus goes to the `h3` of the column the card was in
(`tabindex="-1"`). Opening the edit form moves focus to `input[name="title"]`. After an edit save or cancel, focus returns to that card's "Edit card" button. After
Restore, focus goes to the restored card; after Discard, to the incomplete-card region heading.

## 10. Offline assets

- Service worker generated at build time by `scripts/sw-precache-plugin.ts`, copied from
  `apps/fieldledger/scripts/sw-precache-plugin.ts` (itself adapted from the Persist plugin at `916165f`),
  with these changes only: `CACHE_PREFIX = "ghostsync-patchboard-"`, header and message text say PatchBoard,
  and a header comment records the source file and baseline `690cffd`. FieldLedger's own adaptation is kept:
  the fragment (`#/b/<id>`) is stripped from the navigation request URL before matching the cached shell, so a
  hash route reloads offline. No test-only failing worker is emitted.
- Cache name is `<CACHE_PREFIX><registration scope pathname>::<cacheVersion>` so two deployments of one build
  under different paths on one origin do not share caches. Install fetches every manifest entry with
  `cache: "reload"` and writes only after all succeed. No automatic `skipWaiting`; the worker handles
  `GHOSTSYNC_PRECACHE_STATUS` and `GHOSTSYNC_SKIP_WAITING` messages exactly as FieldLedger's.
- Tradeoff (FieldLedger decision D-2, accepted again): copying duplicates about 350 lines and risks drift.
  The alternatives were importing the Persist plugin by path (couples to its folder and its prefix, would
  need Persist changes) or extracting a shared helper package now (new package and dependency edge, changes
  in `packages/**`, outside this milestone). Extraction is a follow-up task.
- `offline/sw-register.ts` is a copy of FieldLedger's: `ready` ONLY when the worker is registered, active,
  controls the page AND the `GHOSTSYNC_PRECACHE_STATUS` round trip reports `complete`. A waiting worker keeps
  the state `waiting`. `applyUpdate()` posts `GHOSTSYNC_SKIP_WAITING` and reloads on `controllerchange`. It sets
  `html[data-offline-state]` and `html[data-offline-ready]`. "Update now" first calls `controller.settle()`
  (flush); if saving fails the error alert stays and the update does not proceed.
- Hosting contract: ROOT hosting only is required. Vite `base: "./"` makes every URL relative to the
  document; `./sw.js` is registered with `scope: "./"`. Sub-path hosting is optional (SHOULD) and has its own
  optional test.
- Honest readiness: first visit must be online; localhost or HTTPS only; an install failure leaves
  `data-offline-ready="false"` (state `failed`); registration alone never reports ready.
- Offline loading and IndexedDB persistence are separate: `offline/*` imports nothing from `session/*` or
  Persist, and the controller imports nothing from `offline/*`.

## 11. Transfer flows

### 11.1 Export

`buildCapsule(kind)`:

```ts
const bytes = await encodeCapsule({
  app: s.identity.app, documentId: s.identity.documentId, update: s.exportState(),
});
const filename = capsuleFilename(s.identity.documentId, s.identity.replicaId, new Date(), kind);
```

`capsuleFilename(boardId, replicaId, now, kind)` returns
`patchboard_<safe boardId>_<first 8 of safe replicaId>_<yyyymmddThhmmssZ>[_backup].gscap` where `safe` replaces
characters outside `[A-Za-z0-9._-]` with `_`. Literal unit case: board `sprint-board`, replica
`0a1b2c3d-1111-4222-8333-444455556666`, date `2026-03-04T05:06:07Z`, kind `export` gives
`patchboard_sprint-board_0a1b2c3d_20260304T050607Z.gscap`; kind `backup` gives
`patchboard_sprint-board_0a1b2c3d_20260304T050607Z_backup.gscap`.

`transfer/export.ts` `downloadBytes(bytes, filename, deps = { URLApi: URL, doc: document })` creates a `Blob`
(`application/vnd.ghostsync.capsule`), an object URL and an anchor, clicks it, then calls
`URLApi.revokeObjectURL(url)` (AC-PB-012-2). Both exports ("Export capsule (.gscap)" and the backup button)
use it.

### 11.2 Import

`importFile(file)` (mirrors FieldLedger):

1. Ignore if an import is `importing`. Set `importView = { state: "importing" }`.
2. `file.size > DEFAULT_MAX_CAPSULE_BYTES` (16 MiB) rejects as `OversizedRaw` BEFORE `file.arrayBuffer()`.
3. `bytes = new Uint8Array(await file.arrayBuffer())`; a read error rejects as `ReadFailed`.
4. `before = this.model`; `r = await importCapsuleIntoPersisted(session, bytes)`; `readable = this.refresh()`;
   `after = this.model`.
5. Diff only when `readable`: `diff = diffBoards(before, after)`; otherwise `workspaceStale: true` and no diff.
6. `r.persisted` true gives `applied-saved`; false gives `applied-unsaved` with `code = r.saveError?.code ??
   "Unknown"`. Both carry `metadata: r.metadata`, shown capped at 80 code points per value.
7. On a `CapsuleError` the identity codes are enriched by `decodeCapsule(bytes)` to name the other board or app,
   then `rejected` with `mapCapsuleError`. A non-capsule throw maps to `TypeError`.
8. `onSaveState`: when the state returns to `saved` and the import view is `applied-unsaved`, it becomes
   `applied-saved` with the retry message; the existing view is spread, so metadata and `workspaceStale`
   survive.
9. The view resets `input.value = ""` after each import so the same file can be chosen again.

`transfer/capsule-meta.ts`: `META_VALUE_MAX = 80`; `capMetaValue(value)` shows up to 80 code points, longer
values are cut to 79 plus "…"; `metaLines(metadata)` returns the three lines with the test IDs
`import-meta-app`, `import-meta-document-id`, `import-meta-created-at`. Text only.

### 11.3 No mutation on rejection

`importCapsuleIntoPersisted` decodes and checks identity before it calls `applyUpdate`, so a rejected capsule
never touches the session. The app adds no state mutation on the reject path. The planned tests check it with P1
(raw record `sequence` and `bytes` equal) and UI equality (section 13.5, E2E-PB-04).

## 12. Characterization procedures (Kit outcomes recorded BEFORE any wording promises a winner)

The Kit's behavior for a delete concurrent with an edit of an existing field is not specified by its
contract. The FieldLedger precedent (shape iii: `invalidRecord` on both replicas with the edited field
preserved, observed on a DIFFERENT entity, `checklistItem`) is only a hint. It MUST be re-observed for
PatchBoard's `card` adapter.

CH-PB-1 (delete vs edit), in `tests/kit-integration.test.ts`, with two real `createKit` replicas and the
real `cardAdapter`:

1. Replica A creates card Q (`title "Check valve"`, `notes "n"`, `todo|00001024`), exports; replica B imports it.
2. A deletes Q (`collection.delete`). B edits Q's EXISTING `title` through `commitCardFields`.
3. Exchange `exportState()` both ways via `applyUpdate`.
4. Assert (a) the decoded boards of A and B are deep-equal (`listResults()` with `cause` normalized to a
   constant), and (b) Q is in one of: SHAPE-ABSENT (absent on both); SHAPE-VALID (a valid card on both, equal);
   SHAPE-INVALID (`invalidRecord` on both with identical preserved `fields`).
5. Print the observed shape and the preserved fields to stdout and add it to the Playwright annotation. A result
   outside (a) and (b) is a Kit finding to REPORT, not to hide.

CH-PB-2 (delete vs move): identical, but B moves Q with `moveCard` (writes `placement`).

E2E-PB-06 and E2E-PB-07 repeat the same assertions in Chromium through the UI and the persisted state.

EVIDENCE NOTES (to be filled in by the implementer from real runs; do not describe a winner anywhere else
until these are filled in):

- CH-PB-1 observed shape: SHAPE-INVALID (`invalidRecord` on both replicas, identical). Recorded 2026-11-14, Kit
  at baseline `690cffd` (unchanged). Preserved fields: `{ title: "Check valve 2" }` (only the concurrently edited
  field). Same shape in Chromium (E2E-PB-06).
- CH-PB-2 observed shape: SHAPE-INVALID (`invalidRecord` on both replicas, identical). Recorded 2026-11-14, Kit
  at baseline `690cffd` (unchanged). Preserved fields: `{ placement: "doing|00001024" }` (only the concurrently
  moved field). Same shape in Chromium (E2E-PB-07).

After recording, product copy and the README may describe only the recorded shape ("a card that was deleted
on one device and changed on another may reappear as a Conflicted or incomplete card; use Restore card or
Discard card"), and only if a shape of that kind was observed.

## 13. Test strategy

### 13.1 Observation helpers

- P1 `storedState(page)`: read `indexedDB.open("patchboard")`, store `replicas`, `getAll()` in the page;
  expect exactly one record; decode `bytes` in Node with the real Kit (`createKit().createReplica(boardId, bytes)`)
  and the app adapters. The result is `{ record: { app, documentId, replicaId, sequence, checksum, savedAt, bytes },
  cards: Array<[id, GetResult<Card>]> sorted by id }` with each `cause` replaced by a constant.
- P2: P1 after `page.reload()`.
- P3 `decodeCapsuleFile(path)`: `decodeCapsule(readFileSync(path))`, then decode the update like P1.
- `readUiBoard(page)`: `{ todo: Array<{id,title,notes}>, doing: [...], done: [...], invalid: string[] }` from the
  DOM (`data-card-id`, `card-title`, `card-notes`), ordered as rendered.
- `probeAdapter`: `EntityAdapter<Fields>` with the card's SchemaIdentity, `validate` a no-op and
  `toFields`/`fromFields` copying the record. Used to read RAW stored fields (including for invalid cards) so
  write sets are observed independently of the card adapter.
- Test-side failure injection lives only in `e2e/helpers.ts` (`addInitScript`): a one-shot IndexedDB
  `readwrite` abort (`armWriteAbortOnce`), a sticky abort (`setWriteAbortSticky`, used to make `close()` fail),
  and a file-read gate. They are copied from FieldLedger's `e2e/helpers.ts`. No production code contains them
  (D-PB-01).
- Test-side offline-state recorder in `e2e/helpers.ts` (`recordOfflineStates`, `addInitScript`): a
  `MutationObserver` on `<html>` that appends every observed `data-offline-state` and `data-offline-ready`
  value to an in-page array that the test reads. It lives only in test code and observes; it changes nothing.
- Test-server controls (section 13.5, E2E-PB-11): `serverFailAsset(path)`, `serverRequestLog()`,
  `serverReset()` wrap the three test endpoints of `e2e/static-server.mjs`.
- Keyboard helper `press(page, locator, key)`: `await locator.focus()`, `expect(locator).toBeFocused()`, then ONE
  `page.keyboard.press(key)`. It never calls `click()`.

### 13.2 Unit and property inventory (Vitest, Node; none has run)

| ID | File | Covers |
| --- | --- | --- |
| U-PB-01 | `tests/board-id.test.ts` | normalize, validate, route parse and format |
| U-PB-02 | `tests/replica-id.test.ts` | stable reopen, distinct per board, malformed regenerated, throwing store |
| U-PB-03 | `tests/card-id.test.ts` | format, 10,000 unique IDs, no dependence on position or title |
| U-PB-04 | `tests/placement.test.ts` | format and parse literals, invalid list |
| U-PB-05 | `tests/adapter.test.ts` | schema identity, validate, toFields exact keys, fromFields strictness, extra keys |
| U-PB-06 | `tests/position.test.ts` | `positionBetween` literal table, `nextPosition`, `renormalizeColumn` |
| U-PB-07 | `tests/ordering.test.ts` | ORD-FIX-PB-1 literals, reversed input, concurrent insert |
| U-PB-08 | `tests/write-set.test.ts` | model-helper write sets (supported fields), stale model read-current, naive helper writer, renormalize |
| U-PB-09 | `tests/kit-integration.test.ts` | merge cases of section 6, CH-PB-1, CH-PB-2, partial-adapter invalid record, schema mismatch recognized |
| U-PB-10 | `tests/read-model.test.ts` | `readBoard` uses `listResults()` only, invalid rows, text rendering helper, `diffBoards` |
| U-PB-11 | `tests/restore.test.ts` | Restore fallbacks (literals), Discard |
| U-PB-12 | `tests/save-label.test.ts` | label table, "Saved locally" only for saved with sequence over 0 |
| U-PB-13 | `tests/errors.test.ts` | every `CapsuleErrorCode`, every `PersistenceErrorCode`, TypeError, ReadFailed, edit kinds, "Nothing was changed." |
| U-PB-14 | `tests/filename.test.ts` | literal filenames, `downloadBytes` revokes the URL once (fake `URL`) |
| U-PB-15 | `tests/capsule-meta.test.ts` | 80 and 81 code-point values, surrogate pairs, undefined |
| U-PB-16 | `tests/status-copy.test.ts` | offline copy per state, first-visit notice rule |
| U-PB-17 | `tests/edit-error.test.ts` | `guard()` with a throwing `put`; schema mismatch with a throwing `listResults`; add with an empty title |
| U-PB-18 | `tests/import-flow.test.ts` | import states, metadata for saved and unsaved, retry, stale workspace, oversize before read, one at a time, save error with no import view is kind `edit` |
| U-PB-19 | `tests/announce.test.ts` | literal announcements, `shortTitle`, focus target choice |
| U-PB-20 | `tests/session-open.test.ts` | controller with injected `openReplica`: arguments, error mapping, schema mismatch disposes, storage failure |
| U-PB-21 | `tests/controller-stale-move.test.ts` | PRODUCTION controller path: `controller.move`, `reorder`, `saveCard` with only a card ID while the rendered model is older than the store; negative control (section 13.3) |
| U-PB-22 | `tests/unknown-fields.test.ts` | characterization of unknown stored fields (section 5.7) |
| D-PB-01 | `tests/dist-scan.test.ts` (own config, run after build) | no test hooks in `dist` (including the strings `/__test/`, `fail-asset`, `request-log`), CSP present, relative URLs, no cross-origin URLs, no `packages/` imports |
| P-PB-01 | `tests/placement.property.test.ts` | format then parse round trip; every other string rejected |
| P-PB-02 | `tests/position.property.test.ts` | `positionBetween` returns an integer strictly between or `undefined` only when none exists |
| P-PB-03 | `tests/ordering.property.test.ts` | permutation invariance of `groupByColumn` |
| P-PB-04 | `tests/ordering.property.test.ts` | total order, tie broken by ID, each card in exactly one column |
| P-PB-05 | `tests/ordering.property.test.ts` | `renormalizeColumn` keeps relative order and the column, outputs only `placement` strings, all valid |
| P-PB-06 | `tests/kit-integration.property.test.ts` | convergence under delivery orders including duplicates |
| P-PB-07 | `tests/kit-integration.property.test.ts` | concurrent move and edit of the same card: both survive |
| P-PB-08 | `tests/kit-integration.property.test.ts` | concurrent moves of the same card: one record, one placement, equal to one submitted |

Shared helper `tests/batches.ts` and `tests/fc-report.ts` are copied from FieldLedger (not collected as
tests). Each property = four separately named 50-case batch tests (`... [batch n/4, seed S, 50 runs]`),
seeds 424242, 424243, 424244, 424245, `numRuns === 50` and `numSkips === 0` asserted per batch, an `afterAll`
total of 200 per property, replay details printed on failure by `fc-report.ts`
(`replay: seed=<seed> path=<path>`), bounded generators (arrays up to 16, positions in range), default 5 s
timeout, no overrides. 8 properties x 4 = 32 batch tests, 1600 generated cases. `vitest.setup.ts` keeps the
global `numRuns: 200, seed: 424242` as in FieldLedger; the batches override per call.

### 13.3 Stale-move detection design (REQ-PB-021)

The hazard: a UI model that is older than the stored record (for example the board could not be re-read
after an import, the stale-workspace case, or an import changed a card behind the view). If a move wrote the
WHOLE card from that stale snapshot, the Kit's changed-fields rule would write `title` and `notes` too (they
differ from the current store), and by last-writer-wins the stale values would overwrite the independent
edit. A move must therefore write only `placement` on top of the CURRENT stored card.

Detector (`tests/write-set.test.ts`):

```ts
// raw stored fields via the probe adapter, observed through the REAL Kit
function stored(replica: Replica, id: string): Fields | undefined;
// fields whose value differs, were added or were removed, sorted in code-unit order
function writtenFields(before: Fields, after: Fields): string[];
// the shared assertion every writer must pass
function assertStaleSafe(before: Fields, after: Fields, expected: string[], keep: Fields): void;
```

Helper-level fixture STALE-FIX-1 (U-PB-08). Honest scope: `moveCard(cards, id, column)` takes no snapshot, so this
fixture checks that the helper reads the CURRENT record and writes only `placement`; it never feeds a stale model
to production code. The production path is guarded by the controller test (13.3.1). Card `card-s1` with `{ title: "Original title", notes: "Original notes",
placement: "todo|00001024" }` in a real replica. Steps:

1. Read the board model M (the UI snapshot). `snapshot = M.todo[0].card`.
2. BEHIND the model, change the store directly: `collection.put("card-s1", { title: "Edited elsewhere",
   notes: "Notes edited elsewhere", placement: "todo|00001024" })`. Now the stored title and notes differ from M.
3. `before = stored(...)`. Run the real `moveCard(collection, "card-s1", "doing")` (it reads the current record).
4. `after = stored(...)`. Assert `writtenFields(before, after)` equals exactly `["placement"]`, the stored title is
   `"Edited elsewhere"`, notes `"Notes edited elsewhere"`, placement `"doing|00001024"` (Doing is empty).

Also (a1) for each of the three target columns and for reorder up and down: written set equals `["placement"]`;
(a2) a spy wraps `collection.put` and asserts the `title` and `notes` it receives equal the CURRENT stored
values, not the snapshot's.

Negative control (AC-PB-021-3), same file: a deliberately naive writer in the test fixture:

```ts
function naiveMove(c: WritableCards, snapshot: Card, id: string, column: ColumnId): void {
  c.put(id, { ...snapshot, placement: formatPlacement(column, 1024) });   // writes the whole card from a stale snapshot
}
```

Run through the same steps it yields `writtenFields === ["notes","placement","title"]` and a stored title of
`"Original title"`. The test asserts that `assertStaleSafe` THROWS for `naiveMove`
(`expect(() => assertStaleSafe(...)).toThrow()`) and that the detected set is that literal. If the detector or
the Kit stopped catching a whole-card stale write, this control would stop throwing and the test would fail:
that is how the planned control shows the detector can flag the bug it guards against (once it has run).

Stale edit form (AC-PB-021-4): STALE-FIX-2 with baseline `{ title: "Original title", notes: "Original notes" }`;
behind the form, the stored title becomes `"Edited elsewhere"`; the user changes notes only to `"My notes"`, so
`changes = { notes: "My notes" }`. Real `commitCardFields` gives written set `["notes"]`, stored title
`"Edited elsewhere"`. The naive form writer (`put(id, { title: baseline.title, notes: "My notes", placement })`)
gives `["notes","title"]` and is flagged the same way.

Renormalize (AC-PB-021-4): RN-FIX-1 gives written sets `["placement"]` for each of the three cards and no
`title` or `notes` change.

Honest limit: E2E-PB-01 (two profiles, concurrent move and edit) is planned to PASS even for a naive
writer when the move happens on a replica whose own store already matches its snapshot, because the Kit's
changed-fields rule does not rewrite unchanged fields. It therefore cannot detect a cached-card writer on its
own. Staleness inside one replica is hard to produce in Chromium without a production test hook, which is not
allowed (AC-PB-020-1). The stale guard is the controller-level test U-PB-21 (13.3.1), which exercises the
production controller path with a deliberately stale rendered model; U-PB-08 guards the helpers; E2E-PB-01 is
end-to-end coverage that both edits survive file exchange. Neither unit test has run yet.

### 13.3.1 Controller-level stale test (U-PB-21, PLANNED)

File `tests/controller-stale-move.test.ts`. It exercises the real `SessionController` methods the UI calls
(`move`, `reorder`, `saveCard`), each with only a card ID.

Seam (least invasive, used by FieldLedger's `edit-error.test.ts`): a real `createKit().createReplica("stale-board")`
gives two handles to ONE store, `a = r.collection(cardAdapter)` and `b = r.collection(cardAdapter)`. Handle `a`
is wrapped in a `Proxy` that records every `put(id, entity)` call and forwards everything else; the controller's
private slots are filled by cast (`phase = "ready"`, `replicaId`, `cards = wrapped a`,
`model = readBoard(wrapped a)`), exactly like FieldLedger's `Seams`. Production code needs NOTHING new: the
members are ordinary class members and `SessionDeps.openReplica` is not used. Handle `b` is the "someone else
edited" writer. Because `open()` is never called there is no `session.subscribe` listener, so nothing refreshes
the controller's model after `b` writes. That is what makes the model stale, deterministically.

Why not a throwing `listResults`: FieldLedger's other seam makes `listResults` throw after the first read so
`refresh()` keeps the last good model. PatchBoard's `moveCard` and `reorderCard` themselves read destination
positions with `listResults()` (5.4), so a throwing `listResults` would make the move fail instead of exposing
staleness. The no-subscribe seam keeps `listResults` and `getResult` live (they return CURRENT stored data) while
the controller's cached model stays OLD. The real-world cause (post-import re-read failure) is covered by
U-PB-18 and E2E-PB-14.

Fixture STALE-CTRL-1:

1. Via `a` (before wrapping): `card-s1` = `{ title: "Original title", notes: "Original notes", placement:
   "todo|00001024" }`, `card-s2` = `{ title: "Second", notes: "", placement: "todo|00002048" }`.
2. Build the controller and its model (cached card s1 = "Original title").
3. Via `b`: `put("card-s1", { title: "Edited elsewhere", notes: "Notes edited elsewhere", placement:
   "todo|00001024" })`.
4. PRECONDITIONS asserted (so the fixture cannot silently be fresh): `controller.model.columns.todo` card s1 has
   title `"Original title"`; `b.getResult("card-s1")` has title `"Edited elsewhere"`.
5. `before` = raw stored fields of s1 (probe adapter). Reset the put spy.

Cases (each from a fresh fixture):

- MOVE: `controller.move("card-s1", "doing")`. Assert raw stored `placement` is `"doing|00001024"`, `title` is
  `"Edited elsewhere"`, `notes` is `"Notes edited elsewhere"`, `writtenFields(before, after)` equals
  `["placement"]`, the spy saw exactly one `put` and its `title`/`notes` equal the NEWER values, `controller.editError`
  is `undefined`, and afterwards (guard's `refresh()` ran) the controller's model shows s1 in Doing with the newer
  title.
- REORDER: `controller.reorder("card-s1", 1)` (down). `desired = [s2, s1]`, `lo = 2048`, `hi` undefined, so
  `3072`. Assert stored placement `"todo|00003072"`, newer title and notes kept, written set `["placement"]`.
- SAVE: `controller.saveCard("card-s1", { notes: "My notes" })` (the view computed `changes` from its OLD baseline,
  so only notes is touched). Assert written set `["notes"]`, stored title still `"Edited elsewhere"`.

NEGATIVE CONTROL (same file, AC-PB-021-3): a helper in the test, not in production code:

```ts
function naiveControllerMove(c: SessionController, wrapped: WritableCards, id: string, column: ColumnId): void {
  const cached = c.model!.columns.todo.find((p) => p.id === id)!.card;        // the OLD card the UI holds
  wrapped.put(id, { ...cached, placement: formatPlacement(column, 1024) });  // a whole-card write from the cache
}
```

Run on the identical fixture it must give `writtenFields(before, after)` equal to `["notes","placement","title"]`,
a stored title of `"Original title"` (the independent edit is reverted), and `assertStaleSafe(...)` must THROW.
How the fixture makes a real regression fail: the controller's cached model is deliberately OLD and the store is
NEWER in `title` and `notes`. Any production code that took `title`/`notes` from `controller.model` (or from a card
object passed by the view) would call `put` with the OLD values; the Kit diffs against the CURRENT stored values,
which differ, so `title` and `notes` would enter the written set and the stored values would revert. The three
cases above would then fail on the written set, on the stored title and on the spy's `title`. The negative control
shows, with the same wrapper and detector, what that failure looks like. Neither the cases nor the control have
run yet; the implementer SHOULD also temporarily switch `move` to use the cached card once, observe the red test,
and record that in `docs/progress.md` (a manual check, not part of the suite).

### 13.4 Merge characterization and invalid-record tests (Node)

`tests/kit-integration.test.ts` uses real `createKit` replicas and the real adapters: move vs edit (both
survive), same-card moves (one placement, one record), different-card moves, same-field edits (one of the
two), concurrent adds with a tie, duplicate import, out-of-order import, CH-PB-1, CH-PB-2, a partial-adapter
record (placement only) becoming an `invalidRecord` with preserved fields, and the real schema-mismatch error
message recognized by `isSchemaMismatch`.

### 13.5 Playwright scenarios (real Chromium, two independent browser CONTEXTS = two profiles)

Config: `testDir ./e2e`, `timeout 30_000`, `expect.timeout 10_000`, `workers 1`, `retries 0`, project
`chromium`, base URL `http://localhost:4339`, `webServer: node e2e/static-server.mjs` with
`PATCHBOARD_PORT=4339`. It serves the BUILT `dist` at `/` and, for the optional test, at `/deploy-pb/`, and
has the test-only endpoints listed in 13.5.2 (`POST /__test/sw-bump`, `POST /__test/fail-asset`,
`GET /__test/request-log`, `POST /__test/reset`). Each profile is a separate `browser.newContext({ acceptDownloads: true })`
with `addInitScript(installTestHooks)`, so IndexedDB and `localStorage` are isolated. Every action is activated
once (E2E-PB-01 and E2E-PB-02 use pointer clicks; every other scenario uses the keyboard helper `press`) and the
observable result awaited; no click inside `expect.poll`, no retry loop. All scenarios are PLANNED; none has run. Screenshots
are attached after the assertions with `testInfo.attach` (1280x800 and 320 px).

Shared setup `offlineProfileOnBoard(browser, boardId)`: new context, `goto("/")`, await
`html[data-offline-ready="true"]`, `context.setOffline(true)`, `reload`, await ready again, join the board.

| ID | Scenario | UI observation | Persisted observation | Requirements |
| --- | --- | --- | --- | --- |
| E2E-PB-01 | PRIORITY: A moves a card while B edits it; real file exchange both ways; both reload offline | see below | see below | 001, 002, 006, 007, 011, 012, 013, 015, 021 |
| E2E-PB-02 | concurrent moves of the same card to different columns; different-card moves; same-field title edits | card X count is 1 per profile, same column, in `doing` or `done`; Y in `doing`, Z in `done`; titles equal; `merge-help` text | P1 deep-equal, one record, placement equals one submitted, titles equal one submitted | 007 |
| E2E-PB-03 | KEYBOARD-ONLY join, add, edit, save, cancel, move, reorder, delete with confirm and keep, export; focus and announcer checks (actions A-01 to A-11, design 13.5.1) | role-name queries (`exact: true`), `focus()` plus ONE `keyboard.press`, `activeElement.closest("[data-card-id]")`, announcer literals, `outlineWidth` `3px` | P1 placements equal the DOM order after each step; titles and notes unchanged by moves | 004, 005, 006, 017 |
| E2E-PB-04 | rejected imports: wrong board, wrong app (Node-built `fieldledger` capsule), truncated, byte-flipped, oversized (16 MiB + 1), version byte 2; plus reachability of the file input (A-12: `focus()`, `outlineWidth` `3px`, accessible name "Import capsule file (.gscap)"); the files are supplied with `setInputFiles`, the chooser dialog is NOT driven | `data-import-state="rejected"`, `data-import-code`, message text; `readUiBoard` and `save-indicator` unchanged | P1 `sequence` and `bytes` equal before and after each file | 013, 014, 017, 018 |
| E2E-PB-05 | save failure after import, Retry (keyboard), backup (keyboard), reload; edit-save failure; `beforeunload` guard | `applied-unsaved`, alert text and buttons, board readable, `focus()` on "Retry save" and one `Enter` then `saved`, metadata, alert gone; "Download backup capsule" by `Enter` gives a download event | setup flushed and asserted, then one-shot abort armed; during failure P1 equals the pre-import record; backup P3 holds merged cards; after Retry `sequence` increased; P2 after reload | 008, 009, 012, 013, 017, 020 |
| E2E-PB-06 | delete vs edit CHARACTERIZATION | boards identical on both; shape recorded | P1 deep-equal; shape in {absent, valid, invalidRecord with identical fields}; observed shape logged | 007 |
| E2E-PB-07 | delete vs move CHARACTERIZATION | same | same | 007 |
| E2E-PB-08 | invalid cards: render, Restore, Discard (all by keyboard); hostile text rendered as text; steps in the E2E-PB-08 paragraph below | `invalid-cards` region, row text and field lines, Restore result in a column, Discard sequence, no `img` created | before any action P1 raw fields equal the Node capsule's; after Restore stored literals; after Discard absent | 006, 016, 017, 018 |
| E2E-PB-09 | ordering fixture ORD-FIX-PB-1 and the concurrent-insert case | DOM order of `data-card-id` per column equals the literals | P1 placements equal the fixture; both concurrent inserts stored | 005, 007 |
| E2E-PB-10 | second tab of the same profile: StorageInUse, then "Try again" once by keyboard | `in-use` message and button; after release `focus()` on "Try again" and one `Enter` gives `ready` | P1 unchanged by the attempt | 003, 017 |
| E2E-PB-11 | honest offline readiness: (1) fresh profile offline fails; (2) failed precache via the TEST SERVER fixture never claims ready (13.5.2) | (1) `goto` rejects; `first-visit-notice` visible online. (2) request log shows the install fetch of the failing URL; recorded `data-offline-state` values never include `ready`; final `failed`, `data-offline-ready="false"`; app works online; offline reload rejects | (2) P1 after the online edit shows the card saved | 010 |
| E2E-PB-12 | update activation after settling, by keyboard | `waiting` banner; `focus()` on "Update now" and one `Enter`; `timeOrigin` changes; state `ready` | P1 decoded board identical before and after | 010, 017 |
| E2E-PB-13 | failed edit alert (121-character title set through the DOM past `maxlength`, rejected by the adapter); "Dismiss" by keyboard | `edit-error-alert` visible, workspace usable, `save-indicator` unchanged, no `save-error-alert`; `Enter` on "Dismiss" removes the alert | P1 `sequence` and `bytes` unchanged | 009, 017 |
| E2E-PB-14 | stale-workspace notice: import a Node-built newer-schema capsule so the post-import read throws; then a schema-mismatch edit error with "Reload app", then "Open a different board" (keyboard) | notice visible, no `merge-summary` and no "No changes", metadata shown, notice survives Retry; `edit-error-alert` kind `schema-mismatch` with "Reload app"; `Enter` on it reloads; the error screen offers "Open a different board"; `Enter` gives `join` | P1 includes the imported data | 009, 013, 017 |
| E2E-PB-15 | change board by keyboard; failed close (sticky abort) to recovery; "Download backup capsule" and "Discard unsaved changes and switch" by keyboard | `recovery-panel`, buttons, no join form; after `Enter` on Discard `join` | backup P3 holds the edit; reopening P1 shows the pre-edit `sequence` | 003, 009, 017 |
| E2E-PB-16 | layout at 320 x 640 and 1280 x 800, screenshots | `scrollWidth - clientWidth <= 0`; columns stacked at 320 | none | 017 |
| E2E-PB-17 | single profile: join validation, route, replica identity across offline reload, save labels, network chip, same-origin requests | `main[data-replica-id]` stable, `save-indicator` text, chip, request recorder, `caches.keys()` all start with `ghostsync-patchboard-` | P1 `replicaId` equal before and after; `readStoredRecords` empty after an invalid ID | 001, 002, 008, 010, 011, 018 |
| E2E-PB-19 | OPTIONAL: sub-path `/deploy-pb/` serves, becomes ready, reloads offline | `data-offline-ready="true"` under the sub-path | none | 010 (SHOULD) |
| E2E-PB-20 | a focused uncommitted draft survives an applied import and a refresh; committing it later keeps both edits after offline reload (13.5.3). (E2E-PB-18 is intentionally unused.) | same input element still focused with the draft; `data-board-revision` increased; card Y shows B's change; `import-result` `applied-saved` with metadata | P1 stored X title still old before commit; after keyboard `Save card: <title>` and offline reload both edits present in DOM and P2 | 006, 013, 017, 011 |

E2E-PB-01 steps (all after both profiles are offline-ready, offline, on board `sprint-board`):

1. A adds "Draft spec" (notes "Outline") and "Write tests"; await `saved` (`awaitSaved`). A exports `seed.gscap`.
2. B imports `seed.gscap` with `setInputFiles`; await `applied-saved`. Both boards are identical (deep-equal
   `readUiBoard`) and `main[data-replica-id]` differs between A and B.
3. Record X = `data-card-id` of "Draft spec" (same on both). P1 on both decode X in `todo`.
4. A clicks "Move to Doing: Draft spec" once; await X inside `column-doing` and `saved`. B (offline, no exchange)
   clicks "Edit card: Draft spec", fills title "Draft spec v2" and notes "Outline plus risks", clicks "Save card: Draft spec"
   once; await the new text and `saved`. P1 on A: X `doing`, title unchanged. P1 on B: X `todo`, new title and notes.
5. A exports `a2.gscap`, B exports `b2.gscap` (download events, `saveAs`). A imports `b2.gscap`, B imports `a2.gscap`
   (one `setInputFiles` each); await `applied-saved` on both.
6. On both: X inside `column-doing`, title "Draft spec v2", notes "Outline plus risks", "Write tests" unchanged;
   `readUiBoard(A)` deep-equals `readUiBoard(B)`. A's `merge-summary` contains "Title changed" and "Notes changed";
   B's contains "Moved: Draft spec v2, To do to Doing".
7. `expectImportMeta` on both: `import-meta-app`, `import-meta-document-id`, `import-meta-created-at` equal the
   Node-decoded metadata of the imported file.
8. P1 on both: X has `title "Draft spec v2"`, `notes "Outline plus risks"`, `placement` column `doing`; the decoded
   card lists of A and B deep-equal; each exported capsule P3 decodes to the same.
9. Duplicate import: A imports `b2.gscap` again once; `merge-summary` text "No changes"; P1 cards unchanged.
10. Both reload offline (`page.reload()` while offline): `data-offline-ready="true"`; `readUiBoard` deep-equals the
    pre-reload board and the other profile's; `main[data-replica-id]` unchanged; P2 deep-equals step 8.
11. After the assertions: attach screenshots of both profiles at 1280x800.

E2E-PB-05 order (matches FieldLedger's proven order): A and B join `sprint-board`, A adds "Pump valve" and
awaits `saved`, B adds "Replace gasket" and awaits `saved`; B exports `b.gscap`. FLUSH SETUP WRITES AND ASSERT:
P1 `record.sequence` equals `saveSequence(page)` and the stored titles equal `["Pump valve"]`. Only then
`armAbort(page)`, immediately before one `setInputFiles` of `b.gscap`. Assertions follow the table; the edit leg
arms the abort again after Retry's `saved` is asserted, makes one edit, and checks `data-save-error-kind="edit"`.

E2E-PB-04 file construction (Node, with the real Kit and Capsule; no import of FieldLedger code): wrong board =
`encodeCapsule({ app: "patchboard", documentId: "other-board", update })`; wrong app = `encodeCapsule({ app:
"fieldledger", documentId: <open board>, update })` built from a replica using a generic adapter (OD-6);
truncated = a valid capsule cut to half; byte-flipped = a valid capsule with one byte of the update region
changed; oversized = a file of 16 MiB + 1 bytes (written to the test output dir); unknown version = valid
capsule with byte 6 set to 2.

E2E-PB-08 fixture (PLANNED; board `invalid-board`; a Node replica with the `probe`-style partial adapter writes
four records, exported as a capsule and imported into an offline-ready profile with `setInputFiles`):

| card ID | stored fields | accessible-name label |
| --- | --- | --- |
| `card-ok1` | `title` "Valid card", `notes` "", `placement` `todo\|00001024` (valid; fixes the To do end position) | n/a (valid card) |
| `card-inv1` | only `placement` = `doing\|00001024` (title and notes missing) | `card-inv1` (no stored title, so the ID) |
| `card-inv2` | `title` "Bad placement", `notes` "", `placement` = `archive\|0001` (malformed) | `Bad placement` |
| `card-inv3` | only `title` = `<img src=x onerror=alert(1)>` (notes and placement missing; hostile text) | `<img src=x onerror=alert(1)>` |

Steps (every activation is `focus()` plus ONE `keyboard.press`, Enter unless stated; after each result the
`save-indicator` is awaited `saved`):

1. BEFORE any action: P1 raw fields of all four records equal the Node capsule's; the region heading reads
   "Conflicted or incomplete cards (3)"; `column-todo` holds only `card-ok1`, `column-doing` and `column-done` hold
   none; `document.querySelectorAll("img").length` is 0 and the hostile string is visible as text; each of these
   buttons resolves to exactly one element (`exact: true`): `Restore card: card-inv1`, `Discard card: card-inv1`,
   `Restore card: Bad placement`, `Discard card: Bad placement`, `Restore card: <img src=x onerror=alert(1)>`,
   `Discard card: <img src=x onerror=alert(1)>`; the bare names "Restore" and "Discard" resolve to 0 elements; the
   region contains no Move, Edit or Delete button.
2. RESTORE `card-inv1`: `Enter` on `Restore card: card-inv1`. Result: `li[data-card-id="card-inv1"]` is inside
   `column-doing` and not inside `invalid-cards`, has no `data-invalid`, `card-title` "Untitled card", notes empty,
   region heading now "(2)", `data-save-state`=`saved` with a larger `data-save-sequence`. P1: fields exactly
   `{title: "Untitled card", notes: "", placement: "doing|00001024"}`. Focus is on the restored card.
3. RESTORE `card-inv2`: `Enter` on `Restore card: Bad placement`. Result: `column-todo` DOM order is
   `["card-ok1", "card-inv2"]`, title "Bad placement" kept. P1: `{title: "Bad placement", notes: "", placement:
   "todo|00002048"}` (end of To do after `card-ok1` at `todo|00001024`), `saved`.
4. DISCARD `card-inv3`, in this order:
   a. `Enter` on `Discard card: <img src=x onerror=alert(1)>`. Result: that row now shows `Confirm discard:
      <img src=x onerror=alert(1)>` and `Keep incomplete card: <img src=x onerror=alert(1)>`. P1: `card-inv3` still stored,
      fields unchanged (nothing written yet).
   b. `Enter` on `Keep incomplete card: ...`. Result: the two confirm buttons are gone, the row is still in
      `invalid-cards`, P1 `card-inv3` unchanged, save sequence unchanged.
   c. `Enter` on `Discard card: ...` again, then `Space` on `Confirm discard: ...`. Result: the row is gone, the
      region reports no incomplete cards, focus is on the region heading. P1: `card-inv3` absent
      (`has("card-inv3")` false in the decoded state); `card-ok1`, `card-inv1`, `card-inv2` records equal their
      step 3 values; `saved`.
5. Offline reload: `readUiBoard` shows `todo: [card-ok1, card-inv2]`, `doing: [card-inv1]`, `invalid: []`; P2 equals
   the step 4c P1.

### 13.5.1 Action inventory and keyboard map (AC-PB-017-1)

Every user action in the UI, with the scenario step that activates it by keyboard and the observable RESULT
asserted (never only focus). "Enter" means `focus()` on the control (asserted focused) then one
`keyboard.press("Enter")`; "Space" is used where marked. All steps are PLANNED.

| ID | Action (accessible name) | Scenario and step | Observable result asserted |
| --- | --- | --- | --- |
| A-01 | `Open board` (join form) | E2E-PB-03 step 1, Enter | `html[data-session]`=`ready`, `main[data-board-id]`=`kb-board`; P1 record `documentId` `kb-board` |
| A-02 | `Add card` | E2E-PB-03 step 2, Enter | card in `column-todo`, announcer `Added "Alpha" to To do, position 1 of 1.`, `saved`; P1 `todo\|00001024` |
| A-03 | `Edit card: <title>` | E2E-PB-03 step 3, Enter | `card-edit-form` visible, `input[name="title"]` is `document.activeElement` |
| A-04 | `Save card: <title>` | E2E-PB-03 step 3, Enter; E2E-PB-20 step 8 | form closed, new title shown, `saved`, focus on `Edit card: <new title>`; P1 only `title` changed |
| A-05 | `Cancel edit: <title>` | E2E-PB-03 step 4, Enter | form closed, title unchanged, P1 and `data-save-sequence` unchanged, focus on `Edit card` |
| A-06 | `Move to To do` / `Doing` / `Done: <title>` | E2E-PB-03 step 5, Enter | card inside the target column, announcer `Moved "Alpha v2" to Doing, position 1 of 1.`, focus inside the card; P1 `doing\|00001024`, title and notes unchanged |
| A-07 | `Move up` / `Move down: <title>` | E2E-PB-03 step 6, Enter for down, Space for up | DOM order changes, announcer literal, focus on the same control; P1 literals `todo\|00004096` then `todo\|00002048` |
| A-08 | `Delete card: <title>` | E2E-PB-03 steps 7 and 8, Enter | `Confirm delete: <title>` and `Keep card: <title>` appear; nothing stored yet |
| A-09 | `Confirm delete: <title>` | E2E-PB-03 step 8, Space | `li[data-card-id]` gone, announcer `Deleted card "Gamma".`, focus on the column `h3`; P1 record absent |
| A-10 | `Keep card: <title>` | E2E-PB-03 step 7, Enter | confirm row gone, card still there, P1 record present and unchanged |
| A-11 | `Export capsule (.gscap)` | E2E-PB-03 step 9, Enter with `waitForEvent("download")` | download filename matches `^patchboard_kb-board_[0-9a-f]{8}_\d{8}T\d{6}Z\.gscap$`; P3 decoded cards equal P1 |
| A-12 | file input `Import capsule file (.gscap)` | E2E-PB-04 step 0 | REACHABILITY ASSERTED, CHOOSER DIALOG NOT DRIVEN: `focus()`, `toBeFocused`, `outlineWidth` `3px`, role and name resolve to one `input[type=file]`. The import itself uses `setInputFiles` (Playwright's automation for the chooser) |
| A-13 | `Retry save` | E2E-PB-05 step, Enter | `data-save-state`=`saved`, import result `applied-saved`, alert gone, metadata unchanged; P1 `sequence` larger |
| A-14 | `Download backup capsule` | E2E-PB-05 (save-error alert) and E2E-PB-15 (recovery panel), Enter with download event | filename ends `_backup.gscap`; P3 decodes with the merged cards (E2E-PB-05) or with the unsaved edit (E2E-PB-15) |
| A-15 | `Dismiss` (edit-error alert) | E2E-PB-13, Enter | `edit-error-alert` count 0, `html[data-session]`=`ready`, board still rendered |
| A-16 | `Reload app` (edit-error alert, kind `schema-mismatch`) | E2E-PB-14, Enter | `performance.timeOrigin` changes (page reloaded); the board no longer opens: `html[data-session]`=`error` with the schema message |
| A-17 | `Update now` | E2E-PB-12, Enter | `performance.timeOrigin` changes, `data-offline-state`=`ready`, no waiting worker, `data-session`=`ready`; P1 board identical to before |
| A-18 | `Try again` (in-use screen) | E2E-PB-10, Enter | `html[data-session]`=`ready`, `main[data-board-id]` equals the board; P1 unchanged by the attempt |
| A-19 | `Open a different board` (error screen) | E2E-PB-14, Enter (after A-16) | `html[data-session]`=`join` and the join form is visible; P1 unchanged |
| A-20 | `Change board` | E2E-PB-15 leg 1, Enter | `html[data-session]`=`join`, no `main[data-board-id]`, previous board closed (reopening the same ID later reaches `ready`, not `in-use`); P1 `sequence` equals the last shown |
| A-21 | `Discard unsaved changes and switch` | E2E-PB-15 leg 2, Enter | `html[data-session]`=`join`; reopening shows the pre-edit board and `sequence`; P1 lacks the edit |
| A-22 | `Restore card: <label>` | E2E-PB-08 steps 2 and 3, Enter | invalid row becomes a normal card in the documented column with the documented fallback values, `saved`; P1 literals |
| A-23 | `Discard card: <label>`, `Confirm discard: <label>` (Space), `Keep incomplete card: <label>` | E2E-PB-08 step 4 a to c | Discard reveals the confirm pair without writing; Keep leaves row and record; Confirm removes the row and the record |

Any action not in this table does not exist in the UI. E2E-PB-01 and E2E-PB-02 use pointer clicks for the same
controls; they are not the keyboard evidence.

### 13.5.2 E2E-PB-03 steps, and the failed-precache test-server fixture

E2E-PB-03 steps (board `kb-board`, fresh offline-ready profile; text entry uses `fill`, every control activation
uses `press`): 1 join (A-01); 2 add Alpha, Beta, Gamma (A-02; positions `1024`, `2048`, `3072`); 3 `Edit card:
Alpha`, fill title "Alpha v2", `Save card: Alpha` (A-03, A-04); 4 edit Alpha v2, fill a draft, `Cancel edit: Alpha
v2` (A-05); 5 `Move to Doing: Alpha v2` (A-06); 6 `Move down: Beta` by Enter gives order Gamma, Beta with Beta
`todo|00004096`, then `Move up: Beta` by Space gives Beta, Gamma with Beta `todo|00002048` (A-07); 7 `Delete card:
Gamma`, `Keep card: Gamma` (A-08, A-10); 8 `Delete card: Gamma`, `Confirm delete: Gamma` by Space (A-08, A-09);
9 export by Enter with a download event (A-11). After each step: announcer literal, focus not on `body`,
`outlineWidth` `3px` on the focused control, P1 placements equal the DOM order, titles and notes unchanged by moves.

13.5.2 Test-server fixture for AC-PB-010-3 (M3). `apps/patchboard/e2e/static-server.mjs` (the PatchBoard copy of
FieldLedger's `e2e/static-server.mjs`; test infrastructure, never shipped, never in `dist`) gets three test-only
endpoints next to the existing `POST /__test/sw-bump`:

- `POST /__test/fail-asset?path=<relative url>&skip=<n>` (default `skip=1`): after that call, for requests to that
  one path, the first `n` are served normally and every later one answers HTTP 404 with the body `not found`.
  `skip=1` lets the PAGE's own first load of the asset succeed (so the app boots and works online) while the
  worker's install-time fetch of the same URL fails.
- `GET /__test/request-log`: JSON array in arrival order of `{ n, method, path, status, cacheControl }` for EVERY
  request the server received (`cacheControl` = the request's `Cache-Control` header, for the record only).
- `POST /__test/reset`: clears the failure rule and the log. Called at the start and end of the test; `workers`
  is 1 so state cannot leak.

The failure mechanism lives ONLY there. It uses no `context.route` (Playwright may not intercept requests made
inside a service worker, and this repo has no precedent that it does), no production hook and no test-only worker.
The built worker is the real one from the real build.

E2E-PB-11 steps:

1. Leg 1 (first visit offline fails): unchanged from FieldLedger E2E-FL-10 (fresh context, `setOffline(true)`,
   `goto("/")` rejects; back online, `first-visit-notice` visible, then ready).
2. Leg 2 (failed precache): read `dist/precache-manifest.json` in Node; pick the first `entries[].url` that matches
   `^assets/.+\.css$` (the stylesheet is not needed for the app to run; the test fails with a clear message if there
   is none). `serverReset()`, then `serverFailAsset(url, 1)`.
3. Create a FRESH browser context (new profile, no prior service worker or caches) with `recordOfflineStates`
   installed, `goto("/")` online.
4. Bounded wait: `expect(html).toHaveAttribute("data-offline-state", "failed")` (default 10 s expect timeout).
   Then assert `data-offline-ready`=`false`. Read the recorded values: they never contain `ready` and the ready
   attribute was never `true` at any observed point. `offline-indicator` shows the `failed` copy and does not
   contain "Ready to work offline."; `first-visit-notice` is visible.
5. (a) `serverRequestLog()`: there is an entry whose `path` is the failing URL with `status` 404, and it comes after
   an entry for `/sw.js` (the install fetch ran, so the failure was exercised and not skipped). The first entry for
   that path has status 200 (the page's own load). The recorded `cacheControl` of the 404 entry is attached to the
   test report as an annotation, not asserted.
6. (b) In the page: `navigator.serviceWorker.controller` is `null`; every cache whose name starts with
   `ghostsync-patchboard-` has zero entries (`caches.keys()` then `cache.keys()`). The app still works online:
   join `fail-board`, add a card, await `saved`; P1 shows the card.
7. (c) `context.setOffline(true)`, then `page.reload()` rejects with a navigation error: the fresh profile does not
   boot offline from a half-installed cache (the server also answers `cache-control: no-cache`, so no HTTP-cache
   copy is used). Not covered here: a profile that already had a ready version, where the old worker keeps
   serving; that is a documented follow-up, not a claim.
8. `serverReset()`, close the context.

### 13.5.3 E2E-PB-20: a focused draft survives an applied import and refresh (AC-PB-006-8)

Profile A and profile B are separate `browser.newContext` profiles, both offline-ready, offline, on board
`draft-board`. Card IDs stay stable because B's baseline is A's exported capsule (same mechanism as E2E-PB-01
step 2). Profile B's capsule is a REAL export from B's UI (download event), not Node-built.

1. Setup, flushed: A adds X "Draft spec" (notes "Outline") and Y "Write tests"; await `saved`; A exports `seed.gscap`;
   B imports it with `setInputFiles`, await `applied-saved`. Record X and Y IDs from `data-card-id` (equal on both).
   A and B `readUiBoard` equal. P1 on A: X `{title: "Draft spec", notes: "Outline", placement: "todo|00001024"}`,
   Y `{title: "Write tests", notes: "", placement: "todo|00002048"}`. Record `S0` = A's `data-save-sequence`.
2. B changes Y independently: `Enter` on `Edit card: Write tests`, fill title "Write tests v2", `Enter` on `Save card:
   Write tests`; await `saved`. B exports `b-y.gscap` (`Enter` on "Export capsule (.gscap)", download event, `saveAs`).
   P3 of `b-y.gscap`: Y title "Write tests v2", X title "Draft spec".
3. On A: `Enter` on `Edit card: Draft spec`; the title input is focused and holds "Draft spec". Type the draft
   WITHOUT committing: `keyboard.press("End")` then `keyboard.type(" WIP")`. Value is "Draft spec WIP", caret
   `selectionStart === selectionEnd === 14`. Keep an `ElementHandle` `editor` to that input. Record
   `rev0 = data-board-revision`. Assert `data-save-state`=`saved` and `data-save-sequence` still `S0` (typing a draft
   did not change the save state), and P1 X title is still "Draft spec".
4. Import `b-y.gscap` into A with `setInputFiles` on `import-input` (this does not move focus; step 3's focus is
   asserted again, not assumed). Await `import-result` `data-import-state`=`applied-saved`.
5. Assertions on A, in this order:
   1. FOCUS PRESERVED: `page.evaluate((el) => el === document.activeElement, editor)` is true, `editor.isConnected`
      is true (the same DOM node survived), its value is "Draft spec WIP" and caret `14`.
   2. THE REFRESH HAPPENED: `data-board-revision` is greater than `rev0`; card Y in `column-todo` shows
      "Write tests v2"; `merge-summary` contains "Title changed: Write tests to Write tests v2"; `expectImportMeta`
      equals the Node-decoded metadata of `b-y.gscap`; `data-save-sequence` is greater than `S0` (the import was
      saved, not the draft).
   3. DRAFT VISIBLE AND UNCOMMITTED: the `input[name="title"]` still shows "Draft spec WIP", the form is still open,
      the card X heading still shows the stored "Draft spec", and P1 X title is still "Draft spec" with notes
      "Outline" and placement `todo|00001024`.
6. COMMIT: `focus()` on `Save card: Draft spec` (the label is the stored title), ONE `keyboard.press("Enter")`
   (A-04). Await `data-save-state`=`saved` with a sequence larger than the one after the import. P1: X title
   "Draft spec WIP", notes "Outline", placement unchanged (written set `["title"]`); Y title "Write tests v2".
7. `context.setOffline(true)` is already in effect; `page.reload()`. Await `data-offline-ready`=`true` and
   `data-session`=`ready`. DOM: X "Draft spec WIP", Y "Write tests v2"; `readUiBoard` equal before and after the
   reload. P2 (decoded stored record): both edits present and X, Y placements unchanged; `main[data-replica-id]`
   unchanged.

### 13.6 Notes on observability and downgrades

- AC-PB-010-4 (localhost/HTTPS only): downgraded to SHOULD; unit test of the `unsupported` copy only.
- AC-PB-018-4 (no secrets in artifacts): downgraded to SHOULD; verified by review.
- AC-PB-007-7 (no premature winner wording): verified by a `git grep` review step, not a browser test.
- The first-visit offline failure (E2E-PB-11) asserts the browser's own navigation failure, not an app message,
  because no app is loaded.

## 14. Decisions

| ID | Decision | Alternatives | Rationale |
| --- | --- | --- | --- |
| D-1 | Plain TypeScript with a small `h()` helper (copy of FieldLedger's `ui/h.ts`) | Preact or another framework | Keeps the dependency graph minimal (coding steering), no new version to verify, views are small, same pattern as FieldLedger |
| D-2 | Copy and adapt the FieldLedger SW plugin | Import by path; shared helper now | Section 10 |
| D-3 | One `placement` field | Two fields | Section 4 |
| D-4 | Hard delete with explicit repair UI | Soft-delete flag | Exercises the real Kit contract, no permanent tombstone; delete-vs-edit is characterized |
| D-5 | Integer positions with step 1024, midpoint, renormalize | Fractional strings | Number is dependency free; fixed 8 digits keep string and numeric order equal |
| D-6 | `notes` always stored as `""` when empty | Omit the field | Keeps "missing field" equal to "incomplete record" |
| D-7 | Move lands at the END of the destination column | Keep nearest position | Predictable, one write, no neighbour dependence |
| D-8 | Explicit "Save card" writing touched fields only | Commit on blur | Avoids committing a stale baseline for untouched fields |
| D-9 | Inline two-step delete confirmation | Browser `confirm()` | Keyboard friendly and testable without dialog handling |
| D-10 | Wrong-app test file is Node-built | Capture from FieldLedger UI | No coupling between apps; FieldLedger-built remains an optional extra |
| D-11 | Controller takes optional `deps.openReplica` | Mock modules | Plain constructor injection, no test framework mocking of ESM |
| D-12 | Port 4339 for the PatchBoard static server | reuse 4329 | FieldLedger uses 4329 and Persist 4319; a distinct port lets suites run side by side |
| D-13 | Unknown stored fields are dropped by any write and documented (5.7, L-7) | Preserve through an `extras` map; treat as invalid | Smallest adapter contract; matches the Kit's real `put`; newer schema versions are blocked by the schema mismatch error anyway |
| D-14 | Failed-precache scenario uses a test-server 404 fixture (13.5.2) | `context.route` | Service-worker-initiated requests may not be routable by the test context; the server sees what the worker really requests and can log it |
| D-15 | Controller stale test fills the controller's members by cast, no subscribe, no production seam (13.3.1) | A throwing `listResults`; an injectable collection factory | `moveCard` reads `listResults()` itself, so throwing there would fail the move instead of exposing staleness |
| D-16 | `data-board-revision` render marker on the board | Infer the refresh from text alone | A refresh that changes no visible text would otherwise be unobservable |

## 15. Packaging and build

`apps/patchboard` consumes the BUILT public entries of the three packages through workspace dependencies. No
path alias, no import from another package's `src`. Build order: kit, then capsule, then persist, then
patchboard (capsule and persist depend on the built Kit types).

`apps/patchboard/package.json` (replaces the scaffold file):

```json
{
  "name": "@ghostsync/patchboard",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "description": "PatchBoard: offline kanban board built on GhostSync Kit.",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "build": "vite build",
    "test:dist": "vitest run --config vitest.dist.config.ts",
    "preview": "vite preview --port 4339 --strictPort",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@ghostsync/capsule": "workspace:*",
    "@ghostsync/kit": "workspace:*",
    "@ghostsync/persist": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "1.65.0",
    "@types/node": "24.19.2",
    "fast-check": "4.10.2",
    "typescript": "7.0.2",
    "vite": "8.3.6",
    "vitest": "5.1.0"
  }
}
```

These are exactly FieldLedger's pins (verified in `apps/fieldledger/package.json`). The workspace dependencies
are `workspace:*`. Lockfile consequence: the first `pnpm.cmd install` adds an `apps/patchboard` importer to
`pnpm-lock.yaml` and nothing else (inspect with `git diff --stat -- pnpm-lock.yaml`), then
`pnpm.cmd install --frozen-lockfile` must succeed. Use only `pnpm@10.34.9` (root `packageManager`); no other
lockfile.

Files to create under `apps/patchboard/` (everything outside `apps/patchboard` and `pnpm-lock.yaml` stays
untouched):

```
package.json            (rewrite as above)
tsconfig.json           (copy of FieldLedger's: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
                         module ESNext, moduleResolution Bundler, target ES2022, lib ES2022 + DOM, types node and
                         vite/client, noEmit, verbatimModuleSyntax; include src, tests, e2e, scripts, configs)
vite.config.ts          (root = app dir, base "./", build.outDir dist, target es2022, plugin swPrecachePlugin())
vitest.config.ts        (node env, include tests/**/*.test.ts, exclude tests/dist-scan.test.ts, setup file)
vitest.dist.config.ts   (include tests/dist-scan.test.ts)
vitest.setup.ts         (fc.configureGlobal({ numRuns: 200, seed: 424242 }))
playwright.config.ts    (port 4339, see 13.5)
index.html              (CSP meta, lang en, #app, module script ./src/main.ts, title PatchBoard)
README.md               (build order, run, offline limits, file transfer, integrity vs authentication, out of scope)
scripts/sw-precache-plugin.ts
src/main.ts  src/config.ts  src/styles.css
src/identity/board-id.ts  src/identity/replica-id.ts
src/model/adapters.ts  src/model/placement.ts  src/model/position.ts  src/model/ordering.ts
src/model/ids.ts  src/model/read-model.ts  src/model/write.ts  src/model/diff.ts
src/session/session-controller.ts
src/state/errors.ts  src/state/save-label.ts
src/transfer/filename.ts  src/transfer/export.ts  src/transfer/capsule-meta.ts
src/offline/sw-register.ts  src/offline/status-copy.ts
src/ui/h.ts  src/ui/app-view.ts  src/ui/announce.ts
tests/*.test.ts per section 13.2, tests/batches.ts, tests/fc-report.ts, tests/dist-scan.test.ts
e2e/helpers.ts  e2e/static-server.mjs  e2e/*.spec.ts per section 13.5
```

`config.ts`: `APP_ID = "patchboard"`, `DB_NAME = "patchboard"`, `MAX_BYTES = 8 * 1024 * 1024` (equals Persist's
default and Capsule's `DEFAULT_MAX_UPDATE_BYTES`), `LAST_BOARD_KEY = "patchboard.lastBoardId.v1"`.

Exact future PowerShell commands are in `tasks.md` section 5. The fresh-snapshot verification (task 8.3) uses
`robocopy` with `/XD node_modules dist .git test-results playwright-report .cache .vite coverage .agents
.review-artifacts` and compares the lockfile SHA-256 before and after, as FieldLedger's task 5.1 did.

## 16. Traceability

Every MUST criterion maps to a named test and an exact observation in `requirements.md` section 9. The task
for each test is in `tasks.md` section 7.
