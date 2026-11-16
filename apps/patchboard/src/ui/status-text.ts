/** Plain-language status text derived from real state only. Pure: no DOM, no storage. */

/** One line for the status bar. `phase` and `saveState` come from the SessionController. */
export function connectionNote(online: boolean, phase: string, saveState: string): string {
  const lead = online ? "Online" : "Offline";
  if (phase === "recovery" || saveState === "error") return `${lead} · Changes are NOT saved to this device.`;
  if (phase !== "ready") {
    return online ? "Online · Open a board to start working." : "Offline · A board already opened on this device still opens.";
  }
  return online ? "Online · Changes save on this device." : "Offline · Changes still save on this device.";
}

export interface ChangeCounts {
  readonly added: number;
  readonly changes: number;
  readonly removed: number;
  readonly incomplete: number;
}

/** Counts the change lines produced by diffBoards(). Each line is one change; one card can have several. */
export function countDiffLines(lines: ReadonlyArray<string>): ChangeCounts {
  let added = 0;
  let changes = 0;
  let removed = 0;
  let incomplete = 0;
  for (const line of lines) {
    if (line.startsWith("Added: ")) added += 1;
    else if (line.startsWith("Removed: ")) removed += 1;
    else if (line.startsWith("Now incomplete: ")) incomplete += 1;
    else changes += 1;
  }
  return { added, changes, removed, incomplete };
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
