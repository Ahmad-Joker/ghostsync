---
inclusion: always
---

# Product

GhostSync is the Skeleton Crew deliverable: an offline-first sync toolkit plus example apps and an inspector.

## Deliverables

- **GhostSync Kit** (`@ghostsync/kit`, `packages/kit`) — the reusable offline sync foundation. All apps build on the Kit's public API; sync logic lives only here.
- **FieldLedger** (`@ghostsync/fieldledger`, `apps/fieldledger`) — offline incident reporting.
- **PatchBoard** (`@ghostsync/patchboard`, `apps/patchboard`) — offline kanban.
- **GhostSync Studio** (`@ghostsync/studio`, `apps/studio`) — inspector for replica changes and merge results.

## Transfer tiers

- **File transfer** — the reliable baseline. Always supported.
- **Small QR transfer** — follows the file baseline as the next tier.
- **Animated QR** — optional.
- **Schema editor** — optional.

All product capabilities are planned; only the monorepo scaffold exists so far.
