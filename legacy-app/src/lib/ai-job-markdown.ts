const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#ecebe8"/></svg>';

/** Visible stand-in while a generation job is in flight. Intrinsic 16:9 so the block has a box. */
export const AI_JOB_PLACEHOLDER_URL = `data:image/svg+xml,${encodeURIComponent(PLACEHOLDER_SVG)}`;

const JOB_NAME_PREFIX = "ai-job:";

export function aiJobImageName(jobId: string): string {
  return `${JOB_NAME_PREFIX}${jobId}`;
}

export function isAiJobImageName(name: string): boolean {
  return name.startsWith(JOB_NAME_PREFIX);
}

/** Drop in-flight placeholders so they never land in the saved note. */
export function stripAiJobImages(markdown: string): string {
  const stripped = markdown.replace(/^[ \t]*!\[[^\]]*ai-job:[^\]\n]*\]\([^)\n]*\)\n*/gm, "");
  if (stripped === markdown) return markdown;
  return stripped.replace(/\n{3,}/g, "\n\n");
}
