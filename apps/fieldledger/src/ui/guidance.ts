import { h } from "./h.js";

/** Pure UI preference, kept apart from every persistence key. Never touches IndexedDB, the Kit or the incident. */
export const GUIDANCE_KEY = "ghostsync.fieldledger.ui.guidance";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(GUIDANCE_KEY) === "dismissed";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(GUIDANCE_KEY, "dismissed");
  } catch {
    // Storage unavailable: the guide stays closed for this page session only.
  }
}

/**
 * The first-time guide and the Help panel are one panel. It is never modal, never an overlay and never
 * takes focus on its own. Closing it returns focus to the Help button when Help opened it, otherwise to the
 * first control the user would use next.
 */
export class Guidance {
  readonly root: HTMLElement;
  readonly helpBtn: HTMLButtonElement;
  private openedByHelp = false;

  constructor(private readonly firstControl: () => HTMLElement | undefined) {
    this.helpBtn = h(
      "button",
      { type: "button", id: "help-btn", class: "gs-btn--quiet", "aria-controls": "guidance", "aria-expanded": "false", onclick: () => this.toggle() },
      "How it works",
    );
    const begin = h("button", { type: "button", id: "guidance-begin", class: "gs-btn--primary", onclick: () => this.close() }, "Start working");
    this.root = h(
      "section",
      {
        id: "guidance",
        class: "gs-panel gs-panel--glow gs-guidance",
        "aria-labelledby": "guidance-h",
        onkeydown: (e: Event) => {
          if ((e as KeyboardEvent).key === "Escape") {
            e.preventDefault();
            this.openedByHelp = true;
            this.close();
          }
        },
      },
      h("h2", { id: "guidance-h" }, "How GhostSync works"),
      h("p", {}, "FieldLedger keeps an incident log and its checklist working with no signal. No account or server is required."),
      h(
        "ol",
        { class: "gs-steps" },
        h("li", { class: "gs-step" }, h("span", { class: "gs-step-title" }, "Work normally"), h("span", { class: "gs-step-text" }, "Changes are saved on this device.")),
        h("li", { class: "gs-step" }, h("span", { class: "gs-step-title" }, "Share"), h("span", { class: "gs-step-text" }, "Download a capsule file and send it to the other device.")),
        h(
          "li",
          { class: "gs-step" },
          h("span", { class: "gs-step-title" }, "Merge"),
          h("span", { class: "gs-step-text" }, "The other device imports it and both sets of changes are combined."),
        ),
      ),
      h("p", { class: "gs-help-text" }, "Your changes stay on this device until you share them. Changes carried safely between devices."),
      h("div", { class: "gs-guidance-actions" }, begin),
    );
    this.sync(!readDismissed());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private sync(open: boolean): void {
    this.root.hidden = !open;
    this.helpBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  private toggle(): void {
    if (this.isOpen) {
      this.sync(false);
      return;
    }
    this.openedByHelp = true;
    this.sync(true);
  }

  private close(): void {
    const byHelp = this.openedByHelp;
    this.openedByHelp = false;
    this.sync(false);
    writeDismissed();
    (byHelp ? this.helpBtn : (this.firstControl() ?? this.helpBtn)).focus();
  }
}
