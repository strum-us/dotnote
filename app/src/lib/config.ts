export const ROOT_KEYS = ["notes"] as const;

export type RootKey = (typeof ROOT_KEYS)[number];

export function isRootKey(value: string): value is RootKey {
  return (ROOT_KEYS as readonly string[]).includes(value);
}

export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}
