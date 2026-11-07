# GhostSync Kit + GhostSync Studio

GhostSync Kit is a reusable offline sync SDK, and GhostSync Studio is an inspector for that sync. The two are built for Kiroween 2026 — Skeleton Crew. The Kit is intended to provide the primitives for offline-first data synchronization, while Studio is intended to make that sync observable and debuggable.

## Repository layout

- `packages/kit` — `@ghostsync/kit`, the reusable offline sync SDK.
- `apps/fieldledger` — `@ghostsync/fieldledger`, an example application using the Kit.
- `apps/patchboard` — `@ghostsync/patchboard`, an example application using the Kit.
- `apps/studio` — `@ghostsync/studio`, GhostSync Studio, an inspector for sync.

## Scaffold status

This is a scaffold-only step. The monorepo structure, workspace configuration, and license are in place. All product features — the offline sync engine in the Kit, the FieldLedger and PatchBoard example applications, and the GhostSync Studio inspector — are planned and not yet implemented. No source code has been added in this step.

## Workspace

This is a pnpm workspace covering `packages/*` and `apps/*`. The package manager is pnpm@10.34.9.
