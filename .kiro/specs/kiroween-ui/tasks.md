# kiroween-ui — Tasks

> **RECONSTRUCTED.** This file was reconstructed on 2026-11-17 after an accidental deletion. It was rebuilt from session records. It was **not** restored from an original copy: the files were untracked, so git never held one. Sources: the recorded tool calls in the agent session logs, replayed by `.agents/tasks/ui-kiroween/recover-specs.mjs`, `recover-finish.ps1` and `fix-tasks.ps1` (intermediate copies in `.agents/tasks/ui-kiroween/recovered/`); `pb-results.md`, `fl-results.md`, `final-results.md`, `final-review.md`, `mobile-pass.md` and `mobile-review.md`; `docs/progress.md`; `.kiro/steering/ui.md`. The tick states were checked against those records in the PR-preview check (2026-11-17). Which run proved each individual tick was never recorded and cannot be recovered. See **Recovery confidence** in `design.md`.

Original note (kept): all tasks started as PLANNED. A box is ticked only after the run that proves it is recorded in `docs/progress.md`. Nothing is staged or committed by this work. Do not touch `packages/**`, `apps/*/src/session/**`, `apps/*/src/offline/sw-register.ts`, `apps/*/scripts/sw-precache-plugin.ts`, `qr-controller.ts`, `qr-errors.ts`, `transfer-mode.ts` or the pure copy modules.

