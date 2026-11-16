import { h } from "./h.js";

/**
 * Optional "How it works" guide behind the Help button. It starts closed, is never modal, never an overlay and
 * never takes focus on its own. It stores nothing: Help opens it, Close help (or Escape) closes it, and focus
 * returns to Help.
 */
export class Guidance {
  readonly root: HTMLElement;
  readonly helpBtn: HTMLButtonElement;

  constructor() {
    this.helpBtn = h(
      "button",
      { type: "button", id: "help-btn", class: "gs-btn--quiet", "aria-controls": "guidance", "aria-expanded": "false", onclick: () => this.toggle() },
      "Help",
    );
    const close = h("button", { type: "button", id: "guidance-close", onclick: () => this.close() }, "Close help");
    this.root = h(
      "section",
      {
        id: "guidance",
        class: "gs-panel gs-guidance",
        "aria-labelledby": "guidance-h",
        hidden: true,
        onkeydown: (e: Event) => {
          if ((e as KeyboardEvent).key === "Escape") {
            e.preventDefault();
            this.close();
          }
        },
      },
      h("h2", { id: "guidance-h" }, "How GhostSync works"),
      h("p", {}, "PatchBoard is a kanban board that keeps working with no signal. No account or server is required."),
      h(
        "ol",
        { class: "gs-steps" },
        h("li", {}, h("span", { class: "gs-step-title" }, "Work normally"), h("span", { class: "gs-step-text" }, "Changes save on this device, online or offline.")),
        h("li", {}, h("span", { class: "gs-step-title" }, "Share"), h("span", { class: "gs-step-text" }, "Download a file, or show a QR code to a device next to you.")),
        h("li", {}, h("span", { class: "gs-step-title" }, "Merge"), h("span", { class: "gs-step-text" }, "The other device imports it and both sets of changes are combined.")),
      ),
      h("p", { class: "gs-help-text" }, "To try it with two devices: open the same board ID on both, go offline, edit on each, then exchange QR codes or a file."),
      h("div", { class: "gs-guidance-actions" }, close),
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private sync(open: boolean): void {
    this.root.hidden = !open;
    this.helpBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  private toggle(): void {
    this.sync(!this.isOpen);
  }

  private close(): void {
    this.sync(false);
    this.helpBtn.focus();
  }
}
