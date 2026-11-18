# FieldLedger MVP: Requirements

Status: PLANNED, not implemented. Baseline commit `916165f` on branch `feat/fieldledger`.
This document specifies one incident workspace with a practical checklist. No planned test in
this spec has been run. Every signature quoted here was read from the actual sources at the
baseline (`packages/kit/src`, `packages/persist/src`, `packages/capsule/src`).

Companion documents: `design.md` (architecture, flows, copy, files) and `tasks.md` (ordered
checklist, verification commands, traceability).

## 1. Scope

FieldLedger is the offline incident reporting example app (`@ghostsync/fieldledger`,
`apps/fieldledger`). It consumes only the built public entries of `@ghostsync/kit`,
`@ghostsync/persist` and `@ghostsync/capsule`. It implements no sync, CRDT, capsule or
IndexedDB logic of its own.

### In scope (this milestone)

- ONE incident workspace per opened document: incident details plus a checklist.
- Opening a shared incident by a document ID that both inspectors know.
- Autosave to the local device with truthful save feedback.
- Offline reload after an initial online visit, using a build-generated service worker.
- File transfer only: export and import real `.gscap` files in both directions.
- Save failure after an applied import, with a concrete recovery action.
- Real-browser acceptance tests (Playwright, Chromium, two independent browser contexts).

### Out of scope (explicit)

QR transfer (small or animated), PatchBoard, GhostSync Studio, accounts or authentication,
server or network sync, encryption, compression, differential (diff) capsules, a multi-incident
dashboard, photo or file attachments, a schema editor, internationalization, push or background
sync, undo of an import, conflict history, and per-keystroke collaborative text editing.

## 2. The one user journey

Two inspectors, Ana and Ben, each use their own browser profile (their own IndexedDB, local
storage and service worker). They share one incident ID by voice or message: `INC-2026-0042`.

1. Open. Each loads FieldLedger online once. The app shows "Preparing offline use" and then
   "Ready to work offline". Each types the incident ID into the join form. The app normalizes
   it to `inc-2026-0042`, shows the normalized value before opening, and opens the incident.
   The header shows the incident ID and "This device: <first 8 characters of this device's
   replica ID>". Ana's and Ben's replica IDs differ. Both are the same document.
2. Edit independently. Ana creates the incident details (title, location, severity, status,
   notes) and adds checklist items. Ben, in his own profile, does the same for his own copy.
   Each edit is committed to the local replica when the field is committed (change or Enter).
3. Save locally. After each edit the header shows "Changes not yet saved", then "Saving to this
   device...", then "Saved locally". The label says "Saved locally" only when Persist reports
   state `saved`.
4. Go offline and reload. After "Ready to work offline" appears, the network is cut. Ana
   reloads the page. The shell boots from the service worker, the same incident reopens, her data
   is restored from IndexedDB, and she keeps editing offline. A second offline reload keeps her
   latest edits.
5. Exchange files. Ana presses "Export capsule (.gscap)". The browser downloads a real file.
   Ben picks it with the "Import capsule (.gscap)" file input. The app shows "Capsule applied and
   saved locally" and a "What changed" panel built from the real before and after replica state.
   Ben then exports his own capsule and Ana imports it. Both profiles show identical merged data.
   Importing the same file twice is safe and reports "no changes".
6. Reject bad files. Ben picks a capsule for another incident. The app says which incident the
   file belongs to, says nothing was changed, and the visible and persisted state are unchanged.
7. Recover from a failed save. A capsule is applied but the resulting state could not be written
   (for example the IndexedDB write aborted). The app shows an alert: "Capsule applied, but NOT
   saved to this device." The merged data stays visible. The alert offers "Retry save" and
   "Download backup capsule". Retry succeeds, the indicator returns to "Saved locally", and the
   merged data survives a reload.

## 3. Definitions

- Document ID: the user-entered, normalized incident identifier. It is the Persist and Kit
  `documentId` and the capsule `documentId`.
- App ID: the constant `fieldledger`. It is the Persist `app`, the Kit adapter `schema.app` and
  the capsule `app`.
- Replica ID: a stable local identity of one replica of one document in one browser profile
  (Persist `replicaId`). It is distinct from the Yjs `clientID`, which changes per `Y.Doc`.
- Item ID: the record ID of one checklist item inside the checklist collection.
- Saved locally: Persist `session.state === "saved"` for the current session.
- Applied but not saved: `importCapsuleIntoPersisted` resolved `{ applied: true, persisted: false }`.
- Profile: one browser profile with its own IndexedDB, `localStorage`, Cache Storage and service
  workers. A Playwright `browser.newContext()` is a separate profile.

## 4. Functional requirements

Each requirement has EARS acceptance criteria (`WHEN ... THE SYSTEM SHALL ...`). Priority:
MUST (needed for the journey and acceptance tests) or SHOULD (needed for quality, not blocking
the journey).

### REQ-FL-001 Open a shared incident by document ID (MUST)

- AC-FL-001-1: WHEN the user enters an incident ID and submits, THE SYSTEM SHALL normalize it
  by trimming surrounding whitespace and lowercasing, then validate it against
  `^[a-z0-9][a-z0-9._-]{2,63}$` (3 to 64 characters).
- AC-FL-001-2: WHEN the typed value is not empty, THE SYSTEM SHALL show the normalized value
  ("Will open: inc-2026-0042") before the user submits.
- AC-FL-001-3: WHEN validation fails, THE SYSTEM SHALL show an actionable message that states the
  allowed characters and length, SHALL NOT call `openReplica`, and SHALL keep focus on the field.
- AC-FL-001-4: WHEN validation succeeds, THE SYSTEM SHALL call `openReplica` with
  `app: "fieldledger"` and `documentId` equal to the normalized value. The same normalized value
  SHALL be used for the capsule `documentId`.
