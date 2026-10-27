export interface FolderRecord {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
}

export interface TrackRecord {
  id: string;
  folderId: string | null;
  title: string;
  artist: string;
  album: string;
  durationMs: number | null;
  format: "flac" | "mp3" | "wav";
  sizeBytes: number;
  sha256: string;
  coverExt: string | null;
  status: "ready" | "failed";
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export class NotFoundError extends Error {
  readonly code: string = "not_found";
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class FolderConflictError extends Error {
  readonly code: string = "folder_conflict";
  constructor(message = "A folder with this name already exists here") {
    super(message);
    this.name = "FolderConflictError";
  }
}

export class FolderCycleError extends Error {
  readonly code: string = "folder_cycle";
  constructor(message = "A folder cannot be moved into itself or its descendants") {
    super(message);
    this.name = "FolderCycleError";
  }
}

export class FolderNotEmptyError extends Error {
  readonly code: string = "folder_not_empty";
  constructor(message = "The folder is not empty") {
    super(message);
    this.name = "FolderNotEmptyError";
  }
}
