# PatchBoard MVP: Requirements

Status: PLANNED. Nothing in this spec is implemented, built or run. Baseline `690cffd`, branch
`feat/patchboard`. `apps/patchboard` contains only `package.json`. Every test named here is a plan;
none has run and none is claimed to pass.

Companion documents: `design.md` (architecture, data model, fixtures, selectors, test design) and
`tasks.md` (ordered checklist, verification order). Reference implementation for session, offline
startup, transfer and recovery: `apps/fieldledger` (working, baseline `690cffd`).

Priority words: MUST = required for the MVP and mapped to a named test and an exact observation in
section 9. SHOULD = desired, optional test. Acceptance criteria use EARS form.

## 1. Product statement

PatchBoard is an offline-first kanban board built on the GhostSync Kit. One shared board has three
fixed columns: To do, Doing, Done. A card has a required title and optional notes. Several people
each hold an independent replica in their own browser profile, work offline, and exchange real
`.gscap` capsule files. After exchange every profile shows the same board. All merge logic lives in
`@ghostsync/kit`, durability in `@ghostsync/persist`, file validation in `@ghostsync/capsule`.
PatchBoard contains no sync logic.

## 2. User journey

1. Maya and Omar each open PatchBoard once while online. The app reports "Ready to work offline".
2. Both go offline, enter the same board ID `sprint-board`, and open it. Each browser profile creates
   its own stable replica ID for that board.
3. Maya adds cards and exports a capsule; Omar imports it. Both see the same cards.
4. Offline, Maya moves "Draft spec" to Doing. Omar edits the title and notes of the same card.
5. They exchange capsule files both ways. Both now see the card in Doing with Omar's title and notes.
6. Either reloads offline and sees the same board, restored from IndexedDB.
7. A bad file (wrong board, wrong app, damaged, too large) is rejected with a specific message and
   nothing changes. If an import applies but cannot be saved, an alert offers Retry save and
   Download backup capsule.

## 3. In scope

Add, edit (title and notes), move between columns, reorder within a column, delete. One shared board,
three fixed columns (ids `todo`, `doing`, `done`). Keyboard-operable move and reorder. First online
setup, offline readiness, offline reload. Real file export and import. Explicit repair of incomplete
cards. Chromium acceptance with two independent browser contexts.

## 4. Out of scope

Drag-and-drop (later polish). QR transfer (small or animated), schema editor, FieldLedger changes,
GhostSync Studio, accounts or authentication, server sync, encryption, compression, differential
capsules, a multiple-boards dashboard, custom columns, attachments, due dates, assignees, labels,
card comments, changes to `packages/**`.

## 5. Identities (summary; detail in design section 2)

- Board ID = Kit document ID = capsule `documentId`. User entered, normalized (trim, lowercase),
  validated by `^[a-z0-9][a-z0-9._-]{2,63}$`. App namespace is `patchboard`.
- Replica ID: a UUID generated once per browser profile and board, stored in `localStorage` under
  `patchboard.replicaId.v1.<boardId>`, reused on every reload. It is not the Yjs clientID.
- Two profiles join the same board by entering the same board ID. Each profile has its own
  `localStorage`, so each generates a different replica ID. Nothing else is needed to join.
- Card ID: `card-<crypto.randomUUID()>`, generated offline on any replica. Never derived from
  position, column or title.

## 6. Requirements and acceptance criteria

### REQ-PB-001 Open a board by ID

- AC-PB-001-1 (MUST) WHEN the user submits a board ID, THE SYSTEM SHALL normalize it (trim, lowercase)
  and open a session for the normalized value when it matches `^[a-z0-9][a-z0-9._-]{2,63}$`.
- AC-PB-001-2 (MUST) WHEN the board ID is invalid, THE SYSTEM SHALL show the rule in an element with
  `role="alert"`, SHALL NOT open a session, and SHALL NOT write to IndexedDB.
- AC-PB-001-3 (MUST) THE SYSTEM SHALL pass the normalized board ID unchanged as `documentId` to
  `openReplica` and to `encodeCapsule`, with `app` = `patchboard`.
- AC-PB-001-4 (SHOULD) WHILE the user types a board ID, THE SYSTEM SHALL show "Will open: <normalized>".
- AC-PB-001-5 (MUST) WHEN the page loads with hash `#/b/<boardId>` or, absent a valid route, with a
  remembered last board, THE SYSTEM SHALL open that board; the route is rewritten to
  `#/b/<boardId>` after opening.

### REQ-PB-002 Stable identities

- AC-PB-002-1 (MUST) THE SYSTEM SHALL generate the replica ID once per (profile, board), store it in
  `localStorage`, and pass the same value to `openReplica` on every later open and reload.
- AC-PB-002-2 (MUST) WHEN two profiles open the same board, THE SYSTEM SHALL use different replica IDs;
  WHEN one profile opens two boards, THE SYSTEM SHALL use different replica IDs for them.
- AC-PB-002-3 (MUST) IF the stored replica value is not a lowercase UUID, THEN THE SYSTEM SHALL generate
  and store a new one.
- AC-PB-002-4 (MUST) THE SYSTEM SHALL generate each card ID offline as `card-` plus a random UUID and
  SHALL NOT derive it from list position, column, title or time.
- AC-PB-002-5 (MUST) IF `localStorage` throws while reading or writing the replica ID, THEN THE SYSTEM
  SHALL show an actionable error and SHALL NOT open a session.

### REQ-PB-003 Session ownership

- AC-PB-003-1 (MUST) WHEN a second tab of the same profile opens the same board, THE SYSTEM SHALL show
  the StorageInUse message with a "Try again" button and SHALL NOT show the workspace.
- AC-PB-003-2 (MUST) WHEN the first tab has released the board and the user activates "Try again" once,
  THE SYSTEM SHALL open the ready workspace.
- AC-PB-003-3 (MUST) WHEN the user chooses "Change board", THE SYSTEM SHALL call `close()` (which
  flushes) and show the join form only after it succeeds.
- AC-PB-003-4 (MUST) IF `openReplica` rejects, THEN THE SYSTEM SHALL show the mapped message for the
  `PersistenceError` code (design section 8) and SHALL NOT show the workspace. Every error screen
  (`in-use`, `error`) SHALL offer "Open a different board", which returns to the join form.
- AC-PB-003-5 (MUST) IF `openReplica` rejects with `InvalidRecordError`, THEN THE SYSTEM SHALL say
  that the saved data is damaged and was kept, SHALL offer no export of it, and SHALL offer
  "Open a different board".
- AC-PB-003-6 (MUST) IF opening the card collection throws a Kit schema mismatch, THEN THE SYSTEM SHALL
  dispose the session, show the schema message, and SHALL NOT show the workspace.

### REQ-PB-004 Card record and adapter

- AC-PB-004-1 (MUST) THE SYSTEM SHALL store each card as its own record in one collection whose adapter
  declares `schema = { app: "patchboard", entityType: "card", schemaVersion: 1 }`, with exactly three
  scalar string fields: `title`, `notes`, `placement`.
- AC-PB-004-2 (MUST) `validate` SHALL reject a non-string field, a `title` shorter than 1 or longer than
  120 characters, `notes` longer than 2000 characters, and a `placement` that does not parse.
- AC-PB-004-3 (MUST) `toFields` SHALL emit exactly `{ title, notes, placement }`; notes with no text
  SHALL be stored as `""`, never omitted.
- AC-PB-004-4 (MUST) `fromFields` SHALL throw when any of the three fields is missing or not a string;
  extra fields SHALL be ignored.
- AC-PB-004-5 (MUST) WHEN the user submits a title that is empty after trimming whitespace, THE SYSTEM
  SHALL show "Enter a title." and SHALL NOT write.
- AC-PB-004-6 is retired (correction 1); its ID is not reused.
- AC-PB-004-7 (MUST) Unknown fields. WHEN a stored card record carries fields besides `title`, `notes` and
  `placement` (for example from a hand-made capsule of the same schema version), THE SYSTEM SHALL read it as
  a valid card (extra fields ignored, AC-PB-004-4) and SHALL NOT surface them. Because the Kit's `put`
  deletes stored fields the adapter does not emit, ANY PatchBoard write to that card (edit, move, reorder,
  Restore) SHALL remove the unknown fields; PatchBoard does not preserve them. This is documented as
  limitation L-7 and pinned by a planned characterization test.

