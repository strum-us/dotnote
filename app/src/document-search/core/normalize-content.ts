/**
 * Strip YAML frontmatter and Markdown syntax from raw document content,
 * producing plain text suitable for full-body search indexing.
 *
 * Frontmatter (`---\n...\n---`) is removed entirely. Markdown constructs
 * (headings, emphasis, links, code fences, inline code, blockquotes, list
 * markers, HTML tags) are reduced to their textual content so MiniSearch
 * tokenizes words rather than punctuation.
 */
export function normalizeContent(raw: string): string {
  let text = stripFrontmatter(raw);
  text = stripCodeFences(text);
  text = stripInlineCode(text);
  text = stripHtmlTags(text);
  text = stripLinkTargets(text);
  text = stripMarkdownSyntax(text);
  return collapseWhitespace(text);
}

/**
 * Leading YAML frontmatter fence. Allows a BOM, optional spaces on the
 * fence lines, and CRLF. The closing `---` must be on its own line.
 */
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** Identifier-style YAML key plus a scalar / collection value. */
const YAML_PROPERTY_LINE_RE = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;

/** Remove a leading `---\n...\n---` YAML block, if present. */
export function stripFrontmatter(text: string): string {
  const match = text.match(FRONTMATTER_RE);
  if (!match) return text;
  return text.slice(match[0].length).replace(/^\uFEFF?[\t ]*\r?\n/, "");
}

/**
 * True when a line (or heading text) is a YAML property (`title: "…"`),
 * not prose like `Note: this is important`.
 */
export function isYamlPropertyLine(text: string): boolean {
  const match = text.match(YAML_PROPERTY_LINE_RE);
  if (!match) return false;
  const value = match[2].trim();
  if (!value) return true;
  if (/^["'].*["']$/.test(value)) return true;
  if (/^[\[{]/.test(value)) return true;
  return !/\s/.test(value);
}

/**
 * First ATX heading in the markdown body. Frontmatter is stripped so a
 * `title:` property cannot win, and headings that are themselves YAML
 * properties (editor / setext leftovers) are skipped.
 */
export function extractFirstMarkdownHeading(rawContent: string): string | null {
  const body = stripFrontmatter(rawContent);
  const headingRe = /^#{1,6}\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(body)) !== null) {
    const title = match[1].trim();
    if (!title || isYamlPropertyLine(title)) continue;
    return title;
  }
  return null;
}

/** Replace fenced code blocks (``` or ~~~) with a space placeholder. */
function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
}

/** Replace inline code spans (`...`) with their inner text. */
function stripInlineCode(text: string): string {
  return text.replace(/`([^`]+)`/g, "$1");
}

/** Drop raw HTML tags, keeping their inner text. */
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, " ");
}

/** Keep link text, drop the URL: `[label](url)` → `label`. */
function stripLinkTargets(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/** Remove remaining Markdown emphasis/heading/list/blockquote markers. */
function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/^>\s*/gm, "")
    .replace(/[*_~]+/g, "");
}

function collapseWhitespace(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
