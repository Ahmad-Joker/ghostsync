---
inclusion: fileMatch
fileMatchPattern: "apps/**/*"
---

# UI

- **Keyboard access** for all actions; no pointer-only flows.
- **Visible focus** indicators on every interactive element.
- **Responsive layouts** that work across screen sizes.
- **Clear offline and transfer states** — show the user whether they are offline, syncing, or transferring, and the transfer mode in use.
- **Actionable errors** — tell the user what went wrong and what to do next.
- **Before/after views driven by actual replica state**, not mock data, so users see real changes and merge results.
- **Visual identity** — "illustrated midnight field guide": ink-purple, warm paper, violet, a little lantern amber. Display type only in the hero; system sans inside the apps. One shared courier SVG symbol set, bundled locally. Decoration stays outside the QR canvas and away from controls, stops under `prefers-reduced-motion`, and never carries state by colour alone.