### REQ-PB-005 Placement and ordering

- AC-PB-005-1 (MUST) THE SYSTEM SHALL encode a card's column and position in ONE field,
  `placement = "<column>|<position>"`, where `<column>` is `todo`, `doing` or `done` and `<position>` is
  8 decimal digits from `00000001` to `99999999`.
- AC-PB-005-2 (MUST) `parsePlacement(formatPlacement(c, p))` SHALL return `(c, p)` for every valid pair,
  and `parsePlacement` SHALL return `undefined` for every other string (wrong case, whitespace, 7 or 9
  digits, `00000000`, unknown column, extra separator, empty).
- AC-PB-005-3 (MUST) THE SYSTEM SHALL show exactly three columns in the order To do, Doing, Done and
  SHALL NOT offer custom columns.
- AC-PB-005-4 (MUST) THE SYSTEM SHALL order valid cards in a column by ascending numeric position, then
  by card ID in JavaScript code-unit order, independent of read or insertion order.
- AC-PB-005-5 (MUST) WHEN a card is reordered by one step, THE SYSTEM SHALL pick an integer position
  strictly between its new neighbours; IF none exists, THEN THE SYSTEM SHALL renormalize that column
  (design section 5.4).
- AC-PB-005-6 (MUST) WHEN a card is added or moved to a column, THE SYSTEM SHALL place it after the last
  card of that column (`max + 1024`, or `1024` when empty), subject to AC-PB-005-5 at the upper limit.
- AC-PB-005-7 (MUST) THE SYSTEM SHALL NOT place an invalid or incomplete card in any column.

### REQ-PB-006 Card operations and write sets

- AC-PB-006-1 (MUST) WHEN the user adds a card, THE SYSTEM SHALL create a new record with a new card ID,
  the trimmed title, the notes (or `""`), and a placement at the end of To do.
Scope of every write-set statement below: it concerns the SUPPORTED record fields (`title`, `notes`,
`placement`). For a stored card that holds only those fields, the written set is exactly the stated one.
A card that also holds unknown fields additionally loses them on any write (AC-PB-004-7).

- AC-PB-006-2 (MUST) WHEN the user saves an edit, THE SYSTEM SHALL write only the supported fields among
  `title` and `notes` that the user changed relative to the values the form showed when it was opened, and
  SHALL NOT write `placement`.
- AC-PB-006-3 (MUST) WHEN the user moves a card to another column, THE SYSTEM SHALL write, among the
  supported fields, only `placement` of that card (for a card holding only supported fields the written set
  is exactly `["placement"]`), and SHALL NOT write `title` or `notes`.
- AC-PB-006-4 (MUST) WHEN the user reorders a card, THE SYSTEM SHALL write, among the supported fields, only
  `placement` of that card; WHEN renormalization is needed, THE SYSTEM SHALL write only `placement` of each
  card whose position changes, and nothing else. Unknown fields follow AC-PB-004-7.
- AC-PB-006-5 (MUST) WHEN the user activates "Delete card: <title>", THE SYSTEM SHALL show an inline
  confirmation ("Confirm delete: <title>" and "Keep card: <title>") and WHEN the user activates "Confirm
  delete: <title>" SHALL call `collection.delete(id)`; "Keep card: <title>" SHALL leave the card unchanged.
- AC-PB-006-6 (MUST) Before every edit, move, reorder, or restore, THE SYSTEM SHALL read the CURRENT
  record with `getResult(id)`, never a cached UI snapshot, including when the controller is invoked with only
  a card ID while its rendered model is older than the store (REQ-PB-021); WHEN the record is absent or
  invalid, THE SYSTEM SHALL write nothing and show a notice.
- AC-PB-006-7 (MUST) THE SYSTEM SHALL offer edit, move, reorder and delete only for valid cards. Incomplete
  cards offer only "Restore card: <label>" and "Discard card: <label>" (label scheme in AC-PB-017-2).
- AC-PB-006-8 (MUST) WHILE a card edit form has focus or unsaved input, THE SYSTEM SHALL NOT overwrite the
  draft, move focus out of the field, or write the draft when the board refreshes (including after an
  applied import); the draft SHALL stay visible and uncommitted until the user activates "Save card:
  <title>" or "Cancel edit: <title>".

### REQ-PB-007 Merge behavior

All concurrent cases assume two replicas that diverged while offline and then exchanged full-state
capsules in both directions.

- AC-PB-007-1 (MUST) WHEN replica A moves card X and replica B concurrently edits X's title and notes,
  THE SYSTEM SHALL end with BOTH the edited title and notes AND the moved placement on both replicas.
- AC-PB-007-2 (MUST) WHEN both replicas concurrently move the SAME card, THE SYSTEM SHALL converge to
  exactly one placement, identical on both replicas, equal to one of the two submitted placements, with
  exactly one record for that card and the card shown in exactly one column.
- AC-PB-007-3 (MUST) WHEN replicas concurrently move DIFFERENT cards, THE SYSTEM SHALL keep both moves.
- AC-PB-007-4 (MUST) WHEN both replicas concurrently edit the same field of one card, THE SYSTEM SHALL
  converge to exactly one of the two submitted values on both, and the UI help text SHALL state that
  the kept value is not decided by clock time.
- AC-PB-007-5 (MUST) WHEN one replica deletes a card while the other edits an EXISTING field of it
  (CHARACTERIZATION CH-PB-1), THE SYSTEM SHALL converge: both decoded states are deep-equal and the
  card is in exactly one of three shapes: absent on both; valid on both; `invalidRecord` on both with
  identical preserved fields.
- AC-PB-007-6 (MUST) WHEN one replica deletes a card while the other moves it (CHARACTERIZATION CH-PB-2),
  THE SYSTEM SHALL satisfy the same convergence and shape assertion as AC-PB-007-5.
- AC-PB-007-7 (MUST) THE SYSTEM, its UI copy and its documentation SHALL NOT state which side wins in
  AC-PB-007-5 or AC-PB-007-6 until the implementer has recorded the observed Kit outcome for
  PatchBoard's own adapter in design section 12; afterwards they may describe only that observed
  outcome.
- AC-PB-007-8 (MUST) Importing the same capsule twice SHALL leave both decoded states unchanged, and
  importing updates in any order SHALL converge to the same decoded state.
- AC-PB-007-9 (MUST) WHEN replicas concurrently add cards, THE SYSTEM SHALL keep all of them; WHEN two
  have the same placement, THE SYSTEM SHALL order them by card ID.

### REQ-PB-008 Autosave feedback

- AC-PB-008-1 (MUST) THE SYSTEM SHALL derive the save label only from the Persist state: "Saved locally"
  ONLY for state `saved` with `sequence > 0`; `dirty` "Changes not yet saved"; `saving` "Saving to this
  device..."; `error` "NOT saved to this device".
- AC-PB-008-2 (MUST) THE SYSTEM SHALL expose `data-save-state` and `data-save-sequence` on the save
  indicator.
- AC-PB-008-3 (MUST) WHEN the save state changes to `saved` (sequence > 0) or `error`, THE SYSTEM SHALL
  announce it in a polite live region.
- AC-PB-008-4 (SHOULD) WHEN a restored session has not saved yet, THE SYSTEM SHALL show "Nothing to save
  yet" rather than "Saved locally".

### REQ-PB-009 Save failure, edit failure, recovery

- AC-PB-009-1 (MUST) WHEN an import applies but saving fails, THE SYSTEM SHALL show an alert
  (`role="alert"`) with "Capsule applied, but NOT saved to this device", the loss warning, "Retry save"
  and "Download backup capsule", and SHALL keep the merged board readable.
- AC-PB-009-2 (MUST) WHEN the user activates "Retry save" once and the save succeeds, THE SYSTEM SHALL show
  `saved`, change the import result to applied-saved, keep the capsule metadata, and remove the alert.
