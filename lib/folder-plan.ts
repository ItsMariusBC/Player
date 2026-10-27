// lib/folder-plan.ts
// Maps the relative folder paths of dropped files to existing folders and the folders to
// create. Pure: the caller creates the folders in order, then sends the files.
import type { FolderNode } from "@/lib/catalog";

export interface FolderCreate {
  /** The path joined with "/"; identifies the folder inside the plan. */
  key: string;
  /** An existing folder id, an earlier create's key, or null for the top level. */
  parentKey: string | null;
  name: string;
}

export interface FolderPlan {
  creates: FolderCreate[];
  /** Path key to an existing folder id or a create key. The empty path maps to rootId. */
  resolve: Map<string, string | null>;
}

export const pathKey = (path: readonly string[]): string => path.join("/");

export function planFolders(
  tree: FolderNode[],
  rootId: string | null,
  paths: string[][],
): FolderPlan {
  const creates: FolderCreate[] = [];
  const resolve = new Map<string, string | null>();
  resolve.set("", rootId);

  const childrenOf = (parent: string | null): FolderNode[] => {
    if (parent === null) return tree;
    const stack = [...tree];
    for (let node = stack.pop(); node; node = stack.pop()) {
      if (node.id === parent) return node.children;
      stack.push(...node.children);
    }
    return [];
  };

  // Parent id of a folder known to exist, or the create key of a folder to make.
  const existing = new Set<string>();
  for (const path of paths) {
    let parent: string | null = rootId;
    let parentIsExisting = true;
    for (let depth = 1; depth <= path.length; depth++) {
      const segments = path.slice(0, depth);
      const key = pathKey(segments);
      const known = resolve.get(key);
      if (known !== undefined) {
        parent = known;
        parentIsExisting = existing.has(key);
        continue;
      }
      const name = segments[depth - 1] ?? "";
      const match: FolderNode | undefined = parentIsExisting
        ? childrenOf(parent).find((node) => node.name === name)
        : undefined;
      if (match) {
        resolve.set(key, match.id);
        existing.add(key);
        parent = match.id;
        parentIsExisting = true;
      } else {
        creates.push({ key, parentKey: parent, name });
        resolve.set(key, key);
        parent = key;
        parentIsExisting = false;
      }
    }
  }
  return { creates, resolve };
}
