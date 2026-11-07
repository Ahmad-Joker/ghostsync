# sdk-foundation — MEDIUM-1 Correction Review (revision 5, two separate top-level maps)

**Scope:** independent, planning-only re-review of the documentation correction that resolves
revision-4 review finding **MEDIUM-1** by replacing the self-contradictory bare-vs-structured
discriminator with **two separate top-level shared `Y.Map`s in the same `Y.Doc`**
(`doc.getMap("root")` = legacy scalar map, `doc.getMap("ghostsync:records:v1")` = structured records
map). Reviewed `requirements.md`, `design.md`, `tasks.md`, the two `.review/` artifacts
(`spec-correction-verdict.json` / `spec-correction-review.md` and the superseded `review.md` /
`review.json`), and the revision-5 section of `docs/progress.md`, against the real baseline source at
`packages/kit/src/replica.ts`, `packages/kit/src/state.ts`, and `packages/kit/tests/projection.test.ts`.
No suites were run (planning milestone; instruction was not to re-run).

**This is a revision.** The prior review (`.review/spec-correction-verdict.json`, revision 4) returned
`CHANGES_REQUESTED` with **1 MEDIUM (MEDIUM-1) and 2 NITs (NIT-1, NIT-2)**. Each is re-checked below
against the corrected docs before reviewing what changed.

**Verdict: APPROVED** (0 HIGH, 0 MEDIUM, 2 NIT).

The correction is substantively sound and internally consistent across all three spec docs and the
progress log. The discriminator is removed entirely; map membership decides ownership; no legacy key is
reserved, rejected, escaped, or reclassified; notifications inspect both maps with at most one
notification per transaction; the two prior NITs are resolved. The remaining two NITs below are minor
and non-blocking.

---

## Re-check of prior review findings (revision 4 → revision 5)

- **MEDIUM-1 (getState() bare/structured separation self-contradictory and underspecified at the
  collision boundary) — CLOSED.** The discriminator is gone. The structured model now lives in its own
  top-level map `doc.getMap("ghostsync:records:v1")`; the legacy `root` map is untouched.
  - `design.md` §Compatibility and §Storage layout state `getState()` reuses the baseline `project(root)`
    unchanged, projecting **every** `root` key with no filtering, no sentinel inspection, no escaping, no
    reserved prefix. Verified against source: `src/state.ts` `project()` projects every `root` key onto a
    null-prototype object, and `src/replica.ts` uses `ROOT_MAP = "root"` with `getState()` = `project(this.#map())`.
  - The three disagreeing predicates are all removed from the operative text: "first char ≠ SENTINEL",
    "deterministic re-derivation; see below", and the tasks 3.1/3.2 dual `isStructuredKey`/`isBareKey`
    definitions. `tasks.md` 3.1 now explicitly says **do NOT export** `isStructuredKey`/`isBareKey`
    (map membership decides). Confirmed by grep: remaining hits of those phrases are only (a) prohibitions,
    (b) the historical `design.md` "Responses to review findings" note quoting the superseded predicate,
    or (c) the preserved `.review/review.md` / `spec-correction-review.md` artifacts.
  - The collision case MEDIUM-1 flagged (a legacy key byte-identical to a structured field key, e.g.
    `\u0001f\u001fcol\u001fE\u001ftitle`) is now explicitly defined as two unrelated values in two maps
    (AC-SDK-002-10) and pinned by planned collision test 1 (`key-escaping.test.ts`, task 9.8). The
    sentinel-prefixed legacy key case is defined valid (AC-SDK-002-11) and pinned by planned collision
    test 2. `projection.test.ts` (which uses `__proto__`/`constructor`/`toString`, none of which begin
    with `\u0001`) is unaffected and preserved unedited (T9.24).

- **NIT-1 (tx key-delta accessor described two ways) — CLOSED.** `design.md` §Lifecycle notifications and
  REQ-SDK-005 / AC-SDK-005-6 now state exactly one accessor, `transaction.changed.get(map)`
  (`Set<string|null>`; undefined/empty = no change), applied to `doc.getMap("root")` and
  `doc.getMap("ghostsync:records:v1")`. The vague "/ the keys delta" alternative is dropped. Tasks 6.3 and
  7.3 use the same single accessor.

