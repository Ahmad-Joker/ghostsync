import { CAPSULE_MEDIA_TYPE } from "@ghostsync/capsule";

export interface DownloadDeps {
  readonly urlApi: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  readonly doc: Pick<Document, "createElement" | "body">;
  /** Runs `fn` after the browser had time to start the download. */
  readonly schedule: (fn: () => void) => void;
}

const defaultDeps = (): DownloadDeps => ({
  urlApi: URL,
  doc: document,
  schedule: (fn) => {
    window.setTimeout(fn, 1000);
  },
});

/** Browser download of capsule bytes via Blob + object URL + anchor click. The URL is revoked once. */
export function downloadBytes(bytes: Uint8Array, filename: string, deps: DownloadDeps = defaultDeps()): void {
  const blob = new Blob([bytes as BlobPart], { type: CAPSULE_MEDIA_TYPE });
  const url = deps.urlApi.createObjectURL(blob);
  const a = deps.doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.hidden = true;
  deps.doc.body.append(a);
  a.click();
  a.remove();
  deps.schedule(() => deps.urlApi.revokeObjectURL(url));
}
