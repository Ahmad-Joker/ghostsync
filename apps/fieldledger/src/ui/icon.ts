/**
 * Decorative SVG from the static sprite in index.html. The HTML parser supplies the SVG namespace, so no
 * namespace string appears in app code. Input is always a constant from this file, never user data.
 */
export type SymbolId =
  | "gs-courier"
  | "gs-courier-sm"
  | "gs-courier-step-scan"
  | "gs-courier-step-review"
  | "gs-courier-step-import";

function parse(markup: string): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = markup;
  return t.content.firstElementChild as SVGElement;
}

/** A single sprite symbol, hidden from assistive technology. */
export function icon(id: SymbolId, cls = "gs-icon"): SVGElement {
  return parse(`<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`);
}

/** The hero scene: two devices, a dotted flight path, the crescent moon and the courier crossing the gap. */
export function heroArt(): SVGElement {
  return parse(
    `<svg class="gs-art" viewBox="0 0 360 150" aria-hidden="true" focusable="false">` +
      `<g fill="#f7f1e3" fill-opacity="0.7"><circle cx="40" cy="14" r="1.6"></circle><circle cx="118" cy="26" r="1.2"></circle><circle cx="232" cy="12" r="1.6"></circle><circle cx="268" cy="34" r="1.2"></circle><circle cx="170" cy="8" r="1.2"></circle></g>` +
      `<use href="#gs-moon" x="296" y="4" width="34" height="34"></use>` +
      `<use href="#gs-phone" x="14" y="46" width="46" height="77"></use>` +
      `<use href="#gs-laptop" x="286" y="62" width="68" height="45"></use>` +
      `<path d="M64 74C104 24 146 20 178 52S250 96 288 80" fill="none" stroke="#cdc3e6" stroke-width="2.6" stroke-dasharray="1 8" stroke-linecap="round"></path>` +
      `<use href="#gs-courier" x="128" y="22" width="98" height="77"></use>` +
      `</svg>`,
  );
}
