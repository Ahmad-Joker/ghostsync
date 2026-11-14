import { LIMITS, type Card } from "../model/adapters.js";
import type { Placed } from "../model/ordering.js";
import { COLUMNS, COLUMN_LABEL, type ColumnId } from "../model/placement.js";
import type { InvalidRow } from "../model/read-model.js";
import type { SessionController } from "../session/session-controller.js";
import { h } from "./h.js";

const cap = (s: string, n: number): string => {
  const points = Array.from(s);
  return points.length > n ? `${points.slice(0, n - 1).join("")}…` : s;
};

type Btn = HTMLButtonElement;

/** A persistent <li> for one valid card. It is updated in place so an open edit form keeps its DOM node and focus. */
export class CardRow {
  readonly el: HTMLLIElement;
  card: Card | undefined;
  private readonly titleEl = h("span", { "data-testid": "card-title", class: "card-title" });
  private readonly notesEl = h("p", { "data-testid": "card-notes", class: "card-notes" });
  private readonly actions = h("div", { class: "actions" });
  private readonly confirm = h("div", { class: "actions", hidden: true });
  private readonly buttons = new Map<string, Btn>();
  private readonly confirmDelete: Btn;
  private readonly keepCard: Btn;
  private form: HTMLFormElement | undefined;
  private formButtons: { save: Btn; cancel: Btn } | undefined;
  private baseline: { title: string; notes: string } | undefined;
  private formError: HTMLElement | undefined;
  private editable = true;
  private confirming = false;

  constructor(
    private readonly c: SessionController,
    readonly id: string,
  ) {
    const mk = (action: string, text: string, onclick: () => void): Btn => {
      const b = h("button", { type: "button", "data-action": action, onclick }, text);
      this.buttons.set(action, b);
      return b;
    };
    for (const col of COLUMNS) {
      this.actions.append(mk(`move-${col}`, `Move to ${COLUMN_LABEL[col]}`, () => this.c.move(this.id, col)));
    }
    this.actions.append(
      mk("up", "Move up", () => this.c.reorder(this.id, -1)),
      mk("down", "Move down", () => this.c.reorder(this.id, 1)),
      mk("edit", "Edit card", () => this.openEdit()),
      mk("delete", "Delete card", () => this.askDelete()),
    );
    this.confirmDelete = h("button", { type: "button", "data-action": "confirm-delete", onclick: () => this.c.deleteCard(this.id) }, "Confirm delete");
    this.keepCard = h("button", { type: "button", "data-action": "keep", onclick: () => this.stopConfirm(true) }, "Keep card");
    this.confirm.append(this.confirmDelete, this.keepCard);
    this.el = h(
      "li",
      { "data-card-id": id, tabindex: "-1", class: "card" },
      h("div", { class: "card-head" }, this.titleEl),
      this.notesEl,
      this.actions,
      this.confirm,
    );
  }

  get editing(): boolean {
    return this.form !== undefined;
  }

  fill(p: Placed, editable: boolean): void {
    const { card } = p;
    this.card = card;
    this.editable = editable;
    this.el.setAttribute("data-column", p.column);
    this.el.setAttribute("data-placement", card.placement);
    this.el.setAttribute("aria-label", `Card: ${card.title}`);
    if (this.titleEl.textContent !== card.title) this.titleEl.textContent = card.title;
    if (this.notesEl.textContent !== card.notes) this.notesEl.textContent = card.notes;
    this.notesEl.hidden = card.notes === "";
    const label = (a: string): string => `${a}: ${card.title}`;
    for (const [action, b] of this.buttons) {
      const text = b.textContent ?? "";
      b.setAttribute("aria-label", label(text));
      b.disabled = !editable;
      if (action.startsWith("move-")) b.hidden = action === `move-${p.column}`;
    }
    this.confirmDelete.setAttribute("aria-label", label("Confirm delete"));
    this.keepCard.setAttribute("aria-label", label("Keep card"));
    this.confirmDelete.disabled = !editable;
    if (this.formButtons !== undefined) {
      this.formButtons.save.setAttribute("aria-label", label("Save card"));
      this.formButtons.cancel.setAttribute("aria-label", label("Cancel edit"));
    }
  }

  /** Disable up/down at the ends of the column. */
  setEnds(first: boolean, last: boolean): void {
    const up = this.buttons.get("up");
    const down = this.buttons.get("down");
    if (up !== undefined) up.disabled = !this.editable || first;
    if (down !== undefined) down.disabled = !this.editable || last;
  }

  action(name: string): HTMLButtonElement | undefined {
    const b = this.buttons.get(name);
    return b !== undefined && !b.disabled && !b.hidden && !this.actions.hidden ? b : undefined;
  }

  private syncMode(): void {
    this.actions.hidden = this.editing || this.confirming;
    this.confirm.hidden = !this.confirming || this.editing;
  }

  private askDelete(): void {
    this.confirming = true;
    this.syncMode();
    this.keepCard.focus();
  }

  private stopConfirm(refocus: boolean): void {
    this.confirming = false;
    this.syncMode();
    if (refocus) this.buttons.get("delete")?.focus();
  }

