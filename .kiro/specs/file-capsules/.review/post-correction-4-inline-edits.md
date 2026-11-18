# Post-correction-4 inline edits (record only; not a review)

Status of the last independent review: `correction-4-verdict.json` = **CHANGES_REQUESTED**
(1 MEDIUM: F1 AC-CAP-006-1 contradiction; 2 NIT: F2 duplicate ownership test, F3 vacuous
merged-size assertion). That verdict is preserved unchanged.

After it, the three findings were fixed inline by the orchestrator at the user's explicit
request, with **no author/reviewer workflow**. There has been **no independent re-review**
of these edits, so this file records edits only and grants **no approval**.

| Finding | Inline edit | Files |
| --- | --- | --- |
| F1 (MEDIUM) | AC-CAP-006-1 and the REQ-CAP-006 intro scoped to capsule-content / documented operational `CapsuleError` codes; `TypeError` for programmer misuse retained (per-function table, AC-CAP-006-4) | requirements.md |
| F2 (NIT) | `buffer-ownership.test.ts` removed from the layout and traceability; consolidated into `snapshot-ownership.test.ts`; non-aliasing category kept as new AC-CAP-NFR3-3 (no renumbering) | requirements.md, design.md, tasks.md |
| F3 (NIT) | Arithmetic `2048 > 1024 - S1` replaced by measuring the actual post-import `PersistSession.exportBytes()` byteLength and asserting `S_merged > maxBytes` (1024) | requirements.md, design.md, tasks.md |

No planned test has been executed.
