function stamp(now: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return (
    `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
  );
}

const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

/** patchboard_<boardId>_<first 8 of replicaId>_<UTC stamp>[_backup].gscap */
export function capsuleFilename(boardId: string, replicaId: string, now: Date, kind: "export" | "backup"): string {
  return `patchboard_${safe(boardId)}_${safe(replicaId).slice(0, 8)}_${stamp(now)}${kind === "backup" ? "_backup" : ""}.gscap`;
}