- **NIT-2 (superseded "re-seed-on-throw" language in the prior `.review/review.md`) — CLOSED.** A dated
  `[2026 — SUPERSEDED NOTE, added during the revision-5 MEDIUM-1 correction]` block was added to the top
  of `.review/review.md`, labelling its revision-3 re-seed-on-throw description as superseded by the
  staging-and-swap (U6) strategy. The historical content is preserved unedited below the note (no
  deletion). Recorded as per `spec-correction-verdict.json` NIT-2.

---

## Findings (current revision)

### NIT-1 — User-request regression test 3 (`__proto__`/`constructor`/`toString` remain own snapshot properties) is covered only implicitly

The original task enumerates eight planned regression tests; item 3 is "`__proto__`, `constructor`, and
`toString` remain own snapshot properties." This is genuinely satisfied — AC-SDK-002-8 preserves the
null-prototype projection guarantee, and the existing `packages/kit/tests/projection.test.ts` (preserved
unedited via T9.24 and NFR-SDK-005) already asserts exactly this. However, neither `tasks.md` T9 nor the
coverage matrix names test 3 explicitly against the two-map layout, so a reader counting the eight
enumerated tests finds 1, 2, 4, 5, 6, 8 named in T9 but 3 and 7 only subsumed under "existing 37 tests /
projection.test.ts". This is a traceability-visibility gap, not a correctness gap.

**Concrete fix:** add one clause to `tasks.md` 9.8 (or 9.4a) noting that the null-prototype own-property
guarantee for `__proto__`/`constructor`/`toString` continues to hold under the two-map layout because
`getState()` still projects the unchanged `root` map via `project()`, cross-referencing the preserved
`projection.test.ts` (user-request test 3). Alternatively, add a one-line note in the coverage matrix
mapping user-request tests 3 and 7 to `projection.test.ts` + the preserved baseline suite (T9.24).

### NIT-2 — `docs/progress.md` git-setup header still names a stale branch

`docs/progress.md` opens with "Branch: `feat/kiro-steering`" in its "Git setup" section, while the active
branch for this work is `feat/sdk-foundation` (correctly named in every sdk-foundation section heading).
The stale top-of-file branch line predates this milestone and is not something this correction introduced,
but it is a minor inconsistency a reader of the progress log could trip on.

**Concrete fix:** optionally update the top "Git setup" note to reflect the current working branch, or add
a one-line "current branch: `feat/sdk-foundation`" clarifier. Out of strict scope for the MEDIUM-1
correction; recorded for hygiene. (Severity NIT; does not affect the verdict beyond its NIT weight.)

---

## Judgment against the authoritative decision and acceptance criteria

1. **Two maps in the same `Y.Doc` — MET.** `design.md` §Storage layout item 1/2 and the Overview define
   `doc.getMap("root")` (legacy scalar, `set/get/has/delete` operate directly, `getState()` projects every
   key) and `doc.getMap("ghostsync:records:v1")` (structured, name verbatim). Requirements Definitions and
   REQ-SDK-002 match; tasks 3.2/3.3 match. Baseline encoded-data restoration is preserved (the `root` map's
   encoded structure is unchanged; `baseline-fixture.test.ts` planned as 9.22). No legacy key is ever
   rejected or reserved, including sentinel-prefixed (AC-SDK-002-11) or byte-identical-to-structured
   (AC-SDK-002-10). Verified against `src/replica.ts` / `src/state.ts`.

2. **Structured records map internals scoped only inside it — MET.** Composite-key grammar, SENTINEL/SEP,
   NUL-introducer escaping, collection isolation, field-level merge, `SchemaIdentity` meta key, and
   deletion rules are all stated as internal to `ghostsync:records:v1` (design §Storage layout; AC-SDK-002-9
   explicitly scopes escaping to the records map and states it is never applied to or consulted for `root`).
   Both maps export together via full-state and differential encoding (design §"Both maps travel together";
   AC-SDK-003-2; task 7.3 snapshot serializes both).

3. **One consistent two-map layout across all three docs — MET.** No operative bare-vs-structured
   discriminator remains. Grep confirms "first char ≠ SENTINEL", "see below", "deterministic re-derivation",
   `__default__`, `isStructuredKey`, `isBareKey` survive only as prohibitions or historical/preserved-review
   quotations. The rejected-alternatives section correctly keeps `Y.Map<Y.Map<Scalar>>` / `entities.set(...)`
   references as *rejected* options, not operative design.