- AC-FL-001-5: WHEN the page loads with a route `#/i/<documentId>` or, if absent, a remembered
  last document ID in `localStorage`, THE SYSTEM SHALL open that incident without asking again.
- AC-FL-001-6: WHEN an incident is open, THE SYSTEM SHALL show the incident ID, the short
  replica ID, and the schema version in the page header or an about region.
- AC-FL-001-7: WHEN the user chooses "Change incident", THE SYSTEM SHALL `close()` the session
  first. IF close fails (recovery-only state), THE SYSTEM SHALL NOT switch, SHALL show the
  backup and "Discard unsaved changes and switch" (`dispose()`) actions.

### REQ-FL-002 Stable identities (MUST)

- AC-FL-002-1: THE SYSTEM SHALL use the constant app ID `fieldledger` for Persist, Kit adapters
  and capsules.
- AC-FL-002-2: THE SYSTEM SHALL generate a replica ID with `crypto.randomUUID()` the first time a
  profile opens a given document, and SHALL store it in `localStorage` under a key derived from
  the document ID. Reloads SHALL pass the stored value as `OpenOptions.replicaId`.
- AC-FL-002-3: THE SYSTEM SHALL NOT derive the replica ID from the Yjs `clientID`, the document
  ID, or any user-visible name.
- AC-FL-002-4: THE SYSTEM SHALL generate each checklist item ID offline with `crypto.randomUUID()`
  in the form `ci-<uuid>`. Item IDs SHALL NOT depend on list position, the replica ID, or time.
- AC-FL-002-5: THE SYSTEM SHALL store the incident details as ONE record with the constant ID
  `incident` in the incident collection.
- AC-FL-002-6: IF the stored replica ID value is missing or malformed, THEN THE SYSTEM SHALL
  generate and store a new one and SHALL treat the document as a fresh replica on this profile.
- AC-FL-002-7: IF `localStorage` is unavailable, THEN THE SYSTEM SHALL NOT open a session and
  SHALL show "This browser blocks local storage, so FieldLedger cannot keep a stable device ID."

### REQ-FL-003 Two profiles, one document, distinct replicas; one profile, one owner (MUST)

- AC-FL-003-1: WHEN two independent profiles open the same normalized document ID, THE SYSTEM
  SHALL give them distinct replica IDs and distinct stored records
  (`StoredRecord.replicaId` differs, `StoredRecord.documentId` is equal).
- AC-FL-003-2: WHEN a second tab or window of the SAME profile opens the same document and
  `openReplica` rejects with `PersistenceError.code === "StorageInUseError"`, THE SYSTEM SHALL
  show "This incident is already open in another tab or window on this device. Close the other
  one, then try again." with a "Try again" button, SHALL NOT read or write the record, and SHALL
  leave the first tab unaffected.
- AC-FL-003-3: WHEN "Try again" is pressed after the other tab released the lock, THE SYSTEM
  SHALL open the session normally.
- AC-FL-003-4: THE SYSTEM SHALL map other `openReplica` failures per the error table in
  `design.md` section 9 (each with a concrete next step).

### REQ-FL-004 Data model: incident details and separately mergeable checklist items (MUST)

- AC-FL-004-1: THE SYSTEM SHALL define two `EntityAdapter<T>` values with
  `schema = { app: "fieldledger", entityType: "incident" | "checklistItem", schemaVersion: 1 }`.
- AC-FL-004-2: THE SYSTEM SHALL store the incident as scalar fields `title`, `location`,
  `severity`, `status`, `notes`, and each checklist item as its own record with scalar fields
  `text`, `done`, `sortKey`, `createdBy`, `createdAt`.
- AC-FL-004-3: THE SYSTEM SHALL implement `validate` (throws `TypeError`), `toFields` and
  `fromFields` (throws when a field is missing or mistyped) so that an incomplete or invalid
  stored record becomes a Kit `invalidRecord` outcome, never a crash.
- AC-FL-004-4: THE SYSTEM SHALL render every record returned by `listResults()`. Valid records
  render normally. `invalidRecord` records render as "Conflicted or incomplete item" with a
  truncated, text-only preview of the preserved fields and the actions "Restore" and "Discard".
- AC-FL-004-5: THE SYSTEM SHALL NOT delete, repair or fabricate stored fields automatically.
  "Restore" and "Discard" run only on explicit user action.
- AC-FL-004-6: THE SYSTEM SHALL bound field values on `validate`: `title` and `location` at most
  120 characters, `notes` at most 2000, item `text` 1 to 200 characters, `createdBy` 1 to 64.
- AC-FL-004-7: WHEN the Kit throws a schema-mismatch `Error` while opening or using a collection,
  THE SYSTEM SHALL show "This incident was created by an incompatible FieldLedger version.
  Nothing was changed." and, if raised at open, SHALL `dispose()` the session to release the lock.

### REQ-FL-005 Checklist operations and ordering (MUST)

- AC-FL-005-1: THE SYSTEM SHALL support: add item (append), edit item text, toggle done, move
  up, move down, delete item.
- AC-FL-005-2: THE SYSTEM SHALL order items by `sortKey` ascending, then by item ID ascending
  (JavaScript code-unit comparison). List position SHALL NOT be stored. Invalid records SHALL be
  listed after valid ones, ordered by ID.
- AC-FL-005-3: WHEN an item is appended, THE SYSTEM SHALL set `sortKey = max(existing) + 1024`
  (or 1024 when empty).
- AC-FL-005-4: WHEN two replicas append concurrently and obtain equal `sortKey` values, THE
  SYSTEM SHALL show the same order on both after exchange (tie broken by item ID). The tests
  assert a HAND-WRITTEN literal ID sequence for the fixture ORD-FIX-1 (design 14.4.1), never a
  sequence produced by the app's own comparator.
- AC-FL-005-5: WHEN "Move up/down" needs a key between neighbors, THE SYSTEM SHALL use the
  midpoint. IF no strict midpoint exists (equal or float-exhausted neighbors), THE SYSTEM SHALL
  renormalize `sortKey` to `(index + 1) * 1024` in the displayed order, writing only keys that
  changed, and then move.
