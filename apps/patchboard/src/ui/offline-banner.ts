/** Offline banner copy from real state only. Pure: no DOM, no storage. */
export interface OfflineBannerView {
  readonly visible: boolean;
  readonly title: string;
  readonly state: string;
}

export const OFFLINE_TITLE = "The network vanished. Your work didn't.";

/**
 * `online` is the real connection state, `phase` and `saveState` come from the SessionController.
 * The state line never says changes are saved when saving failed or the board is in recovery. While online the banner is
 * not visible (`visible` is false), but its state line is still computed for the offline case so the reserved slot has
 * the same height in both states.
 */
export function offlineBannerView(online: boolean, phase: string, saveState: string): OfflineBannerView {
  const visible = !online;
  if (phase === "recovery" || saveState === "error") {
    return { visible, title: OFFLINE_TITLE, state: "Changes are NOT saved to this device." };
  }
  if (phase !== "ready") {
    return { visible, title: OFFLINE_TITLE, state: "A board already opened on this device still opens." };
  }
  return { visible, title: OFFLINE_TITLE, state: "Changes still save on this device." };
}
