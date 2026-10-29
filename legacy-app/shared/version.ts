/** `major.minor.patch` with an optional `-prerelease`. scripts/pack-release.mjs uses the same rules. */
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isVersion(value: string): boolean {
  return VERSION_RE.test(value);
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal. A prerelease sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const left = VERSION_RE.exec(a);
  const right = VERSION_RE.exec(b);
  if (!left || !right) throw new Error(`Cannot compare versions ${a} and ${b}`);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  const leftPre = left[4] ?? "";
  const rightPre = right[4] ?? "";
  if (leftPre === rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;
  return leftPre < rightPre ? -1 : 1;
}
