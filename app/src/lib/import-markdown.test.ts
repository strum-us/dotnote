import assert from "node:assert/strict";
import {
  applyImportedAssets,
  buildFolderPlan,
  collectNoteAssets,
  ensureImportTitle,
  parentFolderId,
  relativeImportPath,
  resolveLocalPath,
} from "./import-markdown";

const files = new Map<string, { size: number; mimeType: string }>([
  ["notes/hello.md", { size: 20, mimeType: "text/markdown" }],
  ["notes/pic.png", { size: 10, mimeType: "image/png" }],
  ["notes/clip.mp4", { size: 10, mimeType: "video/mp4" }],
  ["other.md", { size: 10, mimeType: "text/markdown" }],
]);

const known = new Set(files.keys());
assert.equal(resolveLocalPath("notes/hello.md", "./pic.png", known), "notes/pic.png");
assert.equal(resolveLocalPath("notes/hello.md", "../secret.png", known), null);
assert.equal(resolveLocalPath("notes/hello.md", "https://example.com/a.png", known), null);

const source = `# Hello

![shot](./pic.png)
![[clip.mp4]]
[page](./other.md)

\`![shot](./pic.png)\`
`;

const noteId = "11111111-1111-4111-8111-111111111111";
const collected = collectNoteAssets(source, "notes/hello.md", files);
assert.equal(collected.assets.length, 2);
assert.equal(collected.errors.length, 0);
assert.ok(collected.assets.some((asset) => asset.sourcePath === "notes/pic.png"));
assert.ok(collected.assets.some((asset) => asset.sourcePath === "notes/clip.mp4"));

const rewritten = applyImportedAssets(source, "notes/hello.md", noteId, collected.assets);
assert.match(rewritten, /!\[shot\]\(\.\/\.11111111-1111-4111-8111-111111111111\/.+?\.png\)/);
assert.match(rewritten, /<video src="\.\/\.11111111-1111-4111-8111-111111111111\/.+?\.mp4" controls><\/video>/);
assert.match(rewritten, /\[page\]\(\.\/other\.md\)/);
assert.match(rewritten, /`!\[shot\]\(\.\/pic\.png\)`/);

const folders = buildFolderPlan(["notes/hello.md", "notes/nested/deep.md", "root.md"]);
assert.deepEqual(
  folders.map((folder) => folder.sourcePath),
  ["notes", "notes/nested"],
);
assert.equal(parentFolderId(folders, "notes/nested/deep.md"), folders[1]?.id);
assert.equal(parentFolderId(folders, "root.md"), null);
assert.equal(ensureImportTitle("just text\n", "guides/alpha.md").startsWith("# alpha"), true);
assert.equal(relativeImportPath("Vault/notes/a.md"), "notes/a.md");
assert.equal(relativeImportPath("Vault/.git/config"), null);

console.log("import-markdown ok");
