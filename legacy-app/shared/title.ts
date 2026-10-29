/** Body of a freshly created note: an empty H1 the editor focuses. */
export const EMPTY_NOTE = "# \n\n";

/** Display label from the first ATX heading. Blank headings stay "Untitled". */
export function titleFromMarkdown(content: string): string {
  const body = content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = /^(#{1,6})\s*(.*)$/.exec(trimmed);
    if (!heading) break;
    return heading[2].trim() || "Untitled";
  }
  return "Untitled";
}

/** Replace or insert the first heading line. The file path stays unchanged. */
export function replaceMarkdownTitle(content: string, title: string): string {
  const heading = `# ${title.trim() || "Untitled"}`;
  const normalized = content.replace(/^\uFEFF/, "");
  const fence = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/.exec(normalized);
  const head = fence?.[1] ?? "";
  const rest = normalized.slice(head.length);
  const lines = rest.split(/\r?\n/);
  if (lines.length === 0) return `${head}${heading}\n\n`;
  if (/^#{1,6}(\s.*)?$/.test(lines[0])) {
    lines[0] = heading;
    return head + lines.join("\n");
  }
  return `${head}${heading}\n\n${rest}`;
}

/** Next "Title copy" / "Title copy 2" label that is not already used by a sibling. */
export function duplicateTitle(title: string, siblingNames: readonly string[]): string {
  const stem = title.trim() || "Untitled";
  const taken = new Set(siblingNames.map((name) => name.trim().toLowerCase()));
  const first = `${stem} copy`;
  if (!taken.has(first.toLowerCase())) return first;
  let n = 2;
  while (taken.has(`${stem} copy ${n}`.toLowerCase())) n += 1;
  return `${stem} copy ${n}`;
}

export function displayEntryName(name: string): string {
  const stem = name.replace(/\.md$/i, "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-\d+)?$/i.test(stem)) {
    return "Untitled";
  }
  return stem || "Untitled";
}