4. **No nested per-entity maps (defect A); no `__default__` map — MET.** Explicit prohibitions in design
   §Storage layout, §Compatibility, U1, and tasks 3.2/3.3.

5. **Notifications inspect both maps, ≤1 per transaction, zero for no-op — MET.** REQ-SDK-005 Observable-change
   definition, AC-SDK-005-1/2/6, design §Lifecycle notifications, and tasks 6.3/7.3 all state: derive from
   `transaction.changed.get(map)` for both maps, notify at most once per transaction iff the combined delta
   is non-empty, zero for an empty delta even though `afterTransaction` fires once (defect C preserved).

6. **NIT-1 accessor standardized; NIT-2 dated supersession note — MET** (see re-check above).

7. **Eight regression tests named, pending, none claimed passing — MET.** Tests 1, 2 (collision tests in
   9.8), 4, 5 (in 9.4a), 6 (in 9.15/9.16), 8 (in 9.22) are named and pending. Test 3 and test 7 are covered
   by the preserved baseline suite / `projection.test.ts` (T9.24) — see NIT-1 for the visibility gap. All
   `tasks.md` items remain `- [ ]`; no planned test is claimed passing. Stable requirement IDs
   (REQ-SDK-001..007, NFR-SDK-001..006) and EARS criteria retained.

8. **Defects A/B/C and prior corrections intact — MET.** Changed-fields `put` (REQ-SDK-003A, AC-SDK-003A-1/2/3,
   task 3.3), key-delta notifications (defect C), kind-gated state-vector/`applyUpdate` boundary with
   distinguishable reasons and no mutation/notification (design §Validation ordered boundary + error table;
   AC-SDK-007-3/4/5/8), and bounded staging-and-swap apply/recovery (design §Snapshot-and-swap; AC-SDK-007-6;
   U6) are all unchanged except for extending delta inspection to both maps. Not regressed.

9. **Only permitted files changed; nothing committed — MET (per reported git state).** The prior step's
   `git status --short --branch` showed only ` M docs/progress.md` tracked-modified, with the untracked
   `.kiro/specs/sdk-foundation/` (specs + `.review/`) and untouched `.agents/`. No source/test/steering/
   manifest/lockfile/app change; nothing staged or committed. I did not re-run git in this review; this is
   accepted on the reported log and is consistent with the on-disk file set I read.

---

## Verified Assumptions (read from source / confirmed in the docs)

- **Baseline `project()` projects every `root` key onto a null-prototype object** — confirmed in
  `packages/kit/src/state.ts`; matches AC-SDK-002-8 / NFR-SDK-005 reuse claim.
- **`ROOT_MAP = "root"`, `getState()` = `project(this.#map())`, `#assertAlive()` throws
  `"GhostSync Kit: replica has been destroyed"`, zero-length bytes → `invalidCarrier`** — confirmed in
  `packages/kit/src/replica.ts`; matches the design's baseline-API block and AC-SDK-005-5.
- **`projection.test.ts` asserts `__proto__`/`constructor`/`toString` project as exactly those keys** —
  confirmed; none begins with `\u0001`, so the two-map layout keeps that test green (the MEDIUM-1 collision
  concern cannot affect it).
- **Prior verdict was CHANGES_REQUESTED with MEDIUM-1 + NIT-1 + NIT-2** — confirmed in
  `.review/spec-correction-verdict.json`; all three are addressed in the corrected docs.
- **Dated supersession note present in `.review/review.md`** — confirmed (NIT-2 closed; history preserved).
- **Discriminator-phrase grep** — confirmed every operative occurrence removed; residual hits are
  prohibitions or preserved history.

## Unverified / Wrong Assumptions

- **Baseline commit `ab37419`** — the on-disk source content was read and matches the quoted signatures,
  but the specific commit hash was not checked against git history in this review. Low risk; the docs were
  judged against authoritative working-tree source.
- **Git cleanliness / permitted-file-set** — accepted on the prior step's reported `git diff --check` /
  `git status` output; not independently re-run here (planning-only, no-mutation review). Low risk; the set
  of files I read on disk is consistent with the report.
- **"37 tests / six properties pass"** — not re-run (no new tests exist yet; the planning docs correctly
  claim no new test passes). Presence/shape previously verified; not re-executed, per the no-run
  instruction.
- **No wrong assumptions found in the corrected documents** — every externally verifiable claim checked
  against source held true. The two NITs above are visibility/hygiene items, not false claims.
