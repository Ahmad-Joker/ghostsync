import { h } from "./h.js";
import { icon } from "./icon.js";

/**
 * Optional "How it works" guide behind the Help button and the hero's "See how it works" button. It starts
 * closed, is never modal, never an overlay and never takes focus on its own. It stores nothing: either button
 * opens it, Close help (or Escape) closes it, and focus returns to the button that opened it.
 */
export class Guidance {
  readonly root: HTMLElement;
  readonly helpBtn: HTMLButtonElement;
  /** The hero's secondary action. Mounted by the view while the incident chooser is showing. */
  readonly seeHowBtn: HTMLButtonElement;
  private opener: HTMLButtonElement;

  constructor() {
    this.helpBtn = h(
      "button",
      { type: "button", id: "help-btn", class: "gs-btn--quiet", "aria-controls": "guidance", "aria-expanded": "false", onclick: () => this.toggle(this.helpBtn) },
      "Help",
    );
    this.seeHowBtn = h(
      "button",
      { type: "button", id: "see-how-btn", class: "gs-btn--quiet fl-see-how", "aria-controls": "guidance", "aria-expanded": "false", onclick: () => this.toggle(this.seeHowBtn) },
      "See how it works",
    );
    this.opener = this.helpBtn;
    const close = h("button", { type: "button", id: "guidance-close", onclick: () => this.close() }, "Close help");
    const step = (id: "gs-courier-step-scan" | "gs-courier-step-review" | "gs-courier-step-import", title: string, text: string): HTMLElement =>
      h("li", {}, icon(id), h("span", { class: "gs-step-title" }, title), h("span", { class: "gs-step-text" }, text));
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
      h("p", {}, "FieldLedger keeps an incident log and its checklist working with no signal. No account or server is required."),
      h(
        "ol",
        { class: "gs-steps" },
        step("gs-courier-step-scan", "Edit offline", "Fill in the report and tick off the checklist with no signal. Changes save on this device."),
        step("gs-courier-step-review", "Share", "Download a capsule file and send it to the other device by any method."),
        step("gs-courier-step-import", "Import", "The other device imports the file, checks it, and both sets of changes merge."),
      ),
      h("p", { class: "gs-help-text" }, "To try it with two devices: open the same incident ID on both, go offline, edit on each, then exchange a file."),
      h("p", { class: "gs-credit" }, "Built with Kiro for Kiroween"),
      h("div", { class: "gs-guidance-actions" }, close),
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private sync(open: boolean): void {
    this.root.hidden = !open;
    const v = open ? "true" : "false";
    this.helpBtn.setAttribute("aria-expanded", v);
    this.seeHowBtn.setAttribute("aria-expanded", v);
  }

  private toggle(from: HTMLButtonElement): void {
    this.opener = from;
    this.sync(!this.isOpen);
  }

  private close(): void {
    this.sync(false);
    (this.opener.isConnected ? this.opener : this.helpBtn).focus();
  }
}
