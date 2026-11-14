import type { SaveState, SaveStateInfo } from "@ghostsync/persist";

export interface SaveLabel {
  readonly label: string;
  readonly symbol: string;
  readonly role: "alert" | "none";
  /** Whether a transition into this state is announced in the live region. */
  readonly announce: boolean;
}

/**
 * The ONLY source of the save label. "Saved locally" appears solely for state "saved" with a
 * confirmed sequence > 0 (AC-FL-008).
 */
export function saveLabel(state: SaveState, info: SaveStateInfo): SaveLabel {
  switch (state) {
    case "dirty":
      return { label: "Changes not yet saved", symbol: "…", role: "none", announce: false };
    case "saving":
      return { label: "Saving to this device...", symbol: "↻", role: "none", announce: false };
    case "saved":
      return info.sequence > 0
        ? { label: "Saved locally", symbol: "✓", role: "none", announce: true }
        : { label: "Nothing to save yet", symbol: "–", role: "none", announce: false };
    case "error":
      return { label: "NOT saved to this device", symbol: "⚠", role: "alert", announce: true };
  }
}