- AC-PB-009-3 (MUST) WHEN a local edit's save fails, THE SYSTEM SHALL show an alert of kind `edit` with
  Retry save and Download backup capsule, distinct from an import result.
- AC-PB-009-4 (MUST) WHEN an edit throws in the ready workspace, THE SYSTEM SHALL render an
  `edit-error-alert` (`role="alert"`) titled "Your edit was NOT applied", keep the last successfully read
  board, keep the phase `ready`, leave the save state and any import result untouched, NOT re-read the
  board through the collection, and offer "Dismiss" and "Download backup capsule", plus "Reload app" for the
  `schema-mismatch` kind only.
- AC-PB-009-5 (MUST) WHILE the save state is `error`, THE SYSTEM SHALL register a `beforeunload` guard;
  otherwise it SHALL NOT.
- AC-PB-009-6 (MUST) IF `close()` fails with `CloseFailedError`, THEN THE SYSTEM SHALL show the recovery
  panel with the board still readable, "Download backup capsule" and "Discard unsaved changes and
  switch", and no join form.
- AC-PB-009-7 (MUST) WHEN "Discard unsaved changes and switch" is activated, THE SYSTEM SHALL call
  `dispose()` and show the join form; reopening SHALL show the last saved state, without the discarded
  edit.
- AC-PB-009-8 (MUST) AFTER a retried save succeeds, a reload SHALL show the merged data.

### REQ-PB-010 Offline readiness and update

- AC-PB-010-1 (MUST) THE SYSTEM SHALL report readiness (`html[data-offline-ready="true"]`) only when a
  service worker is active, controls the page, AND its precache reports complete.
- AC-PB-010-2 (MUST) A fresh profile loading the app offline for the first time SHALL fail to load; while
  online and not yet ready the app SHALL show the first-visit notice.
- AC-PB-010-3 (MUST) IF the service worker install fails because one required precache asset cannot be
  fetched, THEN THE SYSTEM SHALL NOT claim readiness at any point for that installation (`html[data-offline-
  state]` never equals `ready`, `data-offline-ready` never equals `true`), SHALL show state `failed` with
  the reason, SHALL keep working online, and a fresh profile that is then offline SHALL NOT boot from a
  half-installed cache. The failure is produced only by a test-server fixture (design 13.5, E2E-PB-11); no
  production code and no Playwright request routing is involved.
- AC-PB-010-4 (SHOULD) IF service workers or a secure context are unavailable, THEN THE SYSTEM SHALL show
  the `unsupported` copy and keep working online. Downgraded from MUST: Chromium treats localhost as a
  secure context and no HTTP non-localhost origin is practical in the suite, so only the copy is unit
  tested (design section 13.6).
- AC-PB-010-5 (MUST) WHEN a changed worker is waiting, THE SYSTEM SHALL show "A new version is ready. Save
  your work, then update." with "Update now", SHALL NOT call `skipWaiting` automatically, and WHEN the
  user activates "Update now" SHALL first flush pending saves, then activate the worker and reload.
- AC-PB-010-6 (MUST) THE SYSTEM SHALL show the network state ("Network: online" or "Network: offline") and
  the transfer mode ("Transfer: file (.gscap)").
- AC-PB-010-7 (MUST) THE SYSTEM SHALL support ROOT hosting: `base: "./"`, worker scope `./`, cache prefix
  `ghostsync-patchboard-`.
- AC-PB-010-8 (SHOULD) THE SYSTEM SHOULD also work under a sub-path (optional E2E-PB-19).

### REQ-PB-011 Offline reload

- AC-PB-011-1 (MUST) WHEN the app is reloaded offline after being ready, THE SYSTEM SHALL restore the same
  board (same columns, order, text) from IndexedDB with the same replica ID.
- AC-PB-011-2 (MUST) THE SYSTEM SHALL allow add, edit, move, reorder, delete, export and import while
  offline.

### REQ-PB-012 Export

- AC-PB-012-1 (MUST) WHEN the user activates "Export capsule (.gscap)", THE SYSTEM SHALL build the capsule
  with `encodeCapsule({ app, documentId, update: session.exportState() })` and download it as
  `patchboard_<boardId>_<first 8 of replicaId>_<UTC yyyymmddThhmmssZ>[_backup].gscap`.
- AC-PB-012-2 (MUST) THE SYSTEM SHALL revoke the object URL after starting the download.
- AC-PB-012-3 (MUST) The exported capsule SHALL decode (with the real Capsule and Kit) to the board's
  current state.

### REQ-PB-013 Import

- AC-PB-013-1 (MUST) THE SYSTEM SHALL check `File.size` against 16 MiB before reading the file.
- AC-PB-013-2 (MUST) THE SYSTEM SHALL import with `importCapsuleIntoPersisted(session, bytes)` and show
  one of `importing`, `applied-saved`, `applied-unsaved`, `rejected`.
- AC-PB-013-3 (MUST) AFTER an applied import (saved or unsaved), THE SYSTEM SHALL show the capsule's app,
  document ID and created time as text, each capped at 80 characters.
- AC-PB-013-4 (MUST) THE SYSTEM SHALL process one import at a time and SHALL reset the file input after
  each import.
- AC-PB-013-5 (MUST) IF the board cannot be re-read after an applied import, THEN THE SYSTEM SHALL keep
  the last good board, SHALL NOT show the "What changed" summary or "No changes", SHALL show the
  "last readable data" notice with "Download backup capsule", and SHALL keep that notice after Retry
  save. The save result and metadata SHALL still be shown.
- AC-PB-013-6 (MUST) WHEN a capsule changes nothing, THE SYSTEM SHALL show "No changes".

### REQ-PB-014 Rejection without mutation

- AC-PB-014-1 (MUST) WHEN a capsule's `documentId` differs from the open board, THE SYSTEM SHALL reject
  it (`DocumentIdentityMismatch`) and name both boards.
- AC-PB-014-2 (MUST) WHEN a capsule's `app` differs (for example `fieldledger`), THE SYSTEM SHALL reject it
  (`AppIdentityMismatch`) and name the other app.
- AC-PB-014-3 (MUST) WHEN a file is truncated or its checksum fails, THE SYSTEM SHALL reject it
  (`Malformed` or `ChecksumMismatch`) with a damaged-file message.
- AC-PB-014-4 (MUST) WHEN a file exceeds 16 MiB or has an unsupported format version, THE SYSTEM SHALL
  reject it (`OversizedRaw` by `File.size`, or `UnsupportedVersion`) with the specific message.
- AC-PB-014-5 (MUST) EVERY rejection message SHALL end with "Nothing was changed.", and the visible
  board, the save state and the stored record SHALL be identical before and after.
- AC-PB-014-6 (MUST) THE SYSTEM SHALL state in the Transfer section that capsule files are
  integrity-checked and not authenticated.

### REQ-PB-015 Before and after view

- AC-PB-015-1 (MUST) AFTER an applied import whose board can be re-read, THE SYSTEM SHALL show a
  "What changed" summary computed from the real before and after boards (read with `listResults()`),
  listing added, removed, moved, retitled, notes-changed and newly incomplete cards.
- AC-PB-015-2 (SHOULD) THE SUMMARY SHOULD name cards by title and show old and new column.

### REQ-PB-016 Incomplete and invalid cards

- AC-PB-016-1 (MUST) THE SYSTEM SHALL read the board ONLY with `listResults()` and show each
  `invalidRecord` in a separate region (`invalid-cards`), outside the columns, as a row labelled
  "Conflicted or incomplete card" with its preserved fields as plain text.
- AC-PB-016-2 (MUST) THE SYSTEM SHALL NOT repair, hide or delete an invalid card automatically; its stored
  fields SHALL stay unchanged until the user acts.
- AC-PB-016-3 (MUST) WHEN the user activates "Restore card: <label>", THE SYSTEM SHALL write via `put`:
  every field whose stored value is valid is kept; `placement` that is missing or malformed becomes the
  end of To do; `title` that is missing or invalid becomes "Untitled card"; `notes` that is missing or
  invalid becomes `""`; unknown fields are removed (AC-PB-004-7). The card then appears as a normal card.
