// lib/drop-entries.ts
// Walks dropped files and folders. The DOM entry API is hidden behind a minimal interface so
// the Bun unit tests can feed a fake tree.

export interface FileLike {
  name: string;
  size: number;
}

export interface DropEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file(): Promise<File | FileLike>;
  readEntries(): Promise<DropEntry[]>;
}

export interface DroppedFile<F = File | FileLike> {
  file: F;
  /** Folder segments from the dropped root, without the file name. */
  path: string[];
}

export interface CollectResult {
  files: DroppedFile[];
  /** More files than maxFiles: the caller sends nothing. */
  tooMany: boolean;
}

export const MAX_DROP_FILES = 500;
export const MAX_DROP_DEPTH = 8;

const AUDIO_EXTENSION = /\.(flac|mp3|wav)$/i;

export const isAudioName = (name: string): boolean => AUDIO_EXTENSION.test(name);

export async function collectDroppedFiles(
  entries: readonly DropEntry[],
  opts: { maxFiles?: number; maxDepth?: number } = {},
): Promise<CollectResult> {
  const maxFiles = opts.maxFiles ?? MAX_DROP_FILES;
  const maxDepth = opts.maxDepth ?? MAX_DROP_DEPTH;
  const files: DroppedFile[] = [];
  let tooMany = false;

  const visit = async (entry: DropEntry, path: string[], depth: number): Promise<void> => {
    if (tooMany || entry.name.startsWith(".")) return;
    if (entry.isFile) {
      if (!isAudioName(entry.name)) return;
      if (files.length >= maxFiles) {
        tooMany = true;
        return;
      }
      files.push({ file: await entry.file(), path });
      return;
    }
    if (!entry.isDirectory || depth >= maxDepth) return;
    // readEntries answers in chunks: read until an empty batch.
    for (;;) {
      const batch = await entry.readEntries();
      if (batch.length === 0) return;
      for (const child of batch) {
        await visit(child, [...path, entry.name], depth + 1);
        if (tooMany) return;
      }
    }
  };

  for (const entry of entries) {
    // A dropped file has no folder; a dropped directory contributes its own name.
    await visit(entry, [], 0);
    if (tooMany) break;
  }
  return { files: tooMany ? [] : files, tooMany };
}

/** Adapts a real FileSystemEntry (webkitGetAsEntry). */
function adaptEntry(entry: FileSystemEntry): DropEntry {
  return {
    isFile: entry.isFile,
    isDirectory: entry.isDirectory,
    name: entry.name,
    file: () =>
      new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      ),
    readEntries: () =>
      new Promise<DropEntry[]>((resolve, reject) => {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        reader.readEntries((batch) => resolve(batch.map(adaptEntry)), reject);
      }),
  };
}

/**
 * Entries of a drop. Must be called synchronously in the drop handler: the items are
 * emptied once it returns.
 */
export function fromDataTransfer(items: DataTransferItemList): DropEntry[] {
  const entries: DropEntry[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(adaptEntry(entry));
  }
  return entries;
}

/** Files of a webkitdirectory input (or a plain picker, where the path is empty). */
export function fromFileList(
  files: ArrayLike<File | (FileLike & { webkitRelativePath?: string })>,
  opts: { maxFiles?: number } = {},
): CollectResult {
  const maxFiles = opts.maxFiles ?? MAX_DROP_FILES;
  const result: DroppedFile[] = [];
  for (const file of Array.from(files)) {
    const relative = (file as { webkitRelativePath?: string }).webkitRelativePath ?? "";
    const segments = relative === "" ? [file.name] : relative.split("/");
    const hidden = segments.some((segment) => segment.startsWith("."));
    if (hidden || !isAudioName(file.name)) continue;
    if (result.length >= maxFiles) return { files: [], tooMany: true };
    result.push({ file, path: segments.slice(0, -1) });
  }
  return { files: result, tooMany: false };
}
