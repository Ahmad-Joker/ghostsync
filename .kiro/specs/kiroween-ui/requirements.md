# kiroween-ui — Requirements

> **RECONSTRUCTED.** This file was reconstructed on 2026-11-17 after an accidental deletion. It was rebuilt from session records. It was **not** restored from an original copy: the files were untracked, so git never held one. Sources: the recorded tool calls in the agent session logs, replayed by `.agents/tasks/ui-kiroween/recover-specs.mjs` and `recover-finish.ps1` (intermediate copies in `.agents/tasks/ui-kiroween/recovered/`); `brief.md`, `contracts.md`, `pb-results.md`, `fl-results.md`, `final-results.md`, `mobile-pass.md` and the four review records in `.agents/tasks/ui-kiroween/`; `docs/progress.md`; `.kiro/steering/ui.md`; `docs/qr-physical-test.md`. On 2026-11-17 (PR-preview prep) the content was checked against the current code and tests, and factual mismatches were corrected; those corrections are marked "(corrected in the PR-preview check)". See **Recovery confidence** in `design.md` for what is verified and what could not be recovered.

## Overview

Status (original planning note, kept): written as PLANNED at baseline commit `f55f359`, branch `feat/qr-transfer`. Current status: implemented and tested in the uncommitted working tree. The recorded runs are in `docs/progress.md`. EV-PHYS is still NOT RUN.

Replace the charcoal-and-amber "working tool" look of PatchBoard and FieldLedger with one hero-led visual identity, "illustrated midnight field guide" (ink-purple, warm paper, Kiro-inspired violet, a little lantern amber). The previous passes (`9d010a7`, `f55f359`) were reported by the user as "still looked like a settings page" on an iPhone 14 Pro Max. This is a **presentation, illustration and guidance pass only**. Sync, save, import, offline, QR encode/decode, persistence, capsule and merge behaviour do not change.

Scope: `apps/patchboard` first, then `apps/fieldledger`, with shared tokens in the byte-identical `styles/ghostsync-theme.css`. Out of scope and untouched: `packages/**`, `apps/*/src/session/**`, `apps/*/src/offline/sw-register.ts`, `apps/*/scripts/sw-precache-plugin.ts`, `apps/*/src/transfer/qr/qr-controller.ts`, `qr-errors.ts`, `transfer-mode.ts`, the pure copy modules (`status-copy`, `save-label`, `errors`, `announce`, `capsule-meta`, `diff`, `status-text`) and their unit tests.

Inventory of what must survive: `.agents/tasks/ui-kiroween/contracts.md` (extends `.agents/tasks/ui-polish/contracts.md` and `.agents/tasks/ui-redesign/contracts.md`). The brief is `.agents/tasks/ui-kiroween/brief.md`.

### Evidence labels (kept separate in every report)

- **EV-UNIT**: Node unit and property tests (vitest). No DOM.
- **EV-FIXTURE**: Chromium Playwright tests against the built `dist`, including iPhone-sized viewport EMULATION (isMobile, hasTouch, deviceScaleFactor 3, iPhone user agent) and the shrunk-viewport keyboard emulation. **Emulation is never iPhone or Safari evidence.** Chromium is not WebKit.
- **EV-DIST**: static scan of `dist/` and `precache-manifest.json` after a production build (`test:dist`).
- **EV-PHYS**: a person using a real iPhone (Safari toolbars, keyboard, camera, VoiceOver). **NOT RUN for this build** until the user records it. No automated test writes, infers or reports it. The earlier PHYS-QR-01 PASS (2026-11-16) applies to the commit tested then, not to this redesigned build.
- **EV-REVIEW**: inspection of a screenshot, diff or document with a recorded command or checklist.

Normative words: **MUST** = requires a named test and an exact observation in the AC table (`design.md`). **SHOULD** = reported with a measured number, not gated.

### Palette and contrast plan (AA)

Computed with the WCAG 2.x relative-luminance formula (a node one-liner during spec writing; the planned unit test `KW-UNIT-CONTRAST` recomputes the same pairs from the CSS tokens so the numbers cannot drift). Target tokens (hex values may be adjusted during implementation only if every pair stays at or above its threshold; the test is the authority):