- AC-PB-016-4 (MUST) WHEN the user activates "Discard card: <label>", THE SYSTEM SHALL show an inline
  confirmation ("Confirm discard: <label>" and "Keep incomplete card: <label>"); WHEN the user activates
  "Confirm discard: <label>" THE SYSTEM SHALL call `collection.delete(id)`; "Keep incomplete card: <label>"
  SHALL change nothing.
- AC-PB-016-5 (SHOULD) THE SYSTEM SHOULD show the number of incomplete cards in the region heading.

### REQ-PB-017 Accessibility and responsive layout

- AC-PB-017-1 (MUST) EVERY action in the action inventory (design 13.5.1, A-01 to A-23: open board, add
  card, open and cancel edit, save card, move, move up and down, delete with its confirm and keep, export,
  import, Retry save, Download backup capsule, Dismiss, Reload app, Update now, Try again, Open a different
  board, Change board, Discard unsaved changes and switch, Restore card, Discard card with its confirm and
  keep) SHALL be reachable with Tab, SHALL show a visible focus ring, and SHALL be activatable with Enter
  (or Space on a native button) with the same observable result as a pointer click. One case is narrowed
  honestly: the native file chooser opened by the import file input cannot be driven by the keyboard in
  Playwright (A-12). For A-12 the suite asserts reachability only (focus, visible focus ring, accessible
  name) and imports with `setInputFiles`; the chooser dialog is not driven.
- AC-PB-017-2 (MUST) ONE accessible-name scheme applies everywhere (requirements, design and tests). Every
  card-scoped control is named `<Action>: <card label>`, where the card label is the stored title for a
  valid card, and for an incomplete card the stored title when it is a non-empty string, else the card ID
  (label capped at 80 code points). Actions: `Move to To do`, `Move to Doing`, `Move to Done`, `Move up`,
  `Move down`, `Edit card`, `Delete card`, `Confirm delete`, `Keep card`, `Save card`, `Cancel edit`,
  `Restore card`, `Discard card`, `Confirm discard`, `Keep incomplete card`. Examples: "Move to Doing: Draft
  spec", "Restore card: card-inv1", "Discard card: Bad placement". Controls that are not about one card use
  the plain names "Open board", "Add card", "Export capsule (.gscap)", "Retry save", "Download backup
  capsule", "Dismiss", "Reload app", "Update now", "Try again", "Open a different board", "Change board",
  "Discard unsaved changes and switch". The file input is labelled "Import capsule file (.gscap)". Tests
  query by role and name with `exact: true`; a bare "Restore" or "Discard" is not an accessible name.
- AC-PB-017-3 (MUST) AFTER a move or reorder, keyboard focus SHALL be on the same card (the control that
  was used if it still exists and is enabled, else the card element), never on `body`.
- AC-PB-017-4 (MUST) AFTER a move or reorder, THE SYSTEM SHALL write an announcement of the new placement
  into a polite live region (design section 9.4).
- AC-PB-017-5 (MUST) EVERY interactive element SHALL show a focus outline of 3 px.
- AC-PB-017-6 (MUST) AT widths from 320 px up, THE SYSTEM SHALL have no horizontal scroll; columns SHALL
  stack below 48em.
- AC-PB-017-7 (SHOULD) Screenshots at 1280x800 and 320 px SHALL be attached after the assertions pass. They
  are evidence only.
- AC-PB-017-8 (SHOULD) Focus contrast and assistive-technology behavior SHOULD be checked manually. Automated
  checks do not establish WCAG conformance (limitation L-10).

### REQ-PB-018 Security and privacy

- AC-PB-018-1 (MUST) THE SYSTEM SHALL render all user and capsule text with `textContent`, never HTML.
- AC-PB-018-2 (MUST) THE SYSTEM SHALL ship a Content Security Policy meta tag and SHALL make no
  cross-origin request.
- AC-PB-018-3 (MUST) THE SYSTEM SHALL treat every capsule as untrusted: size is bounded before reading,
  and format, version, identity and checksum are validated by `@ghostsync/capsule` before any update is
  applied.
- AC-PB-018-4 (SHOULD) THE REPOSITORY SHOULD contain no secrets or personal data. Verified by review, not
  by a test (downgraded from MUST: absence cannot be observed by a named test).

### REQ-PB-019 Packaging

- AC-PB-019-1 (MUST) `apps/patchboard` SHALL import only the built public entries of `@ghostsync/kit`,
  `@ghostsync/persist` and `@ghostsync/capsule` and SHALL contain no sync or merge logic.
- AC-PB-019-2 (MUST) THE CHANGE SHALL NOT modify `packages/**` and SHALL add no dependency beyond those in
  design section 15.
- AC-PB-019-3 (MUST) THE BUILD SHALL pass from a fresh snapshot with `pnpm.cmd install --frozen-lockfile`
  and the sequence in `tasks.md` section 5.

### REQ-PB-020 Test-only failure injection

- AC-PB-020-1 (MUST) Failure injection SHALL live only in test code. THE PRODUCTION BUNDLE SHALL contain
  no `__ghostsyncTest`, `armWriteAbortOnce`, `holdNextFileRead`, `releaseFileRead` or `window.__`.
- AC-PB-020-2 (MUST) Setup writes SHALL be flushed and asserted saved before a one-shot failure is armed,
  and it SHALL be armed immediately before the action under test.

### REQ-PB-021 Stale-move detection

- AC-PB-021-1 (MUST) A planned unit test (U-PB-08) SHALL assert that the model-helper write set of a move,
  for a card holding only supported fields, equals exactly `["placement"]`, observed through the real Kit by
  diffing stored fields before and after.
- AC-PB-021-2 (MUST) A planned controller-level test (U-PB-21, the PRODUCTION path) SHALL construct the real
  `SessionController` with a rendered model holding the OLD card (`title "Original title"`, `notes "Original
  notes"`, `todo|00001024`) while the stored card holds the NEWER title and notes (`"Edited elsewhere"`,
  `"Notes edited elsewhere"`), invoke `controller.move(cardId, "doing")` with only the card ID, and assert:
  the stored placement is `doing|00001024`, the stored title and notes are still the newer values, and the
  written field set is exactly `["placement"]`.
- AC-PB-021-3 (MUST) The same controller test file SHALL include a deliberately naive controller-model
  writer (`put(id, { ...controller.model.card, placement })`) as a NEGATIVE CONTROL and SHALL assert that
  the detector flags it (written set `["notes","placement","title"]`, stored title reverted to `"Original
  title"`). The helper-level test file (U-PB-08) keeps its own naive-writer control.
- AC-PB-021-4 (MUST) The controller-level reorder (`controller.reorder`) and edit (`controller.saveCard`
  with a stale form baseline, touched fields only) paths SHALL be covered by the same fixture and detector;
  the helper-level reorder with and without renormalization is covered in U-PB-08.
- AC-PB-021-5 (MUST) A two-profile Chromium test SHALL show that when A moves a card and B edits its title
  and notes offline, both survive on both profiles after file exchange. This is end-to-end coverage only:
  it cannot detect a cached-card writer on its own (design 13.3), so AC-PB-021-2 is the stale guard.

## 7. Non-functional requirements

- NFR-PB-001 Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), no
  `any`.
- NFR-PB-002 Plain TypeScript UI with a small DOM helper, no framework (design D-1).
- NFR-PB-003 Exact-pinned dependencies reused from the repo (design section 15), `pnpm@10.34.9` only.
- NFR-PB-004 Property tests: four separately named 50-case batches per property, seeds 424242 to
  424245, default 5 s timeout, no overrides.
- NFR-PB-005 No `test.skip`, `test.fixme`, retries or timeout overrides. Each action is activated once (by
  keyboard for every action in the inventory, pointer click only in E2E-PB-01 and E2E-PB-02), then the
  observable result is awaited. No click inside `expect.poll`, no click loop.
- NFR-PB-006 Storage, transport and merge stay separate; merge is the Kit's, storage is Persist's.

## 8. Limitations and open decisions

### 8.1 Explicit limitations

- L-1 Same-field concurrent edits keep one value; the other is lost without history. Which one is not
  decided by clock time.
- L-2 Delete-versus-edit and delete-versus-move outcomes are characterized, not designed. The recorded
  outcome may leave an incomplete card that the user repairs explicitly.
