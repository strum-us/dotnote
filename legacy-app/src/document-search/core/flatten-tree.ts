import { isMarkdownPath } from "@/lib/config";
import type { TreeNode } from "@/lib/api";

/**
 * Walk a Dotnote tree and return the paths of every note.
 * Order is depth-first so index builds stay deterministic.
 */
export function flattenMarkdownPaths(tree: TreeNode[]): string[] {
  const out: string[] = [];
  walk(tree, out);
  return out;
}

function walk(nodes: TreeNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === "folder") {
      if (node.children) walk(node.children, out);
      continue;
    }
    if (node.type === "note" || isMarkdownPath(node.path)) out.push(node.path);
  }
}