| Pair (foreground on background) | Tokens | Ratio | Needed |
| --- | --- | --- | --- |
| Body text on ink | paper `#f4ead6` on ink `#1a1230` | 14.99 | 4.5 |
| Body text on raised ink | paper on ink-2 `#251a45` | 13.40 | 4.5 |
| Muted text on ink | `#c4b9e6` on ink | 9.74 | 4.5 |
| Muted text on raised ink | `#c4b9e6` on ink-2 | 8.71 | 4.5 |
| Body text on paper | `#2b2142` on paper `#f4ead6` | 12.57 | 4.5 |
| Muted text on paper | `#5a4d78` on paper | 6.35 | 4.5 |
| Muted text on deeper paper | `#5a4d78` on paper-2 `#e9dcc0` | 5.59 | 4.5 |
| Primary button text | white on deep violet `#5b21b6` | 8.98 | 4.5 |
| Amber button text | ink on lantern amber `#ffbf47` | 10.91 | 4.5 |
| Link/accent text on ink | light violet `#b69cff` on ink / on ink-2 | 7.83 / 7.00 | 4.5 |
| Chip text OK on ink-2 | `#7ee2a8` on ink-2 | 10.16 | 4.5 |
| Chip text error on ink-2 | `#ff9d9d` on ink-2 | 8.05 | 4.5 |
| Chip text OK on paper | `#14683a` on paper | 5.73 | 4.5 |
| Chip text error on paper | `#9b1c1c` on paper | 6.83 | 4.5 |
| Focus ring on ink | amber `#ffbf47` on ink / ink-2 | 10.91 / 9.75 | 3.0 |
| Focus ring on paper | deep violet `#5b21b6` on paper / paper-2 | 7.52 / 6.61 | 3.0 |
| Amber outline on a deep-violet button | `#ffbf47` on `#5b21b6` | 5.47 | 3.0 |

As shipped (corrected in the PR-preview check): the implemented tokens differ from these planned hex values, as the note above allows. For example ink `--gs-bg` is `#1a1033`, paper `--gs-paper` is `#f3e9d2`, violet `--gs-violet` is `#7f3dff`, amber `--gs-amber` is `#f2b640`, and focus `--gs-focus` is `#ffd98a`. The ratios in this table are therefore the planning numbers, not measurements. KW-UNIT-CONTRAST checks 40 pairs computed from the shipped CSS, and all of them pass. The recorded values are in `.agents/tasks/ui-kiroween/pb-results.md` and `docs/progress.md` (for example body text on ink 15.99, primary button text 5.23, focus ring on the violet button 3.87, and the violet button against paper 4.33, a non-text boundary with a 3.0 minimum).

Known failing pairs that MUST NOT be used for text (planning note, for the planned tokens): violet `#8d5cf6` on ink is 4.26 and on ink-2 is 3.81 (decorative or graphic use only, graphics need 3.0), and deep violet `#5b21b6` on ink is 1.99 (a deep-violet button on an ink surface MUST carry a paper or amber border; the border, not the fill, carries the 3.0 boundary).

## Requirements

Recovery confidence per requirement, AC and design section: see the **Recovery confidence** section at the end of `design.md`.

### REQ-KW-001 — Visual identity and tokens
As a user, I want the apps to look like one deliberately designed illustrated field guide.
- **AC-KW-001-1 (MUST)** The palette (ink-purple, warm paper, Kiro-inspired violet, lantern amber) and spacing/type scales are CSS custom properties in the shared `ghostsync-theme.css`; the two copies stay byte-identical and keep the header, `SINGLE SOURCE OF TRUTH`, the first-declaration 3px `:focus-visible` rule, the verbatim `[hidden]` rule, no `outline: none`, and the reduced-motion block.
- **AC-KW-001-2 (MUST)** Display type (a system serif stack, for example Iowan Old Style, Palatino, Georgia, serif) is used in the hero headline only; everything inside the apps (controls, board, checklist, alerts) uses the system sans stack; text inputs are at least 16px so iOS Safari does not zoom.
- **AC-KW-001-3 (MUST)** No remote resource of any kind: no external font, image, CDN, analytics, `@import url(http...)`, `@font-face` pointing off-origin, or `data:` font. Runtime requests are same-origin only. No font file is bundled.
- **AC-KW-001-4 (MUST)** The Kiro logo and mascot are not reproduced. Only a hue inspired by Kiro's violet is used, and the text credit (REQ-KW-015) carries no logo.
- **AC-KW-001-5 (MUST)** Each screen has one visual focal point: the hero composition (first screen), the board (PatchBoard workspace), the checklist (FieldLedger workspace), the code stage (QR sender), the three-step sequence (QR receiver).