- L-3 A capsule checksum detects corruption; it does not authenticate the sender.
- L-4 The first visit must be online and on localhost or HTTPS. Root hosting only is required.
- L-5 Chromium only. Firefox and WebKit are unverified.
- L-6 Browser storage can be evicted. Persistent storage is not requested.
- L-7 `Collection.put` writes the fields the adapter emits and deletes stored fields it omits (read in
  `packages/kit/src/collection.ts`). PatchBoard's `fromFields` ignores extra fields, so a card with unknown
  fields reads as valid and any edit, move, reorder or Restore of it drops those fields. PatchBoard
  does not preserve, show or flag them (AC-PB-004-7). A newer SCHEMA version is different: it makes the Kit
  throw a schema mismatch instead (L-9), so only same-version extras are affected.
- L-8 Renormalization writes other cards' `placement`. If another replica concurrently moves one of
  those cards, one placement wins per card; the board converges but the order may differ from what either
  user intended.
- L-9 The Kit throws an untyped `Error` for a schema mismatch; the app recognizes it by its message prefix
  `GhostSync Kit: schema mismatch`, pinned by a unit test against the real Kit.
- L-10 Automated checks do not establish full WCAG conformance. Focus contrast and assistive-technology
  behavior need manual review.
- L-11 The MVP has no card-count limit. A card-count safeguard SHOULD be considered later; it is not specified.
- L-12 The edit form does not tell the user that a card changed underneath it. Saving writes only the
  fields the user touched (AC-PB-006-2).
- L-13 A wrong-app rejection test uses a Node-built capsule (`app: "fieldledger"`), not a capsule produced
  by the FieldLedger UI.

### 8.2 Open decisions (one recommendation each; design section 14 holds the rationale)

| ID | Decision | Recommendation |
| --- | --- | --- |
| OD-1 | Where a moved card lands in the destination column | End of the destination column |
| OD-2 | Empty notes: omit the field or store `""` | Store `""` always |
| OD-3 | Placement as one field or two | One field `placement` (decided, design section 4) |
| OD-4 | Delete: hard delete or soft-delete flag | Hard delete with explicit repair of incomplete cards |
| OD-5 | UI layer | Plain TypeScript with a small `h()` helper |
| OD-6 | Wrong-app test file | Node-built capsule, required; FieldLedger-built is not required |
| OD-7 | Service worker plugin | Copy and adapt `apps/fieldledger/scripts/sw-precache-plugin.ts`; share later |
| OD-9 | Delete confirmation | Inline two-step confirm, no browser dialog |
| OD-10 | Edit commit | Explicit "Save card" writing only touched fields |
| OD-11 | Proposed UI port | 4339 (FieldLedger 4329, Persist 4319) |

## 9. Acceptance-criterion traceability (every MUST)

Observation vocabulary (exact definitions in design section 13):

- UI = DOM observation with the stated selectors (design section 9.1).
- P1 = raw IndexedDB record of the page read with `indexedDB` (database `patchboard`, store `replicas`) and
  decoded in Node with the real Kit and the app adapters (`storedState(page)`).
- P2 = the same read after `page.reload()` (a reopened replica).
- P3 = a downloaded `.gscap` decoded in Node with the real Capsule and Kit (`decodeCapsuleFile(path)`).
- Unit tests are named `U-PB-nn` (file in design section 13.2). Property batches are `P-PB-nn`.

Downgraded MUSTs: AC-PB-010-4 (to SHOULD, unit-only copy test) and AC-PB-018-4 (to SHOULD, review). No
other MUST is unobservable.

