/**
 * Reading the notebook folders a visitor drops or picks (the try page's machine-log tab and /agents).
 * Files are only collected here; nothing is read until the check asks for a file, and nothing is sent.
 *
 * A drop's DataTransfer is only readable during the drop event, so `readDrop` takes everything it needs
 * from it synchronously, before its first await. Folders come through `webkitGetAsEntry` (Chromium,
 * Firefox, Safari); when a browser gives no entries, the dropped files themselves are used, loose.
 */
import { MAX_RECORDS } from "./machine_log.mjs";

/** At most this many files are collected from one folder (a notebook is ~2 per record). */
export const MAX_FILES = 3 * MAX_RECORDS + 100;

export class TooManyFiles extends Error {}

/** Every file under a dropped directory, by path. Stops (and says so) past MAX_FILES. */
export async function walk(entry: FileSystemEntry, prefix: string, out: Map<string, File>): Promise<void> {
  if (out.size > MAX_FILES) throw new TooManyFiles();
  if (entry.isFile) {
    const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.set(prefix + entry.name, f);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    // readEntries returns its entries in batches; an empty batch is the end.
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) return;
    for (const e of batch) await walk(e, `${prefix}${entry.name}/`, out);
  }
}

/** One dropped or picked folder. `name` null: loose files, not a folder. */
export type DroppedFolder = { name: string | null; files: Map<string, File>; error?: "too_many" | "unreadable" };

/** The folders in a drop: one per dropped directory, plus the loose files together as one more. */
export function readDrop(dt: DataTransfer): Promise<DroppedFolder[]> {
  // Synchronously, inside the event: items and files are emptied once the handler returns.
  const items = [...dt.items].filter((i) => i.kind === "file");
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null));
  const plain = [...dt.files];
  return (async () => {
    if (!entries.length || entries.some((e) => !e)) {
      // No entries from this browser: the files as dropped (a folder cannot come through this way).
      if (!plain.length) return [];
      return [{ name: null, files: new Map(plain.map((f) => [f.name, f] as [string, File])) }];
    }
    const out: DroppedFolder[] = [];
    const loose = new Map<string, File>();
    for (const en of entries as FileSystemEntry[]) {
      if (en.isDirectory) {
        const files = new Map<string, File>();
        try {
          await walk(en, "", files);
          out.push({ name: en.name, files });
        } catch (x: unknown) {
          out.push({ name: en.name, files, error: x instanceof TooManyFiles ? "too_many" : "unreadable" });
        }
      } else {
        try {
          await walk(en, "", loose);
        } catch (x: unknown) {
          if (x instanceof TooManyFiles) return [...out, { name: null, files: loose, error: "too_many" as const }];
        }
      }
    }
    if (loose.size) out.push({ name: null, files: loose });
    return out;
  })();
}

/** The files a file input picked, as one folder (a folder picker gives `<folder>/<path>`). */
export function readPicked(list: FileList): DroppedFolder | null {
  if (!list.length) return null;
  const files = new Map<string, File>();
  for (const f of list) files.set(f.webkitRelativePath || f.name, f);
  const first = list[0].webkitRelativePath.split("/")[0];
  return { name: first || null, files };
}
