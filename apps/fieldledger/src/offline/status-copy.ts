import type { OfflineState } from "./sw-register.js";

export const FIRST_VISIT_NOTICE =
  'Opening FieldLedger offline for the very first time will not work. Open it once while online.';

export function offlineCopy(state: OfflineState, error?: string): string {
  switch (state) {
    case "unsupported":
      return "Offline use is not available in this browser or context. FieldLedger needs HTTPS or localhost. Your edits still save to this device while the page is open.";
    case "registering":
    case "installing":
      return 'Preparing offline use... Stay online until this says "Ready to work offline".';
    case "waiting":
      return "A new version is ready. Save your work, then update.";
    case "ready":
      return "Ready to work offline.";
    case "failed":
      return `Offline use is not available: ${error ?? "unknown reason"}. You can keep working while online. Your edits still save to this device.`;
  }
}

/** The first-visit notice shows whenever readiness is not `ready`. */
export function showFirstVisitNotice(state: OfflineState): boolean {
  return state !== "ready";
}