| AC | Named test(s) | Exact UI and/or persisted-state observation |
| --- | --- | --- |
| AC-PB-001-1 | U-PB-01 board-id.test.ts; E2E-PB-01 | UI: after `Board ID` = `  Sprint-Board ` and "Open board", `html[data-session]`=`ready` and `main[data-board-id]`=`sprint-board`. P1: record `documentId`=`sprint-board`, `app`=`patchboard` |
| AC-PB-001-2 | U-PB-01; E2E-PB-17 | UI: `#board-error` (`role=alert`) contains the rule text and `html[data-session]`=`join`. P1: `readStoredRecords` returns `[]` |
| AC-PB-001-3 | U-PB-20 session-open.test.ts; E2E-PB-01 | Unit: fake `openReplica` receives `documentId`=normalized, `app`=`patchboard`. P3: exported capsule metadata `app`=`patchboard`, `documentId`=board ID |
| AC-PB-001-5 | U-PB-01; E2E-PB-17 | UI: `goto('/#/b/sprint-board')` offline opens `main[data-board-id]`=`sprint-board`; after reload at that URL the same board opens; hash equals `#/b/sprint-board` |
| AC-PB-002-1 | U-PB-02 replica-id.test.ts; E2E-PB-17 | UI: `main[data-replica-id]` equal before and after reload. P1: record `replicaId` equals it, before and after |
| AC-PB-002-2 | U-PB-02; E2E-PB-01 | UI: `main[data-replica-id]` differs between profiles A and B on the same board. P1: records' `replicaId` differ |
| AC-PB-002-3 | U-PB-02 | Unit: malformed stored value is replaced by a new UUID and stored |
| AC-PB-002-4 | U-PB-03 card-id.test.ts; E2E-PB-01 | Unit: format `^card-[0-9a-f-]{36}$`, 10,000 generated IDs unique, no dependence on inputs. UI: `li[data-card-id]` values match the format. P1: decoded card IDs equal the UI IDs |
| AC-PB-002-5 | U-PB-20 | Unit: a `localStorage` stub that throws yields phase `error`, message set, fake `openReplica` not called |
| AC-PB-003-1 | E2E-PB-10 | UI: second page in the same context: `html[data-session]`=`in-use`, `session-message` has "already open in another tab", button "Try again", no `board` element |
| AC-PB-003-2 | E2E-PB-10 | UI: after the first page closes and `navigator.locks.query()` shows the lock released, `focus()` on "Try again" then one `keyboard.press("Enter")` gives `html[data-session]`=`ready` and `main[data-board-id]` equals the board. P1: record unchanged by the attempt |
| AC-PB-003-3 | E2E-PB-15 | UI: `focus()` on "Change board" then one `Enter` gives `html[data-session]`=`join`, no `main[data-board-id]` remains and the previous board's session is closed (reopening the same board later succeeds, no `in-use`). P1: raw `sequence` equals the `data-save-sequence` shown before |
| AC-PB-003-4 | U-PB-13 errors.test.ts; U-PB-20 | Unit: every `PersistenceErrorCode` maps to its message; controller phase `in-use` for `StorageInUseError`, `error` otherwise |
| AC-PB-003-5 | U-PB-13; U-PB-20 | Unit: `InvalidRecordError` message contains "damaged" and "kept", has no backup action, and `openJoin()` returns to `join` |
| AC-PB-003-6 | U-PB-20 | Unit: real Kit replica with newer schema meta behind a fake session: controller calls `dispose()` and shows the schema message |
| AC-PB-004-1 | U-PB-05 adapter.test.ts; U-PB-09 kit-integration.test.ts | Unit: `schema` deep-equals `{app:"patchboard",entityType:"card",schemaVersion:1}`; a stored card has exactly keys `title`,`notes`,`placement`. P1: decoded raw fields of a card (probe adapter) equal that key set |
| AC-PB-004-2 | U-PB-05 | Unit: each invalid input throws `TypeError` (types, title 0 and 121 chars, notes 2001 chars, malformed placement); boundary 1, 120, 2000 accepted |
| AC-PB-004-3 | U-PB-05 | Unit: `toFields` returns exactly three keys; `notes: ""` is emitted as `""` |
| AC-PB-004-4 | U-PB-05; U-PB-09 | Unit: `fromFields` throws for each missing or mistyped field; a record with an extra key reads as valid |
| AC-PB-004-5 | U-PB-17 edit-error.test.ts (controller add path); E2E-PB-03 | UI: submitting a whitespace title shows "Enter a title." in `#add-error` and `[data-card-id]` count is unchanged. P1: sequence unchanged |
| AC-PB-004-7 | U-PB-22 unknown-fields.test.ts (PLANNED characterization); U-PB-05 | Unit with the real Kit: a card stored with the three fields plus `legacy: "x"` is read by `getResult` as `ok` (extra ignored); after `moveCard`, `reorderCard`, `commitCardFields` and `restoreCard` the raw stored fields have no `legacy` and `writtenFields(before, after)` equals `["legacy","placement"]` for the move (and `["legacy","notes"]` for an edit of notes) |
| AC-PB-005-1 | U-PB-04 placement.test.ts; E2E-PB-09 | Unit: `formatPlacement("doing",1024)`=`"doing\|00001024"`. P1: stored `placement` of every decoded card matches `^(todo\|doing\|done)\|\d{8}$` |
| AC-PB-005-2 | U-PB-04; P-PB-01 | Unit: literal invalid list all return `undefined`; property round trip, 4 batches |
| AC-PB-005-3 | E2E-PB-09; E2E-PB-16 | UI: `h3` texts of `column-todo`, `column-doing`, `column-done` are "To do", "Doing", "Done" in DOM order; exactly 3 `[data-column]` sections |
| AC-PB-005-4 | U-PB-07 ordering.test.ts (ORD-FIX-PB-1); P-PB-03, P-PB-04; E2E-PB-09 | Unit: literal sequences in design 7.2. UI: DOM order of `[data-testid="column-todo"] [data-card-id]` equals the literal sequence. P1: decoded placements agree with the DOM order |
| AC-PB-005-5 | U-PB-06 position.test.ts; U-PB-08; P-PB-02, P-PB-05 | Unit: literal `positionBetween` cases; renormalize literal fixture (design 5.4). P1: stored placements after the reorder equal the literals |
| AC-PB-005-6 | U-PB-06; U-PB-08; E2E-PB-03 | Unit: `nextPosition([])`=1024; `nextPosition` after 2048 = 3072. P1: a card added to an empty To do has `todo\|00001024` |
| AC-PB-005-7 | U-PB-10 read-model.test.ts; E2E-PB-08 | UI: invalid cards appear only inside `invalid-cards`; the three column sections contain none of their IDs |
| AC-PB-006-1 | U-PB-08; E2E-PB-03 | P1: new record fields `title`, `notes`, `placement` match the input and `todo\|<end>`. UI: card appears last in `column-todo` |
| AC-PB-006-2 | U-PB-08 (edit write set and stale form); U-PB-21 (controller `saveCard`); E2E-PB-01 | Unit (scoped to supported fields): editing only notes yields written set `["notes"]`; stale form baseline keeps a newer stored title. UI/P1: after the edit the title input value is unchanged and stored `placement` is unchanged |
| AC-PB-006-3 | U-PB-08; U-PB-21; U-PB-22; E2E-PB-01; E2E-PB-03 | Unit (card holding only supported fields): move written set equals `["placement"]`; U-PB-22 pins that an unknown field is additionally removed. P1: stored `title` and `notes` unchanged, `placement` column changed |
| AC-PB-006-4 | U-PB-08; U-PB-21 (controller `reorder`); E2E-PB-03 | Unit: reorder written set `["placement"]`; renormalize writes `placement` only, for the literal card IDs in design 5.4. P1: stored placements equal the literals |
| AC-PB-006-5 | U-PB-08; E2E-PB-03 | UI: `Enter` on "Delete card: T" shows "Confirm delete: T" and "Keep card: T"; `Enter` on "Keep card: T" leaves the card and the record; after a second "Delete card" and `Enter` on "Confirm delete: T" `li[data-card-id]` is gone. P1: record absent (`has(id)` false) |
| AC-PB-006-6 | U-PB-08 (absent and invalid current record); U-PB-21 (controller path with an older rendered model) | Unit: after the record is deleted behind the model, `moveCard` returns `"absent"`, the store diff is empty; same for an invalid record (`"invalid"`). Controller: `controller.move(id, column)` with the cached model older than the store writes only `placement` on top of the CURRENT stored card (AC-PB-021-2) |
| AC-PB-006-7 | U-PB-10; E2E-PB-08 | UI: rows inside `invalid-cards` contain only the buttons "Restore card: <label>" and "Discard card: <label>" (and, after Discard, its two confirm buttons); none named Move, Edit or Delete card |
| AC-PB-006-8 | E2E-PB-20 (PLANNED, design 13.5) | UI: edit form of X open, `input[name="title"]` focused with draft "Draft spec WIP"; after B's capsule is imported by `setInputFiles` the SAME input element is still `document.activeElement` with the draft and caret intact, `data-board-revision` increased, card Y shows B's change, `import-result` is `applied-saved`. P1: stored X title still "Draft spec". After `Enter` on "Save card: Draft spec" and offline reload, X has "Draft spec WIP" and Y has B's change in the DOM and in P2 |
| AC-PB-007-1 | U-PB-09; P-PB-07; E2E-PB-01 | UI: both profiles show card X in `column-doing` with title "Draft spec v2" and notes "Outline plus risks". P1: both decoded states hold X with those fields and a `doing` placement and deep-equal each other. P2: identical after offline reload |
| AC-PB-007-2 | U-PB-09; P-PB-08; E2E-PB-02 | UI: `[data-card-id=X]` count is 1 on each profile, in the same column, which is one of `doing`, `done`. P1: both decoded states deep-equal, one record X, `placement` equals one of the two submitted values |
| AC-PB-007-3 | U-PB-09; E2E-PB-02 | UI/P1: card Y in `doing` and card Z in `done` on both profiles after exchange |
| AC-PB-007-4 | U-PB-09; E2E-PB-02 (same-field title step) | P1: both decoded titles equal and equal to one of the two submitted titles. UI: `[data-testid="merge-help"]` text contains "not decided by clock time" |
| AC-PB-007-5 | U-PB-09 (CH-PB-1); E2E-PB-06 | P1: both decoded states deep-equal and the card shape is in the enumerated set. UI: both boards identical. The observed shape is logged and recorded in design section 12 |
| AC-PB-007-6 | U-PB-09 (CH-PB-2); E2E-PB-07 | As AC-PB-007-5 with a move instead of an edit |
| AC-PB-007-7 | Review step in tasks 2.9 and 8.2 | Verified by `git grep` for winner wording in `src/ui` and `README.md` after the evidence notes are filled in (design section 12); no copy claims a winner beyond the recorded shape |
| AC-PB-007-8 | P-PB-06; U-PB-09; E2E-PB-01 (duplicate import step) | Unit/property: duplicate and permuted deliveries give equal decoded states. UI: second import of the same file shows "No changes". P1: decoded state before and after equal |
| AC-PB-007-9 | U-PB-07; U-PB-09; E2E-PB-09 | UI: both concurrent inserts present, DOM order has `card-n1` before `card-n2`. P1: both records present with the same placement |
| AC-PB-008-1 | U-PB-12 save-label.test.ts; E2E-PB-17; E2E-PB-05 | UI: `save-indicator` text and `data-save-state`; "Saved locally" never appears with `data-save-state` other than `saved` or with `data-save-sequence` 0 |
| AC-PB-008-2 | U-PB-12; E2E-PB-17 | UI: attributes present and numeric after each edit |
| AC-PB-008-3 | U-PB-12; E2E-PB-05 | UI: `[data-testid="announcer"]` text becomes "Saved locally" after the first save and "Changes are NOT saved to this device" on error |
| AC-PB-009-1 | E2E-PB-05 | UI: `save-error-alert` has `role=alert`, text "Capsule applied, but NOT saved to this device" and the loss warning, buttons "Retry save" and "Download backup capsule"; the merged cards are visible. P1: stored `sequence` and bytes equal the pre-import snapshot. P3: backup capsule decodes to the merged cards |
| AC-PB-009-2 | E2E-PB-05 | UI: `focus()` on "Retry save" then one `Enter`, then `data-save-state`=`saved`, `import-result` `data-import-state`=`applied-saved`, alert count 0, metadata unchanged. P1: `sequence` greater than before, merged cards stored |
| AC-PB-009-3 | U-PB-18; E2E-PB-05 | Unit: save error with no import view gives alert kind `edit`. UI (E2E-PB-05, edit leg): `data-save-error-kind`=`edit` after an edit with armed abort |
| AC-PB-009-4 | U-PB-17; E2E-PB-13; E2E-PB-14 | Unit: a throwing `put` sets `editError`, keeps phase and model, no `listResults` call after the throw. UI: `edit-error-alert` visible with title text, `html[data-session]`=`ready`, `save-indicator` unchanged, no `save-error-alert`, board still rendered; `Enter` on "Dismiss" removes the alert (E2E-PB-13); for the `schema-mismatch` kind (E2E-PB-14) the alert has "Reload app". P1: record `sequence` and bytes unchanged |
| AC-PB-009-5 | E2E-PB-05 (guard leg) | UI: with `data-save-state`=`error`, `page.close({runBeforeUnload:true})` raises a dialog, dismissed; after Retry and `saved`, no dialog |
| AC-PB-009-6 | E2E-PB-15 | UI: `recovery-panel` visible, `html[data-session]`=`recovery`, `main[data-board-id]` unchanged, buttons "Download backup capsule" and "Discard unsaved changes and switch", no join form. P3: backup decodes with the edit |
| AC-PB-009-7 | E2E-PB-15 | UI: `focus()` on "Discard unsaved changes and switch" then one `Enter` gives `join`. P1 after reopening: `sequence` equals the pre-edit value and the board lacks the edit |
| AC-PB-009-8 | E2E-PB-05 | P2: after reload offline the merged cards are present in the UI and in the decoded stored record |
| AC-PB-010-1 | E2E-PB-11; E2E-PB-17 | UI: `html[data-offline-ready]`=`true` only after load; with a blocked install it stays `false` |
| AC-PB-010-2 | E2E-PB-11 | UI: fresh context set offline, `page.goto` rejects (net error); online first load shows `first-visit-notice` until ready |
| AC-PB-010-3 | E2E-PB-11 (failed-precache leg; PLANNED) | Fresh context, e2e static server told to answer 404 for one `assets/*.css` entry of `precache-manifest.json`. (a) `GET /__test/request-log` has an entry for that path with status 404 AFTER an `/sw.js` entry (the install fetch was exercised). (b) A test-side `MutationObserver` log of `html[data-offline-state]` and `data-offline-ready` never contains `ready` or `true`; the final state is `failed`, `data-offline-ready`=`false`, `offline-indicator` shows the failed copy, `navigator.serviceWorker.controller` is `null`, no `ghostsync-patchboard-` cache holds any entry; online, a board can be joined and a card added and saved. (c) With `setOffline(true)`, `page.reload()` rejects (net error) |
| AC-PB-010-5 | E2E-PB-12 | UI: after `POST /__test/sw-bump` and an online reload `data-offline-state`=`waiting`, `update-banner` visible with "Update now"; `performance.timeOrigin` unchanged. After `focus()` on "Update now" and one `Enter`, `performance.timeOrigin` changed (page reloaded), `data-offline-state`=`ready`, no waiting worker, `html[data-session]`=`ready`. P1: board decoded identical before and after |
| AC-PB-010-6 | U-PB-16 status-copy.test.ts; E2E-PB-17 | UI: `network-chip` "Network: online" then "Network: offline" after `setOffline(true)`; `transfer-mode` "Transfer: file (.gscap)" |
| AC-PB-010-7 | U-PB-16; D-PB-01 dist-scan.test.ts; E2E-PB-17 | `dist/index.html` references only `./assets/`; manifest entries relative; sw registers `./sw.js` scope `./`; cache keys in `caches.keys()` start with `ghostsync-patchboard-` |
| AC-PB-011-1 | E2E-PB-01; E2E-PB-17 | UI: after offline `reload`, boards deep-equal to before. P2: decoded stored state deep-equals pre-reload state; `data-replica-id` unchanged |
| AC-PB-011-2 | E2E-PB-01 | UI: all operations in the journey run with `context.setOffline(true)`; P1 shows the results stored |
| AC-PB-012-1 | U-PB-14 filename.test.ts; E2E-PB-01 | Unit: literal filename for fixed date. UI/download: `download.suggestedFilename()` matches `^patchboard_sprint-board_[0-9a-f]{8}_\d{8}T\d{6}Z\.gscap$`; backup ends `_backup.gscap`. P3: decoded metadata `app`, `documentId` |
| AC-PB-012-2 | U-PB-14 (export helper with a fake `URL`) | Unit: `revokeObjectURL` called once with the created URL |
| AC-PB-012-3 | E2E-PB-01; E2E-PB-05 | P3: decoded capsule cards deep-equal the page's P1 decoded cards at export time |
| AC-PB-013-1 | U-PB-18; E2E-PB-04 (oversized) | Unit: a fake `File` with `size` > 16 MiB and an `arrayBuffer` spy: spy never called. UI: `rejected`, code `OversizedRaw` |
| AC-PB-013-2 | U-PB-18; E2E-PB-01; E2E-PB-05 | UI: `import-result` `data-import-state` takes `applied-saved` (E2E-PB-01) and `applied-unsaved` (E2E-PB-05); `rejected` in E2E-PB-04 |
| AC-PB-013-3 | U-PB-15 capsule-meta.test.ts; U-PB-18; E2E-PB-01; E2E-PB-05 | Unit: values of 80 and 81 code points. UI: `import-meta-app`, `import-meta-document-id`, `import-meta-created-at` texts equal the Node-decoded metadata of the file, for both applied-saved and applied-unsaved, and after Retry save |
| AC-PB-013-4 | U-PB-18; E2E-PB-01 (duplicate step) | Unit: a second `importFile` while one is `importing` is ignored. UI: the same file chosen twice in a row fires two imports (second shows "No changes"), and `import-input` value is empty after each |
| AC-PB-013-5 | U-PB-18; E2E-PB-14 | UI: `import-stale-notice` visible, no `merge-summary` block and no "No changes" text, metadata and save result shown, notice still visible after Retry save. P1: stored state includes the imported data |
| AC-PB-013-6 | E2E-PB-01 (duplicate step) | UI: `merge-summary` text "No changes" after importing the same file twice |
| AC-PB-014-1 | U-PB-13; E2E-PB-04 | UI: `import-result` `data-import-code`=`DocumentIdentityMismatch`, text names the other board and the open board |
| AC-PB-014-2 | U-PB-13; E2E-PB-04 | UI: code `AppIdentityMismatch`, text names `fieldledger` |
| AC-PB-014-3 | U-PB-13; E2E-PB-04 | UI: truncated file gives `Malformed`, byte-flipped file gives `ChecksumMismatch`, each with its message |
| AC-PB-014-4 | U-PB-13; E2E-PB-04 | UI: file of 16 MiB + 1 byte gives `OversizedRaw`; version byte 2 gives `UnsupportedVersion` |
| AC-PB-014-5 | U-PB-13; E2E-PB-04 | UI: message ends "Nothing was changed."; `readUiBoard` before equals after; `save-indicator` text and sequence equal. P1: record `sequence` and `bytes` equal before and after |
| AC-PB-014-6 | E2E-PB-04 | UI: the Transfer section contains "not authenticated" |
| AC-PB-015-1 | U-PB-10 (diff); E2E-PB-01 | UI: `merge-summary` on A lists "Title changed" and "Notes changed" for X; on B lists "Moved: Draft spec v2, To do to Doing". Derived from real models (unit asserts the summary function input is `listResults()` output) |
| AC-PB-016-1 | U-PB-10; E2E-PB-08 | UI: `invalid-cards` contains rows with "Conflicted or incomplete card" and the preserved fields as text (`key: value`); columns do not contain them |
| AC-PB-016-2 | U-PB-10; E2E-PB-08 | P1: before any click, the invalid records' raw fields equal the Node capsule's; after reload still equal |
| AC-PB-016-3 | U-PB-11 restore.test.ts; E2E-PB-08 | Unit: literal fallbacks. UI (keyboard, design 13.5 E2E-PB-08): `Enter` on "Restore card: card-inv1" turns the row into a normal card in `column-doing` titled "Untitled card" with notes empty, `data-save-state`=`saved`; `Enter` on "Restore card: Bad placement" gives a normal card in `column-todo` after `card-ok1`. P1: stored fields equal the literals |
| AC-PB-016-4 | U-PB-11; E2E-PB-08 | UI (keyboard): `Enter` on "Discard card: card-inv1" shows "Confirm discard: card-inv1" and "Keep incomplete card: card-inv1"; `Enter` on Keep leaves the row and the record; `Enter` on Discard then Confirm removes the row. P1: record absent and the other stored cards unchanged |
| AC-PB-017-1 | E2E-PB-03 (A-01 to A-11); E2E-PB-04 (A-12); E2E-PB-05 (A-13, A-14); E2E-PB-08 (A-22, A-23); E2E-PB-10 (A-18); E2E-PB-12 (A-17); E2E-PB-13 (A-15); E2E-PB-14 (A-16, A-19); E2E-PB-15 (A-14 in recovery, A-20, A-21); E2E-PB-20 (A-04). All PLANNED | Per action (inventory table in design 13.5.1, each row names the scenario step and the observable result): the control gets `focus()` (or Tab), then ONE `keyboard.press("Enter")` (Space for A-07 Move up, A-09 and A-23 Confirm, as marked) and the result asserted is NOT focus: e.g. Restore -> normal card in `column-todo` or `column-doing` with the documented fallbacks and `data-save-state`=`saved`; Discard card + Confirm discard -> row gone and record absent; Change board -> `html[data-session]`=`join` and the previous board closed; Update now -> `performance.timeOrigin` changes, `data-offline-state`=`ready`, same board data. A-12: reachability only (focus, `outline-width` 3px, accessible name "Import capsule file (.gscap)"); import driven by `setInputFiles`; the file chooser is not driven |
| AC-PB-017-2 | E2E-PB-03; E2E-PB-08 | UI: `getByRole("button", {name: "Move to Doing: Alpha", exact: true})`, `Restore card: card-inv1`, `Discard card: Bad placement` etc. each resolve to exactly one element; no button in the app has the bare accessible name "Restore" or "Discard"; per-card buttons of two different cards never share a name |
| AC-PB-017-3 | U-PB-19 announce.test.ts; E2E-PB-03 | UI: after each key action, `document.activeElement.closest("[data-card-id]")` has `data-card-id` of the moved card; `document.activeElement` is not `body` |
| AC-PB-017-4 | U-PB-19; E2E-PB-03 | UI: `[data-testid="announcer"]` text equals the literal announcements in design 9.4 |
| AC-PB-017-5 | E2E-PB-03 | UI: `getComputedStyle(focusedButton).outlineWidth` is `3px` |
| AC-PB-017-6 | E2E-PB-16 | UI: at 320 x 640 and 1280 x 800, `documentElement.scrollWidth - clientWidth <= 0`; at 320 px the three column sections are stacked (same `offsetLeft`) |
| AC-PB-018-1 | U-PB-10 (render helper); E2E-PB-08 | UI: a card titled `<img src=x onerror=alert(1)>` renders as that literal text; `document.querySelectorAll("img").length` is 0 |
| AC-PB-018-2 | D-PB-01; E2E-PB-17 | `dist/index.html` has the CSP meta; the request recorder sees only same-origin URLs |
| AC-PB-018-3 | E2E-PB-04; U-PB-18 | Covered by AC-PB-013-1 and AC-PB-014-1 to 5: size check before read, specific rejection per check, no mutation |
| AC-PB-019-1 | D-PB-01; typecheck | `tests/dist-scan.test.ts` and a source scan test assert no import path under `src` contains `packages/` or `/src/` of a package; typecheck resolves the built entries |
| AC-PB-019-2 | tasks 8.1 and 8.3 | `git status --short -- packages` is empty; the lockfile diff adds only the `apps/patchboard` importer |
| AC-PB-019-3 | task 8.3 (fresh snapshot) | Every command in tasks section 5 exits 0 in the snapshot; totals recorded |
| AC-PB-020-1 | D-PB-01 | `dist-scan.test.ts` finds none of the banned strings in `dist/**` |
| AC-PB-020-2 | E2E-PB-05 | `storedState(page).record.sequence` equals `saveSequence(page)` and the stored texts match BEFORE `armAbort(page)` is called |
| AC-PB-021-1 | U-PB-08 (PLANNED) | Model-helper detector `writtenFields(before, after)` equals `["placement"]` for moves to each column, for a card holding only supported fields |
| AC-PB-021-2 | U-PB-21 `tests/controller-stale-move.test.ts` (PLANNED, production controller path) | `controller.model` holds title "Original title" (precondition asserted) while the store holds "Edited elsewhere" and "Notes edited elsewhere"; after `controller.move("card-s1", "doing")` the raw stored placement is `doing|00001024`, title and notes are still the newer values, `writtenFields(before, after)` equals `["placement"]`, and the `put` spy saw exactly one call carrying the newer title and notes |
| AC-PB-021-3 | U-PB-21 (negative control); U-PB-08 (helper control) | The naive controller-model writer yields `["notes","placement","title"]`, the stored title reverts to "Original title", and `assertStaleSafe` THROWS for it; the helper-level naive writer yields the same literal set |
| AC-PB-021-4 | U-PB-21 (`reorder`, `saveCard`); U-PB-08 (renormalize, edit-form helper) | `controller.reorder("card-s1", 1)` gives `["placement"]` and `todo|00003072` with the newer title kept; `controller.saveCard("card-s1", {notes:"My notes"})` gives `["notes"]` with the newer title kept; helper-level renormalize writes `placement` only; naive form writer flagged |
| AC-PB-021-5 | E2E-PB-01 | As AC-PB-007-1. End-to-end coverage only; a naive writer would also pass it when the replica's store matches its snapshot |

