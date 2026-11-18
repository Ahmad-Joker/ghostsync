---
inclusion: always
---

# Architecture

- `packages/kit` owns all shared sync logic (CRDT merge, capsule encode/decode, update application). Apps never reimplement sync.
- Each app stays in its own `apps/` folder and consumes only the Kit's public API.
- Plan for **Yjs** as the CRDT layer, with each app/device holding an **independent replica**.
- Keep **storage** and **transport** separate from **merge logic**. Merge is a pure function of updates; storage and transport are pluggable and swappable.
- Treat **IndexedDB persistence** and **offline app loading** as separate concerns; do not entangle them with sync or with each other.