  private openEdit(): void {
    if (this.card === undefined || this.form !== undefined) return;
    this.baseline = { title: this.card.title, notes: this.card.notes };
    const title = h("input", { id: `t-${this.id}`, type: "text", name: "title", maxlength: String(LIMITS.title), autocomplete: "off", value: this.baseline.title });
    const notes = h("textarea", { id: `n-${this.id}`, name: "notes", rows: "3", maxlength: String(LIMITS.notes) });
    notes.value = this.baseline.notes;
    title.value = this.baseline.title;
    const save = h("button", { type: "submit" }, "Save card");
    const cancel = h("button", { type: "button", onclick: () => this.closeEdit(true) }, "Cancel edit");
    this.formError = h("p", { role: "alert", class: "error-text" });
    this.formButtons = { save, cancel };
    this.form = h(
      "form",
      {
        "data-testid": "card-edit-form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          this.submit(title, notes);
        },
      },
      h("p", {}, h("label", { for: title.id }, "Title"), title),
      h("p", {}, h("label", { for: notes.id }, "Notes"), notes),
      this.formError,
      h("div", { class: "actions" }, save, cancel),
    );
    this.el.append(this.form);
    this.syncMode();
    if (this.card !== undefined) {
      save.setAttribute("aria-label", `Save card: ${this.card.title}`);
      cancel.setAttribute("aria-label", `Cancel edit: ${this.card.title}`);
    }
    title.focus();
  }

  private submit(title: HTMLInputElement, notes: HTMLTextAreaElement): void {
    const base = this.baseline;
    if (base === undefined) return;
    const draftTitle = title.value.trim();
    if (draftTitle === "") {
      if (this.formError !== undefined) this.formError.textContent = "Enter a title.";
      return;
    }
    const changes: { title?: string; notes?: string } = {};
    if (draftTitle !== base.title) changes.title = draftTitle;
    if (notes.value !== base.notes) changes.notes = notes.value;
    if (Object.keys(changes).length === 0) {
      this.closeEdit(true);
      return;
    }
    this.c.saveCard(this.id, changes);
    // Keep the draft open when the edit failed or the card is gone, so nothing typed is lost.
    if (this.c.editError === undefined && this.c.notice === undefined) this.closeEdit(true);
  }

  closeEdit(refocus: boolean): void {
    this.form?.remove();
    this.form = undefined;
    this.formButtons = undefined;
    this.formError = undefined;
    this.baseline = undefined;
    this.syncMode();
    if (refocus) this.buttons.get("edit")?.focus();
  }
}

function labelOf(row: InvalidRow): string {
  const t = row.fields["title"];
  return cap(typeof t === "string" && t !== "" ? t : row.id, 80);
}

/** A persistent <li> for one incomplete card. Offers only Restore and Discard. */
export class IncompleteRow {
  readonly el: HTMLLIElement;
  private readonly fieldsEl = h("div", { class: "invalid-fields" });
  private readonly restore: Btn;
  private readonly discard: Btn;
  private readonly confirmDiscard: Btn;
  private readonly keep: Btn;
  private readonly confirm = h("div", { class: "actions", hidden: true });
  private readonly actions = h("div", { class: "actions" });

  constructor(
    private readonly c: SessionController,
    readonly id: string,
  ) {
    this.restore = h("button", { type: "button", onclick: () => this.c.restoreInvalid(this.id) }, "Restore card");
    this.discard = h("button", { type: "button", onclick: () => this.setConfirm(true, true) }, "Discard card");
    this.confirmDiscard = h("button", { type: "button", onclick: () => this.c.discardInvalid(this.id) }, "Confirm discard");
    this.keep = h("button", { type: "button", onclick: () => this.setConfirm(false, true) }, "Keep incomplete card");
    this.actions.append(this.restore, this.discard);
    this.confirm.append(this.confirmDiscard, this.keep);
    this.el = h(
      "li",
      { "data-card-id": id, "data-invalid": "true", class: "card invalid", tabindex: "-1" },
      h("strong", {}, "Conflicted or incomplete card"),
      this.fieldsEl,
      this.actions,
      this.confirm,
    );
  }

  private setConfirm(on: boolean, focus: boolean): void {
    this.actions.hidden = on;
    this.confirm.hidden = !on;
    if (focus) (on ? this.keep : this.discard).focus();
  }

  fill(row: InvalidRow, editable: boolean): void {
    const label = labelOf(row);
    this.fieldsEl.textContent = "";
    for (const [k, v] of Object.entries(row.fields)) {
      this.fieldsEl.append(h("div", { class: "field-line" }, `${cap(k, 80)}: ${cap(String(v), 200)}`));
    }
    const pairs: Array<[Btn, string, string]> = [
      [this.restore, "Restore card", ""],
      [this.discard, "Discard card", ""],
      [this.confirmDiscard, "Confirm discard", ""],
      [this.keep, "Keep incomplete card", ""],
    ];
    for (const [b, name] of pairs) {
      b.setAttribute("aria-label", `${name}: ${label}`);
      b.disabled = !editable;
    }
  }
}