## 10. Requirement to test summary

| Requirement | Pure / Node tests | Browser (Playwright, Chromium) |
| --- | --- | --- |
| REQ-PB-001 | U-PB-01, U-PB-20 | E2E-PB-01, 17 |
| REQ-PB-002 | U-PB-02, U-PB-03, U-PB-20 | E2E-PB-01, 17 |
| REQ-PB-003 | U-PB-13, U-PB-20 | E2E-PB-10, 15 |
| REQ-PB-004 | U-PB-05, U-PB-08, U-PB-09, U-PB-22 | E2E-PB-03 |
| REQ-PB-005 | U-PB-04, U-PB-06, U-PB-07, P-PB-01 to 05 | E2E-PB-09, 03 |
| REQ-PB-006 | U-PB-08, U-PB-21, U-PB-22 | E2E-PB-01, 03, 06, 08, 20 |
| REQ-PB-007 | U-PB-09, P-PB-06 to 08 | E2E-PB-01, 02, 06, 07, 09 |
| REQ-PB-008 | U-PB-12 | E2E-PB-05, 17 |
| REQ-PB-009 | U-PB-17, U-PB-18 | E2E-PB-05, 13, 14, 15 (keyboard activation of Retry save, Dismiss, Reload app, Discard and switch) |
| REQ-PB-010 | U-PB-16 | E2E-PB-11, 12, 17, 19 (optional) |
| REQ-PB-011 | none (browser only) | E2E-PB-01, 17 |
| REQ-PB-012 | U-PB-14 | E2E-PB-01, 05 |
| REQ-PB-013 | U-PB-15, U-PB-18 | E2E-PB-01, 04, 05, 14 |
| REQ-PB-014 | U-PB-13 | E2E-PB-04 |
| REQ-PB-015 | U-PB-10 | E2E-PB-01 |
| REQ-PB-016 | U-PB-10, U-PB-11 | E2E-PB-08 (keyboard Restore and Discard) |
| REQ-PB-017 | U-PB-19 | E2E-PB-03, 04, 05, 08, 10, 12, 13, 14, 15, 16, 20 |
| REQ-PB-018 | D-PB-01 | E2E-PB-04, 08, 17 |
| REQ-PB-019 | D-PB-01 | tasks section 5 |
| REQ-PB-020 | D-PB-01 | E2E-PB-05 |
| REQ-PB-021 | U-PB-08, U-PB-21 | E2E-PB-01 (end-to-end only) |
