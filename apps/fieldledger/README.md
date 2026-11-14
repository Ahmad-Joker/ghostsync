# FieldLedger

Offline incident reporting built on the GhostSync Kit, Persist and Capsule packages. One incident
workspace: incident details plus a checklist where every item is its own mergeable record.

## Commands (run from the repo root, use `pnpm.cmd` on Windows PowerShell)

```
pnpm -F @ghostsync/kit build
pnpm -F @ghostsync/capsule build
pnpm -F @ghostsync/persist build
pnpm -F @ghostsync/fieldledger typecheck
pnpm -F @ghostsync/fieldledger test          # unit + property tests (Vitest)
pnpm -F @ghostsync/fieldledger build         # production build into apps/fieldledger/dist
pnpm -F @ghostsync/fieldledger test:dist     # scan dist (after build)
pnpm -F @ghostsync/fieldledger test:e2e      # real Chromium, serves dist on port 4329
```

## How it works

- Join an incident by ID (trimmed, lowercased, 3 to 64 chars of `[a-z0-9._-]`). Each browser
  profile generates a replica ID once per (profile, document), stored in `localStorage`.
- Data is saved to IndexedDB through `@ghostsync/persist`. The save indicator reflects the real
  session state; "Saved locally" appears only when the session is `saved` with a confirmed sequence.
- Share work as `.gscap` files (Export / Import). Capsules are integrity-checked: a checksum
  detects corruption but does NOT authenticate the sender.
- If a capsule merges but saving fails, the app says so and offers Retry save and Download backup capsule.

## Offline

A service worker (adapted copy of the Persist harness plugin, cache prefix
`ghostsync-fieldledger-`) precaches the shell. The app shows "Ready to work offline" only when the
worker controls the page and the precache is complete. The first visit must be online.
A new worker waits until the user chooses "Update now" (pending edits are flushed first).
Service workers need HTTPS or `localhost`.

## Hosting

The MVP contract requires hosting at the origin root (`/`). The build uses `base: "./"`, so all
URLs are relative and the worker scope is relative; sub-path hosting also works and has an optional
extra test, but it is not required.

## Not in this milestone

QR transfer, PatchBoard, GhostSync Studio, schema editor.