- AC-FL-005-6: Empty text SHALL NOT be committed. WHEN the user clears an item's text field and
  commits, THE SYSTEM SHALL restore the previous text and show "Item text cannot be empty."

### REQ-FL-006 Merge behavior (MUST)

The Kit stores each field as one leaf key. `put` writes only fields whose value changed against
the CURRENT LOCAL state and deletes keys for fields omitted from the entity. The Kit gives
field-level last-writer-wins by Yjs conflict resolution, with no wall-clock promise.

- AC-FL-006-1: Concurrent edits to DIFFERENT items SHALL both survive after exchange in both
  directions.
- AC-FL-006-2: Concurrent edits to DIFFERENT FIELDS of one record SHALL both survive.
- AC-FL-006-3: Concurrent edits to the SAME field of one record SHALL converge to exactly ONE of
  the submitted values, identical on both replicas. THE SYSTEM SHALL NOT claim that the later
  edit wins and SHALL NOT claim that the other value is kept.
- AC-FL-006-4 (CHARACTERIZATION; does not promise which operation wins): WHEN one replica
  deletes an item while the other concurrently edits an EXISTING field of it (E2E-FL-08), THE
  SYSTEM SHALL, after both profiles exchange capsules in both directions, satisfy all of:
  (a) both profiles' decoded states are deep-equal; (b) the outcome is exactly one of these
  shapes, identical on both profiles: (i) the item is absent on both; (ii) the item is present
  and valid on both, with the edited field value; (iii) the item is surfaced as an
  invalid/incomplete record by `listResults()` on both, with identical preserved `fields`;
  (c) the UI shows the same checklist on both, nothing crashes, and any invalid record is
  surfaced as a "Conflicted or incomplete item" row (AC-FL-004-4), never hidden. The
  implementer SHALL record the OBSERVED Kit outcome (design 5.1 and tasks 2.10) BEFORE any text
  in these documents promises which edit wins. IF the observed outcome violates (a) to (c), it is
  a Kit finding to report, not something to paper over in the app. Honest precedent: the Kit's
  existing test (`packages/kit/tests/deletion.structured.test.ts`, "edit concurrent with
  deletion") covers a concurrent write of a NEW field (`note`) and says nothing about an
  edit of an EXISTING field (`text`), so this case has no Kit precedent.
- AC-FL-006-5: WHEN committing an edit, THE SYSTEM SHALL read the CURRENT record from the
  collection at commit time and `put` it with ONLY the edited field changed. It SHALL NOT submit
  a form snapshot captured earlier, so unrelated concurrent field edits already imported are
  not overwritten.
- AC-FL-006-6: WHEN an import changes a field the local user also edited, THE SYSTEM SHALL show
  in the "What changed" panel that the value changed and SHALL state "If both devices edited the
  same field, only one value is kept."
- AC-FL-006-7: Importing the same capsule twice, or importing a capsule whose data is already
  present, SHALL be safe: the replica state is unchanged and the result says "no changes".
- AC-FL-006-8: THE SYSTEM SHALL create the incident record only on an explicit "Create incident
  details" action. IF both inspectors create it concurrently, THE SYSTEM SHALL accept the
  per-field one-value-wins outcome described in AC-FL-006-3 (documented limitation L-2).

### REQ-FL-007 App startup and session ownership (MUST)

- AC-FL-007-1: THE SYSTEM SHALL open the session with
  `openReplica({ app: "fieldledger", documentId, replicaId, dbName: "fieldledger", maxBytes: 8388608, onStateChange })`.
- AC-FL-007-2: THE SYSTEM SHALL open both collections through the session
  (`session.collection(incidentAdapter)`, `session.collection(checklistItemAdapter)`), never
  through a raw Kit `Replica`.
- AC-FL-007-3: THE SYSTEM SHALL subscribe with `session.subscribe(listener)` and re-render from
  `list()` and `listResults()` on every change, local or remote. Rendering SHALL NOT replace the
  value of a focused input that holds an uncommitted draft.
- AC-FL-007-4: WHEN the page becomes hidden (`visibilitychange` to `hidden` or `pagehide`), THE
  SYSTEM SHALL commit a focused draft field and rely on Persist's own best-effort save. THE
  SYSTEM SHALL NOT claim durability on unload.
- AC-FL-007-5: WHEN the user leaves an incident, THE SYSTEM SHALL call `close()` and unsubscribe.
  On a rejected close (`CloseFailedError`) THE SYSTEM SHALL keep the recovery-only session
  readable and offer backup export and `dispose()`.
- AC-FL-007-6: IF `close()` or `dispose()` has completed, THE SYSTEM SHALL NOT call any session
  or collection method (every call would reject with `ClosedError`).

### REQ-FL-008 Autosave feedback (MUST)

- AC-FL-008-1: THE SYSTEM SHALL derive the visible save indicator ONLY from Persist
  `onStateChange(state, info)` and `session.state`. It SHALL NOT show "Saved locally" in any
  other situation.
- AC-FL-008-2: THE SYSTEM SHALL map states to labels exactly as: `dirty` -> "Changes not yet
  saved"; `saving` -> "Saving to this device..."; `saved` with `info.sequence > 0` -> "Saved
  locally"; `saved` with `info.sequence === 0` -> "Nothing to save yet"; `error` -> "NOT saved to
  this device".
- AC-FL-008-3: THE SYSTEM SHALL expose the raw state as `data-save-state` and the sequence as
  `data-save-sequence` on the indicator element.
- AC-FL-008-4: THE SYSTEM SHALL announce only SETTLED transitions in a polite live region
  (`role="status"`): to "Saved locally" after having been dirty, saving or error, and to the
  error label. Intermediate `dirty` and `saving` SHALL NOT be announced.
- AC-FL-008-5: THE SYSTEM SHALL show the save-error alert with `role="alert"`.
- AC-FL-008-6: WHEN a new edit is made while the state is `error`, THE SYSTEM SHALL let Persist
  retry and SHALL reflect whatever state results. It SHALL NOT hide the error until Persist
  leaves `error`.

### REQ-FL-009 Save failure and recovery (MUST)

- AC-FL-009-1: WHEN `importCapsuleIntoPersisted` resolves `{ applied: true, persisted: false,
  saveError }`, THE SYSTEM SHALL show an alert "Capsule applied, but NOT saved to this device"
  with the `saveError.code` mapped copy, SHALL keep the merged data visible, and SHALL set
  `data-import-state="applied-unsaved"` and `data-import-code` to `saveError.code`.
- AC-FL-009-2: THE SYSTEM SHALL offer "Retry save" (calls `session.flush()`) and "Download backup
  capsule" (encodes `session.exportState()` into a `.gscap`). Both SHALL be keyboard accessible.
- AC-FL-009-3: WHEN `flush()` resolves, THE SYSTEM SHALL update the import result to "Saved
  locally. The imported changes are now stored on this device." and the indicator SHALL return to
  `saved`. WHEN `flush()` rejects, THE SYSTEM SHALL keep the alert, show the mapped error, and
  keep both actions available.
- AC-FL-009-4: The alert SHALL tell the user what happens if the tab closes: "If you close or
  reload this page before the save succeeds, the imported changes and your newest edits are lost
  from this device. Download a backup capsule first."
- AC-FL-009-5: WHEN `saveError.code === "QuotaExceededError"`, THE SYSTEM SHALL say that either
  the incident data is over the local size limit or the browser has no free storage, recommend
  the backup capsule first, then freeing browser storage or starting a new incident, and state
  that retrying will keep failing until space or size changes.
- AC-FL-009-6: WHEN `saveError.code` is `TransactionAbortError`, THE SYSTEM SHALL say the browser
  aborted the write and that Retry usually succeeds.
- AC-FL-009-7: THE SYSTEM SHALL install a `beforeunload` guard ONLY while the save state is
  `error`, and remove it when the state leaves `error`.
- AC-FL-009-8: THE production bundle SHALL NOT contain any failure-injection API (REQ-FL-019).
- AC-FL-009-9: WHEN a failed save is not an import (for example an edit followed by an aborted
  write), THE SYSTEM SHALL show an alert headed "Your latest changes are NOT saved to this
  device." (no "Capsule applied" wording, no `data-import-state`), repeat the AC-FL-009-4
  sentence about closing the page, and offer the same two actions ("Retry save", "Download
  backup capsule").
- AC-FL-009-10 (added 2026-11-15, edit-error visibility): WHEN an edit made in the ready workspace throws
  (caught by `SessionController.guard()`), THE SYSTEM SHALL keep the phase `ready`, keep the incident
  details and checklist visible and usable, and show an alert (`[data-testid="edit-error-alert"]`,
  `role="alert"`, `data-edit-error-kind` = `schema-mismatch` or `unexpected`) headed "Your edit was NOT
  applied" that says what happened and what to do. It SHALL offer "Dismiss" and "Download backup
  capsule" (and "Reload app" for `schema-mismatch`, whose copy says this device's FieldLedger version
  cannot edit data written with a newer schema). The alert SHALL be distinct from the save-error alert
  and the import result: it SHALL NOT change `data-save-state`, SHALL NOT say "saved" or "Capsule
  applied", and SHALL clear on Dismiss or on the next successful edit. Tests: E2E-FL-19 and
  `tests/edit-error.test.ts`.

- Note (2026-11-16, AC-FL-009-10): a failed edit SHALL keep the LAST SUCCESSFULLY READ workspace model on screen and
  SHALL NOT re-read through the collection (a schema mismatch makes every collection operation throw). Phase, save
  state and backup export are untouched. A later `refresh()` that throws also keeps the last good model. Schema
  mismatch at open still shows the error screen. Tests: `tests/edit-error.test.ts` (edit and `listResults` both
  reject) and E2E-FL-20.

### REQ-FL-010 Offline readiness and startup (MUST)

- AC-FL-010-1: THE SYSTEM SHALL register a build-generated service worker at a scope-relative
  URL (`./sw.js`, `scope: "./"`) only on a secure context (HTTPS or `localhost`) where
  `serviceWorker` exists.
- AC-FL-010-2: THE SYSTEM SHALL report offline readiness as `ready` ONLY when the service worker
  is active, controls the page, and a `GHOSTSYNC_PRECACHE_STATUS` round trip reports a complete
  precache. Registration alone SHALL NOT be reported as ready.
- AC-FL-010-3: THE SYSTEM SHALL show the readiness states with exact copy from `design.md`
  section 8 and expose `data-offline-state` and `data-offline-ready` on `<html>`.
- AC-FL-010-4: WHILE readiness is not `ready`, THE SYSTEM SHALL show the preparing copy ("Stay
  online until this says 'Ready to work offline'") and the persistent line "Opening FieldLedger
  offline for the very first time will not work. Open it once while online." (exact copy in
  `design.md` 8.3).
- AC-FL-010-5: WHEN registration or precache fails, THE SYSTEM SHALL show "Offline use is not
  available: <reason>. You can keep working while online. Your edits still save to this device."
- AC-FL-010-6: THE SYSTEM SHALL NOT claim or test that a first-ever visit works offline.
- AC-FL-010-7 (SHOULD, optional; the MVP contract requires ROOT hosting only): THE precache plan SHOULD
  work unchanged when deployed under a sub-path (all URLs scope-relative). Covered by the optional
  extra E2E-FL-11 and `tests/dist-scan.test.ts`; not part of MVP acceptance. (Changed from SHALL after
  implementation to match the hosting decision recorded in the Hosting note; review finding F-8.)
- AC-FL-010-8: WHEN a newer worker is installed and waiting, THE SYSTEM SHALL show "A new version
  is ready. Save your work, then update." with an explicit "Update now" action. It SHALL NOT
  `skipWaiting` automatically.
- AC-FL-010-9: THE SYSTEM SHALL show a network indicator from `navigator.onLine` and the
  `online`/`offline` events ("Network: online" / "Network: offline") and SHALL show the transfer
  mode "Transfer: file (.gscap)".

### REQ-FL-011 Reload offline and keep working (MUST)

- AC-FL-011-1: WHEN the network is disabled after readiness and the page reloads, THE SYSTEM
  SHALL boot the shell from the service worker (document and JS asset responses report
  `fromServiceWorker() === true`).
- AC-FL-011-2: WHEN the page boots offline, THE SYSTEM SHALL reopen the remembered or routed
  incident with the same replica ID and restore all saved data from IndexedDB.
- AC-FL-011-3: WHILE offline, THE SYSTEM SHALL allow edits, autosave, export and import with no
  network request.
- AC-FL-011-4: Edits made offline SHALL survive a further offline reload.

### REQ-FL-012 Export a capsule file (MUST)

- AC-FL-012-1: WHEN the user presses "Export capsule (.gscap)", THE SYSTEM SHALL call
  `encodeCapsule({ app: session.identity.app, documentId: session.identity.documentId, update: session.exportState() })`
  and download the bytes through a `Blob` with media type `application/vnd.ghostsync.capsule`
  and an anchor `download` attribute.
- AC-FL-012-2: THE SYSTEM SHALL name the file
  `fieldledger_<documentId>_<replica8>_<YYYYMMDD>T<HHMMSS>Z.gscap` (UTC), where `replica8` is the
  first 8 characters of the replica ID. Backup capsules insert `_backup` before the extension.
- AC-FL-012-3: THE SYSTEM SHALL revoke the object URL after the download starts.
- AC-FL-012-4: THE SYSTEM SHALL work offline and SHALL export the in-memory merged state even
  when the save state is `error` or the session is recovery-only (`exportState()` stays readable).
- AC-FL-012-5: THE SYSTEM SHALL show a status message with the file name and byte size.

### REQ-FL-013 Import a capsule file (MUST)

- AC-FL-013-1: THE SYSTEM SHALL provide a visible, labelled native `<input type="file">` named
  "Import capsule (.gscap)" with `accept=".gscap,application/vnd.ghostsync.capsule"`. The
  `accept` attribute is a hint only.
- AC-FL-013-2: WHEN a file is chosen, THE SYSTEM SHALL check `File.size` against
  `DEFAULT_MAX_CAPSULE_BYTES` (16 MiB) BEFORE calling `file.arrayBuffer()`.
- AC-FL-013-3: THE SYSTEM SHALL read the file once and call
  `importCapsuleIntoPersisted(session, bytes)` with the default limits. No decoding or checksum
  logic SHALL exist in the app.
- AC-FL-013-4: WHEN the result is `{ applied: true, persisted: true }`, THE SYSTEM SHALL show
  "Capsule applied and saved locally" with `data-import-state="applied-saved"`.
- AC-FL-013-5: THE SYSTEM SHALL reset the file input value after handling a file so choosing the
  same file again triggers a new import.
- AC-FL-013-6: THE SYSTEM SHALL process one import at a time and disable the input while an
  import is running.
- AC-FL-013-7: THE SYSTEM SHALL show the capsule metadata (app, document ID, created time) from
  `result.metadata` as text only, truncated to 80 characters per value.
  Note (2026-11-16): the three values are shown in the import result region as text (`textContent`), in
  `[data-testid="import-meta-app"]` ("Capsule app"), `import-meta-document-id` ("Document") and
  `import-meta-created-at` ("Created"), for applied-saved and applied-unsaved, kept across Retry save, absent for
  rejected results. A value of 80 characters or fewer is shown whole; a longer one is shown as 79 characters plus
  "…" (80 shown); the full value is not kept in the DOM. Tests: `tests/import-metadata.test.ts`, and
  `expectImportMeta` in E2E-FL-05 (saved and after retry), E2E-FL-07 and the two-profile journey.
- AC-FL-013-8: THE SYSTEM SHALL state in the import region: "A capsule is checked for damage, not
  for who sent it. Only import files from people you trust."

### REQ-FL-014 Rejection without mutation, with specific errors (MUST)

- AC-FL-014-1: WHEN `importCapsuleIntoPersisted` rejects with a `CapsuleError`, THE SYSTEM SHALL
  show the mapped message from the error table (design section 9), set
  `data-import-state="rejected"` and `data-import-code` to the `CapsuleError.code`, and say
  "Nothing was changed."
- AC-FL-014-2: WHEN rejected, THE SYSTEM SHALL leave the visible incident data, the save
  indicator state and sequence, and the stored record (`sequence`, `checksum`, `savedAt`,
  `bytes`) exactly as before.
- AC-FL-014-3: WHEN the code is `DocumentIdentityMismatch` or `AppIdentityMismatch`, THE SYSTEM
  SHALL decode the rejected bytes with `decodeCapsule` ONLY to read their metadata and name the
  other incident or app in the message. It SHALL never apply them. IF that decode throws, THE
  SYSTEM SHALL fall back to the generic wording.
- AC-FL-014-4: THE SYSTEM SHALL handle a `File.size` over the limit with the same `OversizedRaw`
  copy without reading the file.
- AC-FL-014-5: THE SYSTEM SHALL handle a failed file read as "Could not read that file."
- AC-FL-014-6: A `TypeError` from the capsule package SHALL be reported as "Unexpected error.
  Nothing was changed." and SHALL NOT be shown as a capsule problem.
- AC-FL-014-7: WHEN `TargetUnavailable` is raised, THE SYSTEM SHALL say the incident is not
  open for editing and offer a page reload.

### REQ-FL-015 Merged before and after view driven by real state (MUST)

- AC-FL-015-1: THE SYSTEM SHALL capture the incident and checklist read model immediately
  before `importCapsuleIntoPersisted` and again after it resolves, both from the session
  collections.
- AC-FL-015-2: THE SYSTEM SHALL render a "What changed" panel from a pure diff of those two
  models: added items, removed items, changed fields as "before -> after", and "no changes".
- AC-FL-015-3: THE panel SHALL stay visible until dismissed or until the next import.
- AC-FL-015-4: THE panel SHALL NEVER be built from mock or sample data.

### REQ-FL-016 Accessibility and responsive layout (MUST, non-functional)

- AC-FL-016-1: EVERY action SHALL be reachable and operable by keyboard alone (join, create,
  add, edit, toggle, move, delete, export, import, retry, backup, try again).
- AC-FL-016-2: EVERY interactive element SHALL show a visible focus indicator: a 3 px outline
  (computed `outline-width` exactly `3px`, `outline-style` not `none`) at 3:1 contrast against
  its background. Automated tests check the width and style (E2E-FL-09). The 3:1 contrast is
  checked manually (L-10).
- AC-FL-016-3: ALL inputs SHALL have programmatic labels. Buttons SHALL have text names that
  include the item text where actions repeat ("Delete item: Check valve").
- AC-FL-016-4: THE layout SHALL work from 320 px to wide desktop widths with no horizontal
  scroll for primary content.
- AC-FL-016-5: Status information SHALL NOT rely on colour alone (text plus a symbol or label).
- AC-FL-016-6: Rejected, error and success states SHALL be exposed to assistive technology
  through the roles in REQ-FL-008.
- AC-FL-016-7: Motion SHALL be limited to optional short transitions and SHALL respect
  `prefers-reduced-motion`.
- AC-FL-016-8: THE SYSTEM SHALL state in the plan that automated tests do not prove WCAG
  conformance. Full validation needs manual testing with assistive technologies and expert review.

### REQ-FL-017 Security and privacy (MUST, non-functional)

- AC-FL-017-1: THE SYSTEM SHALL treat every capsule as untrusted input, regardless of source.
- AC-FL-017-2: THE SYSTEM SHALL bound size before decoding: `File.size` first, then the
  Capsule package's own raw and decoded limits.
- AC-FL-017-3: THE SYSTEM SHALL render all user and capsule-provided strings with `textContent`
  or equivalent. It SHALL NOT use `innerHTML` with data.
- AC-FL-017-4: THE SYSTEM SHALL make no network request other than same-origin static assets.
  There SHALL be no third-party scripts, fonts, analytics or beacons.
- AC-FL-017-5: THE SYSTEM SHALL document in the UI and README that a checksum detects corruption
  and does not authenticate the sender.
- AC-FL-017-6: THE repository, test fixtures and build output SHALL contain no secrets or
  personal data. Fixtures SHALL use synthetic text only.
- AC-FL-017-7: THE SYSTEM SHOULD ship a `Content-Security-Policy` meta tag
  (`default-src 'self'`, `base-uri 'none'`, `form-action 'none'`) if the built `index.html`
  contains no inline script.

### REQ-FL-018 Packaging, dependencies and build order (MUST)

- AC-FL-018-1: `apps/fieldledger` SHALL depend on `@ghostsync/kit`, `@ghostsync/persist` and
  `@ghostsync/capsule` via `workspace:*` and consume only their built public entries.
- AC-FL-018-2: THE app SHALL add no runtime dependency other than those three. Dev
  dependencies SHALL reuse versions already in the repository (TypeScript 7.0.2, Vite 8.3.6,
  Vitest 5.1.0, `@playwright/test` 1.65.0, `@types/node` 24.19.2, `fast-check` 4.10.2), exact
  pinned.
- AC-FL-018-3: THE build order SHALL be kit, capsule, persist, then fieldledger.
- AC-FL-018-4: THE milestone SHALL NOT modify `packages/**`.
- AC-FL-018-5: THE app SHALL use strict TypeScript with no `any` by default.
- AC-FL-018-6: Adding the dependencies changes `pnpm-lock.yaml`, so the install step SHALL be
  `pnpm.cmd install` followed by `pnpm.cmd install --frozen-lockfile`.

### REQ-FL-019 Test-only failure injection (MUST)

- AC-FL-019-1: THE save-failure acceptance test SHALL inject its failure from test code
  (`page.addInitScript`) by wrapping `IDBDatabase.prototype.transaction`.
- AC-FL-019-2: THE production bundle SHALL contain no failure-injection API, no test hook on
  `window`, and no query-string test switch. A static scan of `dist/` for the injection helper
  names SHALL be part of verification.

## 5. Merge behavior summary (honest statement)

| Situation | Outcome on both replicas after full exchange |
| --- | --- |
| Edits to different items | Both survive |
| Edits to different fields of one record | Both survive |
| Edits to the same field | Exactly one of the submitted values; identical on both; which one is decided by Yjs and not by wall-clock; the other value is not kept |
| Delete item vs concurrent edit of an existing field | NOT promised. Characterization test E2E-FL-08: identical decoded state on both, and one of: item absent, item valid with the edited value, or item shown as an incomplete record. The observed Kit outcome is recorded at implementation (AC-FL-006-4, design 5.1) |
| Concurrent appends | Both items survive; order by `sortKey` then item ID |
| Duplicate import | No change |
| Import in either order | Same final state |

## 6. Explicit limitations

- L-1: Same-field conflicts keep one value. There is no conflict history and no way to see the
  discarded value afterwards.
- L-2: Creating the incident details record concurrently on two profiles merges per field. A
  default value written by one side can win over a value typed on the other side.
- L-3: A first-ever visit offline does not work. Offline reload works only after an initial
  online visit reached "Ready to work offline", and only on `localhost` or HTTPS.
- L-4: A capsule is full state only. There are no differential capsules.
- L-5: A checksum is integrity, not authentication. A crafted capsule with the right app and
  document ID and a valid checksum will be merged. Import cannot be undone in this milestone.
- L-6: Browsers may evict site data under storage pressure. The app does not request persistent
  storage in this milestone. Capsule backups are the user's protection.
- L-7: Typed text that has not been committed (no change event yet) is not part of the replica
  and is not saved.
- L-8: Real browser storage quota exhaustion cannot be reproduced in the acceptance suite. The
  size-limit path (`maxBytes`) is covered by Persist's own browser tests, and the app's mapping of
  `QuotaExceededError` is covered by unit tests.
- L-9: The Kit throws an untyped `Error` for a schema mismatch. The app recognizes it by its
  message prefix, pinned by a unit test against the real Kit.
- L-10: Automated checks do not establish full WCAG conformance. Focus-indicator contrast (3:1)
  is a manual check.
- L-11: If the stored replica record for a document is damaged (Persist `InvalidRecordError` at
  open), no session opens, so nothing can be exported from that record. The app shows the error,
  leaves the damaged record untouched (Persist never wipes or overwrites it) and says what to do
  by hand (design 9.3). There is no in-app reset or replacement in this milestone.

## 7. Open decisions and recommendations

| ID | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D-1 | UI layer | Framework (for example Preact) or plain TypeScript | Plain TypeScript with a small `h()` DOM helper. Keeps the dependency graph minimal (coding steering), needs no version verification, and every view is small |
| D-2 | Service worker plugin | Import by path from persist, copy, or extract a shared helper | Copy into `apps/fieldledger/scripts/` with a new cache prefix. Extract a shared helper later (follow-up task, outside this milestone) |
| D-4 | Delete semantics | Kit hard delete, or a soft-delete `removed` flag | Kit hard delete with the incomplete-item UX. Exercises the real contract and avoids a permanent tombstone |
| D-5 | `sortKey` type | Number with midpoint and renormalize, or fractional string | Number. No dependency, simple tests, renormalize covers exhaustion |
| D-6 | Text commit timing | Per keystroke, or on change/Enter/blur | On change, Enter and blur, plus a commit on page hide |
| D-7 | Failure injection | `addInitScript` wrapper, or a separate test-only build entry | `addInitScript` wrapper. The tested bundle equals the shipped bundle |
| D-8 | `beforeunload` guard | Always, never, or only in `error` | Only in `error` |
| D-9 | Document selection across reloads | URL hash route, query string, or last document in `localStorage` | Hash route first, `localStorage` fallback. A query string would break the service worker's exact navigation match. Whether the worker ignores the fragment is verified by the first offline test (see design 8.4) |
| D-10 | Persistent storage request | Call `navigator.storage.persist()` or not | Not in this milestone (L-6) |
| D-11 | Accessibility automation | Add an axe dependency, or manual checklist | Manual checklist plus Playwright keyboard and role checks. No new dependency |
| D-12 | Static server for e2e | `vite preview`, or a copy of the persist multi-scope server | Copy the persist server (dependency free) to also test a sub-path deployment |

## 8. Traceability to the original request

| Request item | Requirements |
| --- | --- |
| Open a shared incident by a known document ID | REQ-FL-001, 002, 003 |
| Edit details and checklist from independent profiles | REQ-FL-003, 004, 005, 006 |
| Save locally, reload offline, keep working | REQ-FL-007, 008, 010, 011 |
| Exchange real `.gscap` files both ways and see merged state | REQ-FL-012, 013, 015 |
| Show saved locally and applied-but-not-saved with a recovery action | REQ-FL-008, 009, 019 |
| Stable identities | REQ-FL-002, 003 |
| Checklist items as separately mergeable records, merge expectations | REQ-FL-004, 005, 006 |
| Use actual Kit, Persist, Capsule APIs | REQ-FL-004, 007, 012, 013, 018 |
| QR, PatchBoard, Studio outside this milestone | Section 1 |
| Wrong-document rejection without mutation | REQ-FL-014 |
| Accessibility, security, UI steering | REQ-FL-016, 017, 008 (status roles) |
| Packaging, pinned dependencies, build order, no `packages/**` changes | REQ-FL-018 |
| Test-only failure injection, nothing shipped | REQ-FL-019 (with REQ-FL-009) |

## 9. Acceptance-criterion coverage for the MUST criteria found uncovered (review F-1)

The consistency review (F-1) found eight MUST acceptance criteria with no observable test. Each
now maps to a NAMED test and an EXACT observation. Selectors and attributes are defined in design
10.1; scenarios in design 14.4 (E2E-FL-12 to E2E-FL-18 are new). "Raw record" means a readonly
`getAll` on the `replicas` store of the `fieldledger` IndexedDB, decoded in Node with the built
Kit and the app adapters (design 14.2). All tests below are PLANNED. None has run.

| AC | Named test | Exact observation |
| --- | --- | --- |
| AC-FL-001-7 | E2E-FL-12 `change incident: close first, failed close keeps session` | (a) After a saved edit, click `[data-testid="change-incident"]`: `html[data-session]` becomes `join` and the raw record `sequence` equals the `data-save-sequence` shown before the click (close flushed). (b) Arm the one-shot write abort, edit, await `[data-testid="save-indicator"][data-save-state="error"]`, click Change incident once: `html[data-session]` becomes `recovery`, `main[data-document-id]` still shows the old incident, `[data-testid="recovery-panel"]` contains the buttons "Download backup capsule" and "Discard unsaved changes and switch", and the join form is absent. The downloaded backup decodes (Node) to a model containing the unsaved edit. Click "Discard unsaved changes and switch" once: `html[data-session]` becomes `join`. Reopen the same ID: raw record `sequence` equals the pre-edit value and the decoded model lacks the edit |
| AC-FL-007-4 | E2E-FL-13 `page hide commits a focused draft` | Focus `li[data-item-id] input[aria-label="Item text"]`, `fill("Check valve seat")` without blur or Enter, then `page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")))`. `[data-testid="save-indicator"]` reaches `data-save-state="saved"` with a larger `data-save-sequence`, and the raw record decodes to item text "Check valve seat". Repeat on a second item with `visibilitychange` (`document.visibilityState` overridden to `hidden`, then `document.dispatchEvent(new Event("visibilitychange"))`). The no-durability-claim half is observed by unit test `save-label.test.ts` (no label exists except from `(state, info)`; "Saved locally" only for `saved` with `sequence > 0`) |
| AC-FL-009-7 | E2E-FL-14 `failed edit save: alert, beforeunload guard only in error` | Arm the abort after `data-save-state="saved"`, then edit. Await `data-save-state="error"`. `page.close({ runBeforeUnload: true })` raises a `dialog` event of type `beforeunload`; dismiss it and assert `page.isClosed() === false`. Click "Retry save" once and await `data-save-state="saved"`. `page.close({ runBeforeUnload: true })` now raises NO dialog and the page closes (`page.isClosed() === true`) |
| AC-FL-009-9 | E2E-FL-14 (same test) | In `error` after the edit: `[data-testid="save-error-alert"]` has `role="alert"`, `data-save-error-kind="edit"`, `data-save-error-code="TransactionAbortError"`, text containing "Your latest changes are NOT saved to this device." and the AC-FL-009-4 sentence, and does not contain "Capsule applied". `[data-testid="import-result"]` has no `data-import-state` of `applied-unsaved`. Buttons "Retry save" and "Download backup capsule" are visible. Raw record `sequence` and bytes equal the pre-edit values and the decoded model lacks the edit. After Retry: raw record decodes to a model containing the edit and the alert is gone |
| AC-FL-010-8 | E2E-FL-15 `new worker waits; Update now activates explicitly` | After readiness, `POST /__test/sw-bump` on the test static server (test infrastructure, not shipped) makes it serve `sw.js` with one extra comment line, then `page.reload()` online. `html[data-offline-state="waiting"]`; `[data-testid="update-banner"]` shows "A new version is ready. Save your work, then update." and a button "Update now"; `(await navigator.serviceWorker.getRegistration()).waiting` is non-null and `performance.timeOrigin` is unchanged while the banner is shown (no automatic `skipWaiting`). After `data-save-state="saved"`, click "Update now" once: the page reloads (`performance.timeOrigin` changes), `html[data-offline-state="ready"]`, `registration.waiting` is null, and the raw record decodes to the same model as before |
| AC-FL-010-9 | E2E-FL-02 (extended) | `[data-testid="network-chip"]` has text "Network: online" before `context.setOffline(true)` and "Network: offline" after it (without reload), and again after the offline reload. `[data-testid="transfer-mode"]` has text "Transfer: file (.gscap)" in both states |
| AC-FL-013-6 | E2E-FL-17 `input disabled while an import runs` | A test-owned `addInitScript` holds the next `File.prototype.arrayBuffer()` call. After `setInputFiles`, `[data-testid="import-input"]` is disabled (`toBeDisabled()`), `[data-testid="import-result"]` has `data-import-state="importing"`, and the raw record `sequence` is unchanged. After the test releases the read, the input is enabled, `data-import-state="applied-saved"`, the input `value` is `""`, and the raw record `sequence` is larger |
| AC-FL-016-4 | E2E-FL-16 `320 px width: no horizontal scroll` | `page.setViewportSize({ width: 320, height: 640 })` with a populated workspace (one item text of 200 characters and the import result shown). `document.documentElement.scrollWidth - document.documentElement.clientWidth` is `<= 0`, and no element of `main` has `getBoundingClientRect().right > 320 + 0.5` outside an `overflow-x: auto` ancestor. Repeat at 1280 x 800 |

Coverage statement. Every MUST acceptance criterion that review F-1 listed as uncovered
(AC-FL-001-7, AC-FL-007-4, AC-FL-009-7, AC-FL-009-9, AC-FL-010-8, AC-FL-010-9, AC-FL-013-6,
AC-FL-016-4) now maps to a named test and an exact observation above. Downgraded: none. Scope
of this claim: it covers those eight criteria. All other MUST criteria keep their
requirement-level mapping in `tasks.md` section 7. A full AC-by-AC audit of the rest was not part of
this pass.

## Implementation note, 2026-11-14 (resolved details; review history above is unchanged)

- Read path (AC-FL-004-4, AC-FL-007-3). Verified against `packages/kit/src/collection.ts` and `GuardedCollection` in `packages/persist/src/types.ts`: `listResults()` returns `ReadonlyArray<readonly [string, GetResult<T>]>` for EVERY stored ID, including `{ ok: false, reason: "invalidRecord", id, fields, cause }`; `list()` returns valid entities only. The spec already matched the real contract. Wording is now aligned: the UI uses `listResults()` as its single read path (checklist and incident record); `list()` and `get()` are not used for rendering.
- Hosting. The MVP contract requires ROOT hosting only (served at `/`). Sub-path hosting is NOT required. Vite `base` is `"./"`. Verified on the production build: `dist/index.html` references `./assets/...` only, `precache-manifest.json` entries are relative, `sw.js` has no host or absolute asset path, and the app registers `./sw.js` with `scope: "./"` (`tests/dist-scan.test.ts`, 4 tests). E2E-FL-11 (sub-path) is an OPTIONAL extra and passes.
- 2026-11-16 (AC-FL-013 stale workspace): if the post-import re-read fails (for example a newer-schema capsule), the workspace keeps its last readable data, the 'What changed' diff is suppressed (no 'No changes' text), and the import result shows a stale notice (`import-stale-notice`: 'This workspace is showing the last data it could read...') with a Download backup capsule button. The real save result and capsule metadata stay. The notice survives Retry save.
