const IMAGE_VERBS =
  /\b(generate|create|make|draw|design|render|produce|illustrate|paint|sketch)\b/i;
const IMAGE_NOUNS =
  /\b(image|picture|photo|illustration|graphic|thumbnail|logo|icon|banner|poster|artwork|diagram)\b/i;

/** True when the user likely wants a rendered image, not prose about one. */
export function looksLikeImageRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (IMAGE_NOUNS.test(trimmed) && IMAGE_VERBS.test(trimmed)) return true;
  if (/^image\s*:/i.test(trimmed)) return true;
  if (/\bimage prompt\b/i.test(trimmed)) return true;
  return false;
}

/** Strip meta phrasing so the image model gets a visual description. */
export function normalizeImagePrompt(instruction: string): string {
  let text = instruction.trim();
  text = text.replace(/^\*\*image prompt:\*\*\s*/i, "");
  text = text.replace(/^image\s*:\s*/i, "");
  text = text.replace(
    /^(please\s+)?(generate|create|make|draw)\s+(an?\s+)?(image|picture|illustration|graphic)\s+(of|for|showing)?\s*/i,
    "",
  );
  return text.trim() || instruction.trim();
}
