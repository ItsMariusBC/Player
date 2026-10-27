import { copyFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { createFolder, listFolders } from "./catalog/folders.ts";
import { openDatabase } from "./db.ts";
import { ingestFile } from "./media/ingest.ts";
import type { ProbeResult } from "./media/probe.ts";
import { createMediaStorage, type MediaStorage } from "./media/storage.ts";
import { migrate } from "./migrations.ts";

export interface ManifestEntry {
  name: string;
  author: string;
  url: string;
  picture?: string;
  folder?: string;
}

export interface MigrationReport {
  imported: number;
  skipped: number;
  failed: { file: string; reason: string }[];
}

const AUDIO_EXTS = new Set([".flac", ".mp3", ".wav"]);
const PICTURE_EXTS: Record<string, "jpg" | "png" | "webp"> = {
  ".jpg": "jpg",
  ".jpeg": "jpg",
  ".png": "png",
  ".webp": "webp",
};

/** Recursively lists audio files as paths relative to root, sorted alphabetically. */
async function listAudio(root: string, dir = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listAudio(root, relative)));
    else if (entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      files.push(relative);
    }
  }
  return files;
}

async function readPicture(
  sourceDir: string,
  picture: string | undefined,
): Promise<ProbeResult["cover"]> {
  if (!picture) return null;
  const ext = PICTURE_EXTS[path.extname(picture).toLowerCase()];
  if (!ext) return null;
  const full = path.resolve(sourceDir, picture.replace(/^\/+/, ""));
  const inside = path.relative(path.resolve(sourceDir), full);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return null;
  try {
    return { data: await readFile(full), ext };
  } catch {
    return null;
  }
}

export async function migrateCatalog(input: {
  db: DatabaseSync;
  storage: MediaStorage;
  sourceDir: string;
  manifest?: ManifestEntry[];
  now: Date;
}): Promise<MigrationReport> {
  const { db, storage, sourceDir, now } = input;
  const manifest = input.manifest ?? [];
  const report: MigrationReport = { imported: 0, skipped: 0, failed: [] };

  const files = await listAudio(sourceDir);
  const entryFor = (file: string) =>
    manifest.find((entry) => path.posix.basename(entry.url) === path.basename(file));

  // Manifest order first, then the remaining files alphabetically.
  const ordered: string[] = [];
  for (const entry of manifest) {
    const name = path.posix.basename(entry.url);
    const match = files.find((file) => path.basename(file) === name && !ordered.includes(file));
    if (match) ordered.push(match);
  }
  for (const file of files) if (!ordered.includes(file)) ordered.push(file);

  const folderIds = new Map<string, string>();
  for (const folder of listFolders(db)) {
    const names: string[] = [folder.name];
    let parent = folder.parentId;
    while (parent !== null) {
      const up = listFolders(db).find((candidate) => candidate.id === parent);
      if (!up) break;
      names.unshift(up.name);
      parent = up.parentId;
    }
    folderIds.set(names.join("/"), folder.id);
  }
  const resolveFolder = (folderPath: string): string | null => {
    const parts = folderPath.split("/").filter((part) => part !== "");
    let parentId: string | null = null;
    let current = "";
    for (const part of parts) {
      current = current === "" ? part : `${current}/${part}`;
      let id = folderIds.get(current);
      if (!id) {
        id = createFolder(db, { parentId, name: part }, now).id;
        folderIds.set(current, id);
      }
      parentId = id;
    }
    return parentId;
  };

  for (const file of ordered) {
    const importId = crypto.randomUUID();
    try {
      const entry = entryFor(file);
      const dir = storage.incomingDir(importId);
      const copy = path.join(dir, "source");
      await copyFile(path.join(sourceDir, file), copy);
      const folderPath = entry?.folder ?? path.dirname(file).split(path.sep).join("/");
      const result = await ingestFile({
        db,
        storage,
        importId,
        file: copy,
        title: entry?.name,
        artist: entry?.author,
        fallbackTitle: path.basename(file, path.extname(file)),
        folderId: () => (folderPath === "." ? null : resolveFolder(folderPath)),
        cover: () => readPicture(sourceDir, entry?.picture),
        now,
      });
      if (result.kind === "duplicate") {
        report.skipped += 1;
        continue;
      }
      if (result.kind === "unsupported") {
        report.failed.push({ file, reason: "unsupported_format" });
        continue;
      }
      report.imported += 1;
    } catch (error) {
      await storage.removeIncoming(importId).catch(() => {});
      const code = (error as { code?: unknown }).code;
      report.failed.push({
        file,
        reason: typeof code === "string" ? code : (error as Error).message,
      });
    }
  }
  return report;
}

// CLI entry. DATA_DIR is read directly (default /data): the full config needs OIDC variables.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const manifestFlag = args.indexOf("--manifest");
  const manifestPath = manifestFlag >= 0 ? args[manifestFlag + 1] : undefined;
  const sourceDir = args.find(
    (arg, index) => !arg.startsWith("--") && (manifestFlag < 0 || index !== manifestFlag + 1),
  );
  if (!sourceDir || (manifestFlag >= 0 && !manifestPath)) {
    console.error("Usage: migrate-catalog <source-dir> [--manifest <path>]");
    process.exit(2);
  }
  const dataDir = process.env["DATA_DIR"] ?? "/data";
  const db = openDatabase(path.join(dataDir, "player.sqlite"));
  migrate(db);
  const manifest = manifestPath
    ? (JSON.parse(await readFile(manifestPath, "utf8")) as ManifestEntry[])
    : undefined;
  const report = await migrateCatalog({
    db,
    storage: createMediaStorage(dataDir),
    sourceDir,
    manifest,
    now: new Date(),
  });
  console.log(JSON.stringify(report, null, 2));
  db.close();
  process.exit(report.failed.length > 0 ? 1 : 0);
}
