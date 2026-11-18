# PatchBoard

Offline kanban board built on GhostSync Kit. One shared board, three fixed columns (To do, Doing, Done), and
cards with a title and optional notes. Cards can be added, edited, moved between columns, reordered and
deleted. Every control works from the keyboard (native buttons). Drag-and-drop is not part of the MVP.

## Build and run

The app consumes the BUILT public entries of the shared packages, so build them first (from the repo root):

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd -F @ghostsync/kit build
pnpm.cmd -F @ghostsync/capsule build
pnpm.cmd -F @ghostsync/persist build
pnpm.cmd -F @ghostsync/patchboard build
pnpm.cmd -F @ghostsync/patchboard preview   # http://localhost:4339
```

Checks: `typecheck`, `test` (unit and property tests), `test:dist` (after `build`), `test:e2e` (real Chromium,
serves the built `dist`).

## Data model

- The board ID is the document ID used by the Kit, Persist and Capsule. Each browser profile keeps its own
  stable replica ID per board in `localStorage`.
- Each card is its own record with three string fields: `title` (1 to 120 characters), `notes` (0 to 2000,
  `""` when empty) and `placement`.
- `placement` holds the column and the position together: `<column>|<8-digit position>`, for example
  `doing|00001024`. Columns are `todo`, `doing`, `done`; positions run from `00000001` to `99999999`.
  Within a column, cards sort by position, then by card ID.
- A move or reorder reads the current stored card by ID and changes only `placement`. A title or notes edit
  changes only the fields that were edited and keeps the current placement.
- Stored fields PatchBoard does not know are ignored when reading and removed by the next write to that card.

## Merging

The Kit merges per field. Changes to different fields of a card, or to different cards, are both kept. If two
people change the same field of a card while offline, one of the two values is kept; which one is not decided
by clock time. Two concurrent moves of the same card give one placement and never a duplicate card.

Observed Kit behavior (characterization, 2026-11-14, baseline `690cffd`): a card that was deleted on one device
and edited or moved on another came back on both devices as a "Conflicted or incomplete card" holding only the
edited field. Use "Restore card" or "Discard card" to repair it. Nothing is repaired automatically.

## Offline use

- The first visit must be online. The app reports "Ready to work offline." only after the service worker
  controls the page and its precache is complete.
- Offline use needs HTTPS or localhost. Root hosting is the supported layout.
- Edits save to this device (IndexedDB). The save indicator shows the real save state.

## File transfer

"Export capsule (.gscap)" downloads the whole board. "Import capsule file (.gscap)" merges a capsule into the
open board. Capsules for another board or another app are rejected and nothing is changed.

Capsule files are integrity-checked: a checksum detects corruption. They are not authenticated: a checksum does
not prove who sent a file.

## Out of scope

Drag-and-drop, QR transfer, conflict history, card archiving, multiple boards per view, accounts and
authentication.