## Phase 0 — Specs, inventory, before screenshots (step 1)
- [x] T0.1 — Confirm `HEAD` is `f55f359` and the tree is clean apart from untracked `.agents/` and `.review-artifacts/` (EV-REVIEW).
- [x] T0.2 — Write the brief to `.agents/tasks/ui-kiroween/brief.md`.
- [x] T0.3 — Re-verify and extend the contract inventory in `.agents/tasks/ui-kiroween/contracts.md` before any source edit.
- [x] T0.4 — Capture BEFORE screenshots of the f55f359 build with `GS_SCREENSHOT_DIR` into `.agents/tasks/ui-kiroween/before/` (both apps' `screenshots.spec.ts`; PatchBoard 9 passed, FieldLedger 6 passed; variable unset afterwards).
- [x] T0.5 — Create this spec (`requirements.md`, `design.md`, `tasks.md`).
- [x] T0.6 — Steering: add one "Visual identity" bullet to `.kiro/steering/ui.md` (front matter unchanged). Recorded here; the edit is a single added bullet.

## Phase 1 — Shared foundation (PatchBoard first)
- [x] T1.1 — Add palette, type and spacing custom properties, hero, paper panel, torn-edge, chip, step-list and banner styles to `ghostsync-theme.css`; copy byte-identical to FieldLedger; keep the header, first-declaration 3px focus ring, `[hidden]` rule and reduced-motion block. (REQ-KW-001, 012)
- [x] T1.2 — Add the symbol sprite (`gs-courier`, `gs-courier-sm`, `gs-courier-step-*`, `gs-moon`, `gs-phone`, `gs-laptop`, `gs-capsule`) between `gs-sprite` comments in both `index.html` files; add `ui/icon.ts` (template `innerHTML` of a constant string; no namespace string). (REQ-KW-002)
- [x] T1.3 — Unit tests: KW-UNIT-CONTRAST, KW-UNIT-SPRITE-PARITY, update KW-UNIT-THEME-PARITY. Run both apps' unit suites. (EV-UNIT)

## Phase 2 — PatchBoard
- [x] T2.1 — Hero: markup, grid layout, art, headline, supporting line, field, hint, button, `See how it works`; viewport meta and safe-area padding together; `dvh` fallbacks; short-viewport art hiding. (REQ-KW-003, 004, 011)
- [x] T2.2 — Help and reveal: share one three-step set; keep `#guidance` contract; credit text `Built with Kiro for Kiroween`; update `guidance.spec.ts` with equivalent coverage. (REQ-KW-004, 015)
- [x] T2.3 — Header and readiness-once presentation; `ui/offline-banner.ts` (pure) and banner element with reserved slot and one-shot lantern animation started from the existing offline callback. (REQ-KW-005, 007)
- [x] T2.4 — Workspace: board-centred layout, column counts, Add card placement, `Share`/`Import` shortcuts. (REQ-KW-006)
- [x] T2.5 — QR: sender stage and detail layout; `ui/qr-steps.ts` and step list in `qr-view.ts` (markup only); receiver review and import result outcome line. (REQ-KW-008, 009)
- [x] T2.6 — New tests: E2E-KW-PB-01..15 (as shipped 01..13 and 15; there is no E2E-KW-PB-14, its credit check is inside E2E-KW-PB-04; per `pb-results.md`; corrected in the PR-preview check), KW-UNIT-QR-STEPS, KW-UNIT-BANNER, KW-DIST-ASSETS; update `overlap.ts`/`overlap-audit.spec.ts` and `screenshots.spec.ts` (viewport set 320x568, 390x664, 430x739, 430x932, 1280x800, new states). Run PatchBoard typecheck, unit, build, dist, full Chromium twice.

## Phase 3 — FieldLedger
- [x] T3.1 — Hero-lite, small header, readiness-once, offline banner, See how it works / Help, credit. (REQ-KW-005, 007, 010, 015)
- [x] T3.2 — Notebook workspace: field-report header, checklist notebook lines, completion text marker, long-title room with `.fl-record-full` fallback; keep `NOTICE_MIN_VISIBLE_MS`. (REQ-KW-010)
- [x] T3.3 — New tests: E2E-KW-FL-01..08, KW-DIST-ASSETS; update guidance, overlap and screenshots specs. Run FieldLedger typecheck, unit, build, dist, full Chromium twice.

## Phase 4 — Evidence and review
- [x] T4.1 — Capture AFTER screenshots under `.agents/tasks/ui-kiroween/after/` for every state in the brief; open and inspect before and after images (the set actually viewed is listed in `index.md`; the rest were covered by the programmatic audits); fix and re-capture; write `index.md`. (EV-REVIEW)
- [x] T4.2 — `@ghostsync/qr-transfer` tests once; `git status` for `packages/` and controllers empty; `git diff --check`; EOF-newline scan of new files; scan for `.only`/`.skip`/retries/timeout changes, remote URLs, LAN IPs, secrets. (REQ-KW-014)
- [x] T4.3 — Append the dated "Kiroween redesign (hero-led)" section to `docs/progress.md` with a results table and four separate evidence rows (EV-UNIT, EV-FIXTURE, EV-DIST, EV-PHYS NOT RUN) and the list of changed earlier-pass test files with reasons.
- [x] T4.4 — Add "Re-test the redesigned build on your iPhone" to `docs/qr-physical-test.md` (hero action without scrolling, Safari toolbar, keyboard, offline banner, QR sender stage, scan-review-import, camera scan of the unchanged QR); nothing marked as run.
- [x] T4.5 — Independent review: re-run both full suites, diff `contracts.md` against the final DOM and tests, confirm every MUST maps to a test that ran, and fix findings. (Unticked in the rebuild; `final-review.md` records it as done, with APPROVED, no blockers, and its own runs in `logs/rev-*.txt`: PatchBoard 69, FieldLedger 43. Ticked in the PR-preview check.)

## Mobile usability pass (REQ-KW-016)
- [x] T5.1 - Scroll the scan panel into view and focus the review heading once per transition into review (`qr-view.ts`). Three older assertions of `qr-import-btn` focus now assert `qr-review-heading` (`qr-transfer.spec.ts`, `qr-camera.spec.ts`, `kiroween.spec.ts`), because the requested behaviour moves focus.
- [x] T5.2 - Reorganise the review block (board, size, warning, actions, Details); no sticky bar.
- [x] T5.3 - First-visit hero breathing room in both apps (CSS only); readiness and notice below the action.
- [x] T5.4 - Add `e2e/mobile-pass.spec.ts` in both apps; re-capture screenshots; write `mobile-pass.md`.
- [ ] T5.5 - EV-PHYS on a real iPhone (user): review scroll and focus, Import without scrolling, Details closed, hero with the real keyboard.

## PR-preview prep (2026-11-17)
- [x] T6.1 - Mark these three files RECONSTRUCTED, check every AC row against the tests and code, correct mismatches, and add Recovery confidence (`design.md`).
- [x] T6.2 - Visual QA of the desktop QR sender, imported result, keyboard-open and 320px screenshots (`.agents/tasks/ui-kiroween/preview-qa.md`). Fixes: `Go to file export` under the too-narrow/too-large message (AC-KW-016-9, E2E-MP-PB-08); supporting line hidden at a visual viewport of 26rem or less in both apps; new FieldLedger keyboard-open captures (SHOT-FL-13).
- [x] T6.3 - Both apps: typecheck, unit, build, test:dist, full Chromium twice; qr-transfer once. Results in `docs/progress.md` ("Kiroween PR-preview prep").
- [ ] T6.4 - EV-PHYS on the PR preview (user), as T5.5.
## Evidence status (updated only by recorded runs)

| Label | Status |
| --- | --- |
| EV-UNIT | Ran: PatchBoard 273 passed, FieldLedger 137 passed, qr-transfer 90 passed (exit 0) |
| EV-FIXTURE | Ran (Chromium emulation, never physical): PatchBoard 69 passed twice, FieldLedger 43 passed twice (exit 0) at the redesign step; 77 and 45 after the mobile pass; 78 and 46 twice after the PR-preview check; after screenshots under .agents/tasks/ui-kiroween/after/ |
| EV-DIST | Ran: PatchBoard 14 passed, FieldLedger 8 passed (exit 0) |
| EV-PHYS | NOT RUN for this build; only the user can record it on a real iPhone |

## Steering edit record

`.kiro/steering/ui.md`: one bullet appended, "Visual identity", describing the illustrated midnight field guide palette, display type in the hero only, the single shared courier symbol set, decoration kept out of the QR canvas and controls, and reduced-motion respect.
