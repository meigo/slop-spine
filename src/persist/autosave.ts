import { saveProject, loadProject } from "./project-file";
import { idbDo, KV_STORE } from "./db";
import type { RigDocument } from "../rig/document";

const KEY = "autosave";
const DEBOUNCE_MS = 2000;

let timer: ReturnType<typeof setTimeout> | undefined;

/** Call on every document change. (Re)starts a 2s debounce; once it settles, zips the current
 *  document (via `getDoc`, called only then, so it captures the latest state) into the single
 *  autosave slot. */
export function armAutosave(getDoc: () => RigDocument): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void saveProject(getDoc())
      .then((blob) => idbDo(KV_STORE, "readwrite", (s) => s.put(blob, KEY)))
      .catch((e) => console.error("autosave failed", e));
  }, DEBOUNCE_MS);
}

/** Restores the autosaved document, or null if there isn't one. */
export async function restore(): Promise<RigDocument | null> {
  const blob = await idbDo<Blob | undefined>(KV_STORE, "readonly", (s) => s.get(KEY));
  return blob ? loadProject(blob) : null;
}

/** Drop the autosave slot and cancel a pending write. Used by New Document so a reload
 *  before the next debounce cannot resurrect the discarded project. */
export async function clearAutosave(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  await idbDo(KV_STORE, "readwrite", (s) => s.delete(KEY));
}
