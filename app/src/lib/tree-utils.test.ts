import assert from "node:assert/strict";
import type { TreeNode } from "@shared/types";
import { emptyManifest, moveEntry } from "@shared/manifest";
import { applyOp } from "@/lib/sync-ops";
import { sidebarTree, sortSidebarNodes } from "./tree-utils";

const note = (id: string, name: string, extra: Partial<TreeNode> = {}): TreeNode => ({
  id,
  type: "note",
  name,
  path: `${id}.md`,
  parentPath: "",
  ...extra,
});

const folder = (id: string, name: string, children: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode => ({
  id,
  type: "folder",
  name,
  path: name,
  parentPath: "",
  children,
  ...extra,
});

const hidden = folder("h1", ".assets", [note("n1", "Inside hidden")]);
const visible = folder("v1", "Docs", [hidden, note("n2", "Top note")]);

assert.deepEqual(
  sidebarTree([visible]).map((n) => n.name),
  ["Docs"],
);
assert.deepEqual(
  sidebarTree([visible])[0]?.children?.map((n) => n.name),
  ["Inside hidden", "Top note"],
);

const rootMixed = [note("n1", "zebra"), folder("f1", "alpha"), note("n2", "beta")];
assert.deepEqual(
  sortSidebarNodes(rootMixed).map((n) => n.name),
  ["alpha", "beta", "zebra"],
);

const byUpdated = sortSidebarNodes(
  [
    note("a", "a", { updatedAt: "2020-01-01T00:00:00.000Z" }),
    note("b", "b", { updatedAt: "2024-01-01T00:00:00.000Z" }),
  ],
  { field: "updated", direction: "desc" },
).map((n) => n.id);
assert.deepEqual(byUpdated, ["b", "a"]);

const manifest = emptyManifest();
manifest.entries.push(
  { id: "f1", type: "folder", name: "Projects", path: "projects", parentPath: "" },
  { id: "n1", type: "note", name: "Draft", path: "n1.md", parentPath: "" },
);
applyOp(manifest, { kind: "move", entryId: "n1", parentId: "f1" });
assert.equal(manifest.entries.find((e) => e.id === "n1")?.parentPath, "projects");

const blocked = emptyManifest();
blocked.entries.push(
  { id: "f1", type: "folder", name: "A", path: "a", parentPath: "" },
  { id: "f2", type: "folder", name: "B", path: "a/b", parentPath: "a" },
);
const noop = moveEntry(blocked, "f1", "a/b");
assert.equal(noop?.path, "a");

console.log("tree-utils.test.ts ok");
