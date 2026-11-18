/**
 * Test-only decorative-effect overlap audit (same file in both apps). Runs in the page, changes nothing.
 * For every visible interactive control and alert/status/instruction element it scrolls the element into view and
 * checks document.elementFromPoint at the centre and the four inner corners (pseudo-elements never receive hits when
 * pointer-events is none, so their styles are audited separately). Also audits every ::before/::after and fixed or
 * absolute decorative layer, and the QR canvas and its ancestors for visual effects.
 */
import type { Page } from "@playwright/test";

export interface OverlapResult {
  checkedElements: number;
  hitPoints: number;
  hitFailures: string[];
  pseudoLayers: number;
  pseudoFailures: string[];
  qrCanvases: number;
  qrFailures: string[];
  scanOverlays: number;
}

export function auditOverlap(page: Page): Promise<OverlapResult> {
  return page.evaluate(() => {
    const SEL = [
      "button", "a[href]", "input:not([type=hidden])", "select", "textarea", "summary", "[role=button]",
      "[role=alert]", "[role=status]", "[aria-live]", ".alert", ".status", ".gs-help-text", ".error-text",
      "h1", "h2", "h3", "label", ".gs-steps > li", ".gs-chip", "[data-testid=qr-canvas]", "[data-testid=qr-video]",
    ].join(",");
    const visible = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none" && !e.closest("[hidden]");
    };
    const describe = (e: Element): string => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").split(" ")[0]}[${e.getAttribute("data-testid") ?? e.id}]"${(e.textContent ?? "").trim().slice(0, 30)}"`;
    const ok = (el: Element, top: Element | null): boolean => {
      if (top === null) return false;
      if (el.contains(top) || top.contains(el)) return true; // the element, a descendant, or a wrapper whose descendant is the element
      const label = top.closest("label");
      return label !== null && (label.contains(el) || (label as HTMLLabelElement).control === el);
    };
    const hitFailures: string[] = [];
    let hitPoints = 0;
    const els = [...document.querySelectorAll(SEL)].filter(visible);
    for (const el of els) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const left = Math.max(r.left, 0), right = Math.min(r.right, vw), top = Math.max(r.top, 0), bottom = Math.min(r.bottom, vh);
      if (right - left < 2 || bottom - top < 2) continue;
      const pts: Array<[number, number]> = [[(left + right) / 2, (top + bottom) / 2]];
      const control = /^(button|a|input|select|textarea|summary)$/i.test(el.tagName) || el.getAttribute("role") === "button";
      if (control && right - left > 16 && bottom - top > 16 && r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh) {
        const i = 6;
        pts.push([left + i, top + i], [right - i, top + i], [left + i, bottom - i], [right - i, bottom - i]);
      }
      for (const [x, y] of pts) {
        hitPoints += 1;
        const hit = document.elementFromPoint(x, y);
        if (!ok(el, hit)) hitFailures.push(`${describe(el)} at ${Math.round(x)},${Math.round(y)} covered by ${hit ? describe(hit) : "null"}`);
      }
    }
    // Decorative layers: every ::before/::after that is positioned out of flow, plus anything fixed.
    const pseudoFailures: string[] = [];
    let pseudoLayers = 0;
    let scanOverlays = 0;
    for (const el of [document.documentElement, document.body, ...document.querySelectorAll("*")]) {
      for (const pseudo of ["::before", "::after"] as const) {
        const cs = getComputedStyle(el, pseudo);
        if (cs.content === "none" || cs.content === "normal") continue;
        if (cs.display === "none") continue;
        const out = cs.position === "absolute" || cs.position === "fixed";
        if (!out) continue; // in-flow glyph/marker pseudo-elements take part in layout and cannot cover siblings
        pseudoLayers += 1;
        const d = `${describe(el)}${pseudo}`;
        if (cs.pointerEvents !== "none") pseudoFailures.push(`${d}: pointer-events ${cs.pointerEvents}`);
        if (cs.position === "fixed" && !(Number(cs.zIndex) < 0)) pseudoFailures.push(`${d}: fixed layer not below content (z-index ${cs.zIndex})`);
        if (el.classList.contains("gs-scan-frame")) {
          scanOverlays += 1;
          const video = el.querySelector("video");
          if (el.closest("[hidden]") === null && video !== null && el.querySelector("button, input, a, [role=alert], p") !== null) pseudoFailures.push(`${d}: scan frame contains non-video content`);
        } else if (cs.position === "absolute" && (parseFloat(cs.width) > 40 || parseFloat(cs.height) > 40) && !el.classList.contains("gs-mark")) {
          pseudoFailures.push(`${d}: large absolute layer ${cs.width}x${cs.height}`);
        }
      }
    }
    // Real elements that are fixed/absolute and pointer-active over content must be none (none expected in the apps).
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && visible(el) && el.matches(".gs-fx, [aria-hidden=true]") && cs.pointerEvents !== "none") pseudoFailures.push(`${describe(el)}: fixed decorative element accepts pointer events`);
    }
    // QR canvas and its quiet zone: no filter, opacity, transform, blend or animation on the canvas or any ancestor.
    const qrFailures: string[] = [];
    const canvases = [...document.querySelectorAll("[data-testid=qr-canvas], .gs-qr-frame canvas")].filter(visible);
    for (const c of canvases) {
      let node: Element | null = c;
      while (node !== null && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        const bad: string[] = [];
        if (cs.filter !== "none") bad.push(`filter ${cs.filter}`);
        if (cs.backdropFilter !== "none" && cs.backdropFilter !== "") bad.push(`backdrop-filter ${cs.backdropFilter}`);
        if (Number(cs.opacity) !== 1) bad.push(`opacity ${cs.opacity}`);
        if (cs.transform !== "none") bad.push(`transform ${cs.transform}`);
        if (cs.mixBlendMode !== "normal") bad.push(`mix-blend-mode ${cs.mixBlendMode}`);
        if (cs.animationName !== "none") bad.push(`animation ${cs.animationName}`);
        if (bad.length > 0) qrFailures.push(`${describe(node)}: ${bad.join(", ")}`);
        node = node.parentElement;
      }
      for (const pseudo of ["::before", "::after"] as const) {
        const parent = c.parentElement;
        if (parent === null) continue;
        const cs = getComputedStyle(parent, pseudo);
        if (cs.content !== "none" && cs.content !== "normal" && cs.display !== "none" && cs.position !== "static" && cs.position !== "relative") qrFailures.push(`${describe(parent)}${pseudo}: positioned layer over QR frame`);
      }
    }
    return { checkedElements: els.length, hitPoints, hitFailures, pseudoLayers, pseudoFailures, qrCanvases: canvases.length, qrFailures, scanOverlays };
  });
}
