import type { FolderNode, FolderRecord } from "./types.ts";

/** Builds the nested folder tree; siblings are ordered by position. */
export function buildFolderTree(folders: FolderRecord[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  for (const f of folders) {
    nodes.set(f.id, { id: f.id, name: f.name, position: f.position, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = nodes.get(f.id)!;
    const parent = f.parentId === null ? undefined : nodes.get(f.parentId);
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => a.position - b.position);
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}