### REQ-KW-002 — Ghost courier and shared symbol set
- **AC-KW-002-1 (MUST)** An original ghost courier (friendly ghost, violet lantern, sealed capsule with wax seal or glyph) is defined once as an SVG symbol set in static markup (`index.html` sprite), with variants (hero pose, small offline pose, step poses) that are all `<use>` references to that set. No `<img>`, no external file, no `createElementNS` and no namespace URL in application JavaScript (PatchBoard's entry bundle may contain only the existing Yjs URL).
- **AC-KW-002-2 (MUST)** Decorative SVG is `aria-hidden="true"` and `focusable="false"`. Any SVG that carries meaning has a concise `<title>` and the same meaning is also available as text.
- **AC-KW-002-3 (MUST)** The sprite block is byte-identical in both apps' `index.html`.
- **AC-KW-002-4 (MUST)** The hero shows the courier crossing the gap between two device silhouettes (phone and laptop/tablet) along a dotted flight path under a crescent moon. The torn-paper edge is SVG or CSS `clip-path` on a layer that is not a control or QR ancestor.
- **AC-KW-002-5 (MUST)** The same character appears in the offline banner and in the QR receiver sequence.

### REQ-KW-003 — PatchBoard hero (first screen)
- **AC-KW-003-1 (MUST)** The join view contains the headline `When the signal dies, the work goes on.` and the line `Edit your board offline. Share updates by QR code or file.` The page keeps exactly one `h1` (the app name in the small header); the headline is a heading of lower level or a styled paragraph, so `h1` count stays 1.
- **AC-KW-003-2 (MUST)** The hero holds one labelled field (visible label `Board ID`, accessible name unchanged, `#board-id`), placeholder `e.g. sprint-board`, the hint `Use the same board ID on both devices.`, and the button `Open board`. The 3 to 64 character rule stays as secondary helper text and the `#board-error`, `#board-preview` (`Will open: <id>`) and `aria-describedby` wiring are unchanged.
- **AC-KW-003-3 (MUST)** On desktop (1280x800) the copy and the action sit beside the illustration (the text column's right edge is at or left of the illustration's left edge); below the stack breakpoint they stack.
- **AC-KW-003-4 (MUST)** The Board ID field and `Open board` are fully visible without scrolling at 390x664 and 430x739 (bottom edge of `Open board` at or above the viewport height), and also at 320x568. At 320x480 the same controls are reachable; the scroll needed is measured and reported (SHOULD: at most 120px).
- **AC-KW-003-5 (MUST)** The join view stays outside `<main>`; no overlay or modal; nothing takes focus on load (`document.activeElement` is `body`); the first-visit notice, status and illustration never cover the field or the button.
- **AC-KW-003-6 (MUST)** The first-visit notice `Opening PatchBoard offline for the very first time will not work. Open it once while online.` keeps its `hidden` semantics (visible until offline-ready, then hidden).

### REQ-KW-004 — "See how it works" and Help
- **AC-KW-004-1 (MUST)** A secondary `See how it works` control reveals three small illustrated steps (offline editing, sharing, importing), each with the courier variant. It is closed on load, never takes focus on open, and never covers the field or the button.
- **AC-KW-004-2 (MUST)** It is keyboard-operable (Enter and Space), exposes `aria-expanded` and `aria-controls`, Escape and the close control close it, and focus returns to the control that opened it.
- **AC-KW-004-3 (MUST)** The existing Help control (exact name `Help`) stays reachable from the header on the join view and the workspace with `aria-expanded` false by default, `#guidance` with heading `How GhostSync works`, exactly three `listitem` elements inside `#guidance`, the exact `Close help` button, Escape closing, focus returning to Help, nothing written to `localStorage["ghostsync.<app>.ui.guidance"]`, and it works when that key is denied. The relocated explanation and the Help panel share one set of steps; only one element matches `#guidance`.
- **AC-KW-004-4 (MUST)** In the workspace with Help open, cards (or checklist items) can still be added.

### REQ-KW-005 — Small header and offline readiness shown once
- **AC-KW-005-1 (MUST)** The header holds only the small mark, the wordmark, the app `h1` and Help. The brand `h1` text still contains the app name.
- **AC-KW-005-2 (MUST)** Offline readiness is presented as ONE visible cue at any time. `network-chip` (exact `Network: online|offline`), `offline-indicator` (exact state copy, `Ready to work offline.` when ready, with `data-offline-state`), `first-visit-notice` and `#status-note` all remain in the DOM with their exact text and attributes; any element whose cue is not the visible one is visually hidden (`sr-only`-style clipping, not `display:none` and not `hidden`, except `first-visit-notice`, whose `hidden` property is the tested state) so `toHaveText` still passes and screen-reader users still get the text. `design.md` lists exactly how each element is satisfied.
- **AC-KW-005-3 (MUST)** `transfer-mode` keeps exact text and `data-transfer-mode`.
- **AC-KW-005-4 (MUST)** `html[data-session]`, `html[data-offline-state]`, `html[data-offline-ready]` are unchanged.

### REQ-KW-006 — PatchBoard workspace (the board is the centre)
- **AC-KW-006-1 (MUST)** Three recognisable columns To do, Doing, Done with visible counts. Column headings are `h3[tabindex=-1]` whose names stay "To do", "Doing", "Done"; counts are outside the heading text or the heading name still matches by substring and no other column heading contains "to do". Stacked with equal x and increasing y at 320; one row with equal y and increasing x at 1280.
- **AC-KW-006-2 (MUST)** `Add card` is the first control above or in the To do column header area (keeps labels `New card title`, `Notes (optional)`, exact button `Add card`, focus on the new card).
- **AC-KW-006-3 (MUST)** The workspace header has `Share` and `Import` shortcuts that scroll to and focus the existing transfer area (as shipped, `Share` focuses the Transfer heading `#transfer-h`; corrected in the PR-preview check) and the existing file import control. They add no new import path, do not duplicate the controls' accessible names, and change no import logic. Tab order inside `qr-transfer` stays Show, Hide, Scan.
- **AC-KW-006-4 (MUST)** All card, incomplete-card, edit, delete and move accessible names, focus targets and `data-*` attributes are unchanged; rows update in place (E2E-PB-20 draft refresh).
- **AC-KW-006-5 (MUST)** File transfer stays easy to find on phones: the `Export capsule (.gscap)` and `Import capsule file (.gscap)` controls are adjacent, labelled, and the too-large/too-narrow messages point to them.

### REQ-KW-007 — Offline moment
- **AC-KW-007-1 (MUST)** When the page's real network state turns offline (the existing `online`/`offline` events and `navigator.onLine` as already tracked by the app), one compact banner shows `The network vanished. Your work didn't.` with the courier. It is never timer-triggered, and is not shown while online.
- **AC-KW-007-2 (MUST)** The banner's space is reserved: showing or hiding it changes no other element's `y` position (measured before/after on the workspace and the join view).
- **AC-KW-007-3 (MUST)** The lantern reacts once (one brief animation of 600 to 900 ms, then static) and the user can keep working during and after it. Under `prefers-reduced-motion: reduce` no CSS animation or transition is running (`document.getAnimations()` is empty for the page).
- **AC-KW-007-4 (MUST)** The banner reflects the real save state: it never claims the work is saved when `save-indicator[data-save-state="error"]` or the phase is `recovery`; in that case the plain `#status-note` states `Changes are NOT saved to this device.` and the banner shows a not-saved wording. The existing plain text `Offline · Changes still save on this device.` remains available in `#status-note` where accurate.
- **AC-KW-007-5 (MUST)** The banner carries no new live region that repeats `#status-note`, `network-chip` or `offline-indicator`.
- **AC-KW-007-6 (MUST)** After an offline reload (service worker serves the shell) the app shows the banner state and the restored board, with zero non-origin requests.

### REQ-KW-008 — QR sender stage
- **AC-KW-008-1 (MUST)** The code is drawn on a pure white stage; the canvas bitmap keeps the full four-module quiet zone (`canvas.width === (4v+17+8) * scale`, pixel (0,0) white); a paper frame around the white stage is outside the quiet zone.
- **AC-KW-008-2 (MUST)** The canvas and every ancestor up to `body` carry no filter, opacity below 1, transform, blend mode, animation, backdrop-filter, mask or clip-path, and the canvas is not scaled by CSS. No decorative layer overlaps the canvas.
- **AC-KW-008-3 (MUST)** The existing details stay visible with exact text: `qr-show-bytes`, `qr-show-version`, `qr-show-checksum`, board id (`qr-show-document-id`).
- **AC-KW-008-4 (MUST)** QR geometry coupling holds: `qr-transfer` width is at least 760px at 1280x800, and at 320px the empty-board code reports `too-narrow` (width below the minimum code size) with the file fallback text and the Export control adjacent. As shipped after the PR-preview check, "adjacent" means a `Go to file export` button directly under the message that moves focus to `Export capsule (.gscap)`. The narrow rule is the unchanged qr-transfer AC-QR-004-3 (integer scale of at least 4, measured on the QR panel's inner width). That rule also gives `too-narrow` for a typical board at 390px portrait, which is expected (see design section 7). The 1232-byte limit and version 25-L are untouched; too-large still names the size and points to the file controls.
- **AC-KW-008-5 (MUST)** The camera preview carries only the existing minimal framing guide; no new overlay.

### REQ-KW-009 — QR receiver sequence and import result
- **AC-KW-009-1 (MUST)** A visible three-step sequence Scan, Review, Import with the courier reflects the REAL scan controller state (`qr-scan-panel[data-qr-state]`): `scanning` marks step 1, `scanned` or `already-imported` marks step 2, `importing` marks step 3, `imported` completes it, and the error states (`rejected`, `denied`, `no-camera`, `in-use`, `insecure`, `unsupported`, `failed`, `timed-out`) show an error step with text. The mapping is a pure function of the state string. Each step's current/complete/error status is conveyed by text or icon and an attribute, not by colour alone.
- **AC-KW-009-2 (MUST)** After a scan is accepted the board (document) name from the capsule is shown with the exact `Import scanned capsule` button and `Discard scan`; focus lands on the review heading `qr-review-heading` (superseded by REQ-KW-016; the Import button follows it directly); the unknown-sender trust warning stays at the decision.
- **AC-KW-009-3 (MUST)** After import the result text describes the ACTUAL change summary and save outcome: `Saved on this device` only when `data-import-state="applied-saved"`; when `applied-unsaved`, the not-saved alert, `Retry save` and `Download backup capsule` are shown next to the result and no "saved" wording appears.
- **AC-KW-009-4 (MUST)** The sequence adds no focusable element between Show, Hide and Scan, no `role=alert`, and no live region duplicating `qr-scan-message`.
- **AC-KW-009-5 (MUST)** The existing QR suites (`E2E-QR-01` to `E2E-QR-15`) pass unchanged.

### REQ-KW-010 — FieldLedger field notebook
- **AC-KW-010-1 (MUST)** The same identity (tokens, courier, sprite, small header) applies. FieldLedger's first screen carries its own hero-lite for opening an incident (field `Incident ID`, button `Open incident`, visible without scrolling at 390x664 and 430x739) and does not claim QR (file transfer only, `transfer-mode` exact text unchanged).
- **AC-KW-010-2 (MUST)** The checklist is the focal point: a notebook (paper) treatment, incident details as a compact field-report header, items as notebook lines with a strong completion state shown by text or icon and `aria-label` `Done: <text>` (not by colour alone).
- **AC-KW-010-3 (MUST)** Long titles get room on phones and the full-title fallback (`.fl-record-full` with the complete title text) is kept; at 320px every descendant of `<main>` has `right <= 320.5` and the page has no horizontal overflow.
- **AC-KW-010-4 (MUST)** `NOTICE_MIN_VISIBLE_MS` behaviour (first-visit notice visible at least 1500 ms from page start) and all FieldLedger e2e names, ids, `hidden` rule and focus order (Dismiss then Download backup capsule) are unchanged.
- **AC-KW-010-5 (MUST)** FieldLedger's offline banner, readiness-once presentation, Help/See-how-it-works and credit follow REQ-KW-004, 005, 007 and 015 with its own copy ("incident").

### REQ-KW-011 — iPhone layout (emulation) and safe areas
- **AC-KW-011-1 (MUST)** In Chromium emulation (EV-FIXTURE only) at 320x568, 390x664, 430x739 and 430x932: no horizontal overflow on the join view and the populated workspace of both apps; no element is `position: fixed` or `sticky` with a box over a control; the last control is reachable by scrolling.
- **AC-KW-011-2 (MUST)** Heights use `dvh` with `vh` fallback; `env(safe-area-inset-*)` padding is implemented for the page and any bottom edge; `viewport-fit=cover` is added to the viewport meta only together with that padding.
- **AC-KW-011-3 (MUST)** With the viewport shrunk to 390x340 (keyboard emulation) and `#board-id` focused, `Open board` is reachable (after the browser's scroll-into-view it intersects the viewport, and `elementFromPoint` at its centre is the button) and not covered by any layer.
- **AC-KW-011-4 (SHOULD)** Report steps and scrolls to reach `Open board` and `Import` from a cold start at each viewport.
- **AC-KW-011-5 (MUST)** No document, screenshot, test name or report states that these checks prove Safari behaviour.

### REQ-KW-012 — Accessibility invariants
- **AC-KW-012-1 (MUST)** Every contrast pair in the palette table is at or above its threshold (recomputed by a unit test from the shipped tokens).
- **AC-KW-012-2 (MUST)** Every interactive element shows a computed `outline-width` of exactly `3px` right after focus, including `summary`, selects, textarea, checkbox and the native file input, with no `outline: none` and no transition on outline.
- **AC-KW-012-3 (MUST)** Touch targets (buttons, inputs, selects, checkboxes, summary) are at least 44px in both dimensions at phone and 320 sizes.
- **AC-KW-012-4 (MUST)** Under `prefers-reduced-motion: reduce` no animation runs anywhere (`getAnimations()` is empty) and all state is still carried by text or icon.
- **AC-KW-012-5 (MUST)** No state relies on colour alone (save, network, offline-ready, step status, checklist done).
- **AC-KW-012-6 (MUST)** Every control has an accessible name; no decorative layer receives pointer events or covers text or controls (the overlap audit passes in both apps).
- **AC-KW-012-7 (MUST)** All accessible names asserted by the existing tests are unchanged; where new wording conflicts, the existing name is kept and the new wording sits beside it with no differing `aria-label`.

### REQ-KW-013 — Offline assets and dist
- **AC-KW-013-1 (MUST)** All visual assets are bundled locally. Inline SVG needs no precache entry; any emitted file under `dist/assets` is listed in `precache-manifest.json` (the unchanged plugin does this) and `test:dist` proves it.
- **AC-KW-013-2 (MUST)** `dist` contains no `http(s)://` URL other than those already allowed by the existing scans, no `@font-face`, no `data:` font URI, no forbidden test-hook words, and `index.html` keeps the CSP verbatim.
- **AC-KW-013-3 (MUST)** After offline-ready, a reload with the network disabled renders the hero (headline, courier SVG, Board ID, Open board) in both apps, and every request is same-origin.
- **AC-KW-013-4 (MUST)** The existing offline suites (`E2E-PB-11/12/17`, `E2E-QR-07`, FieldLedger `E2E-FL-02/10/15`) pass unchanged.

### REQ-KW-014 — Preserved behaviour and process
- **AC-KW-014-1 (MUST)** `git status` for `packages/`, `apps/*/src/session/`, the service-worker register and precache plugin, and the pure copy modules is empty at the end; `@ghostsync/qr-transfer` tests still pass (90).
- **AC-KW-014-2 (MUST)** Every pre-`4b061be` test passes unchanged; test files from the two earlier UI passes are changed only to keep equivalent coverage and each change is listed with a reason in `docs/progress.md`.
- **AC-KW-014-3 (MUST)** No `.only`, `.skip`, retries or timeout increases are introduced; no production test hooks; no new dependency (a justification is required if one becomes unavoidable).
- **AC-KW-014-4 (MUST)** Nothing is staged or committed by the redesign work; `git diff --check` is clean and new files end with exactly one trailing newline.
- **AC-KW-014-5 (MUST)** Documentation separates EV-UNIT, EV-FIXTURE, EV-DIST and EV-PHYS (NOT RUN); `docs/qr-physical-test.md` gains a re-test checklist and marks nothing as run.

### REQ-KW-015 — Credit and evidence artefacts
- **AC-KW-015-1 (MUST)** Plain text `Built with Kiro for Kiroween` appears in the Help panel (or footer) of both apps, with no logo.
- **AC-KW-015-2 (MUST)** Before/after screenshots exist for the states listed in the brief under `.agents/tasks/ui-kiroween/{before,after}/` (never committed, never OneDrive/Desktop), each opened and inspected, with `index.md` recording paths, sizes and findings.
- **AC-KW-015-3 (MUST)** The existing steering file `.kiro/steering/ui.md` gains one short "Visual identity" note; the edit is recorded in `tasks.md`.
### REQ-KW-016 - Mobile usability pass (review panel and short viewports)
- **AC-KW-016-1 (MUST)** On the real transition into the `scanned` state (the controller's one-shot focus request, not a timer) the scan panel is scrolled into view with `scrollIntoView({ block: "start", behavior })` where `behavior` is `smooth` only when `prefers-reduced-motion` is not set and `auto` otherwise, and keyboard focus moves to the review heading (`h5[data-testid=qr-review-heading]`, `tabindex=-1`, accessible name `Capsule found. Not imported yet`). It happens once per transition, never on errors or other states, and does not alter the camera stop behaviour. The live message `QR code read. Nothing has been applied yet` is still announced.
- **AC-KW-016-2 (MUST)** The review block lists, in DOM order: board name (`Board in this capsule: <id>`), capsule size, the sender-trust warning (exact existing text), `Import scanned capsule`, `Discard scan`. The Scan, Review, Import strip and the `QR code read. Not imported yet` status sit directly above it. App, document ID, created time and checksum are inside a native `details` named `Details: app, created, checksum`, closed by default, opened from the keyboard.
- **AC-KW-016-3 (MUST)** At 390x664 and 320x568 the review heading, the warning, `Import scanned capsule` and `Discard scan` are all inside the viewport after the scroll, so no sticky action bar is used (none exists: no `fixed` or `sticky` element in the review state).
- **AC-KW-016-4 (MUST)** Import by keyboard imports once and reports the saved or not-saved result; focus is on `Scan QR code` afterwards (never `body`). `Discard scan` returns to idle, focuses `Scan QR code`, drops the held capsule and leaves stored cards unchanged.
- **AC-KW-016-5 (MUST)** First-visit hero: `Open board` / `Open incident` has its bottom edge at or above 540px at 390x664, 600px at 430x739, 460px at 320x568 and 480px at 320x480. The readiness line and the first-visit notice sit directly below the action (both stay in the DOM with their test IDs; both are in the first screen at 390x844). `See how it works` and the ID hint stay; input font size stays at least 16px.
- **AC-KW-016-6 (MUST)** With the keyboard emulated by a short viewport (390x340, 320x300) and the ID field focused, the field is inside the viewport, `Open board` / `Open incident` is reachable by one scroll without covering the field, and Enter opens the board.
- **AC-KW-016-7 (SHOULD)** The remaining screenshots are inspected; clipped controls, dead space and unreadable text found are fixed or the acceptance is recorded in `.agents/tasks/ui-kiroween/mobile-pass.md`.
- **AC-KW-016-9 (MUST, added in the PR-preview check)** When the QR show panel is `too-narrow` or `too-large`, a `Go to file export` button sits directly under the unchanged message and moves keyboard focus to `Export capsule (.gscap)`. It is hidden in every other state. With a visual viewport of 26rem or less (keyboard open), the hero's supporting line is hidden so the ID field and the open button get the room. All test IDs, accessible names and messages stay unchanged.
- **AC-KW-016-8 (MUST)** Evidence is labelled: Chromium emulation is EV-FIXTURE; real Safari toolbar, iOS keyboard and camera behaviour are EV-PHYS and stay NOT RUN until the user tests the preview.
