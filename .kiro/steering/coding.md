---
inclusion: always
---

# Coding

- **Strict TypeScript.** No `any` by default; a `strict` tsconfig. The Kit exposes clear, versioned public interfaces and keeps internals private.
- Use the **pinned package manager**: `pnpm@10.34.9` (via the root `packageManager` field). Do not introduce other package managers or lockfiles.
- Keep the **dependency graph simple and minimal** — few, well-maintained dependencies; prefer the platform and the Kit over adding libs.
- **Preserve existing behavior when refactoring.** Refactor behind tests; do not change public contracts without updating consumers and tests.
