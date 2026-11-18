import type { ModelDiff } from "../model/diff.js";

/** Plain-language status text derived from real state only. Pure: no DOM, no storage. */

/** One line for the status bar. `phase` and `saveState` come from the SessionController. */
export function connectionNote(online: boolean, phase: string, saveState: string): string {
  const lead = online ? "Online" : "Offline";
  if (phase === "recovery" || saveState === "error") return `${lead} · Changes are NOT saved to this device.`;
  if (phase !== "ready") {
    return online ? "Online · Open an incident to start working." : "Offline · An incident already opened on this device still opens.";
  }
  return online ? "Online · Changes save on this device." : "Offline · Changes still save on this device.";
}

export interface ChangeCounts {
  readonly added: number;
  readonly changes: number;
  readonly removed: number;
  readonly incomplete: number;
}

/** Counts a structured model diff. One field change is one change; one item can have several. */
export function countModelDiff(d: ModelDiff): ChangeCounts {
  return {
    added: d.addedItems.length,
    changes: d.changedItems.length + d.changedIncident.length,
    removed: d.removedItems.length,
    incomplete: d.becameInvalid.length,
  };
}

/** "Imported: 1 added, 1 change", or "Imported: nothing new" when the capsule changed nothing. */
export function importHeadline(c: ChangeCounts): string {
  const parts: string[] = [];
  if (c.added > 0) parts.push(`${c.added} added`);
  if (c.changes > 0) parts.push(c.changes === 1 ? "1 change" : `${c.changes} changes`);
  if (c.removed > 0) parts.push(`${c.removed} removed`);
  if (c.incomplete > 0) parts.push(`${c.incomplete} incomplete`);
  return parts.length === 0 ? "Imported: nothing new" : `Imported: ${parts.join(", ")}`;
}
