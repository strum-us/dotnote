/**
 * Line + word diff of a history snapshot against the current editor buffer.
 */

export type InlinePart = {
  text: string;
  changed: boolean;
};

export type DiffRow =
  | { type: "equal"; text: string }
  | { type: "add"; text: string; parts: InlinePart[] }
  | { type: "remove"; text: string; parts: InlinePart[] };

type SeqOp = { type: "equal" | "add" | "remove"; value: string };

/** LCS on arrays larger than this is skipped in favor of a coarse replace. */
const MAX_LCS_CELLS = 1_500 * 1_500;

const WORD_SPLIT = /(\s+)/;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

function tokenizeLine(line: string): string[] {
  if (line === "") return [""];
  return line.split(WORD_SPLIT).filter((token) => token.length > 0);
}

function lcsOps(a: string[], b: string[]): SeqOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((value) => ({ type: "add" as const, value }));
  if (m === 0) return a.map((value) => ({ type: "remove" as const, value }));
  if (n * m > MAX_LCS_CELLS) {
    return [
      ...a.map((value) => ({ type: "remove" as const, value })),
      ...b.map((value) => ({ type: "add" as const, value })),
    ];
  }

  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i += 1) {
    const ai = a[i - 1];
    const row = dp[i];
    const prev = dp[i - 1];
    for (let j = 1; j <= m; j += 1) {
      row[j] = ai === b[j - 1] ? prev[j - 1] + 1 : prev[j] > row[j - 1] ? prev[j] : row[j - 1];
    }
  }

  const ops: SeqOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: "equal", value: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "remove", value: a[i - 1] });
      i -= 1;
    } else {
      ops.push({ type: "add", value: b[j - 1] });
      j -= 1;
    }
  }
  while (i > 0) {
    ops.push({ type: "remove", value: a[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    ops.push({ type: "add", value: b[j - 1] });
    j -= 1;
  }
  ops.reverse();
  return ops;
}

function inlineParts(from: string, to: string): { from: InlinePart[]; to: InlinePart[] } {
  const a = tokenizeLine(from);
  const b = tokenizeLine(to);
  const ops = lcsOps(a, b);
  const fromParts: InlinePart[] = [];
  const toParts: InlinePart[] = [];
  for (const op of ops) {
    if (op.type === "equal") {
      fromParts.push({ text: op.value, changed: false });
      toParts.push({ text: op.value, changed: false });
    } else if (op.type === "remove") {
      fromParts.push({ text: op.value, changed: true });
    } else {
      toParts.push({ text: op.value, changed: true });
    }
  }
  return { from: fromParts, to: toParts };
}

function wholeLine(text: string): InlinePart[] {
  return [{ text, changed: true }];
}

/**
 * Diff `backup` (the selected history snapshot) against `current` (the
 * open editor buffer). `add` = only in this snapshot; `remove` = only
 * in the current file.
 */
export function diffAgainstCurrent(current: string, backup: string): DiffRow[] {
  const a = splitLines(current);
  const b = splitLines(backup);
  const ops = lcsOps(a, b);

  const rows: DiffRow[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      rows.push({ type: "equal", text: ops[i].value });
      i += 1;
      continue;
    }

    const removes: string[] = [];
    const adds: string[] = [];
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "remove") removes.push(ops[i].value);
      else adds.push(ops[i].value);
      i += 1;
    }

    if (removes.length === adds.length && removes.length > 0) {
      for (let k = 0; k < removes.length; k += 1) {
        const parts = inlineParts(removes[k], adds[k]);
        rows.push({ type: "remove", text: removes[k], parts: parts.from });
        rows.push({ type: "add", text: adds[k], parts: parts.to });
      }
    } else {
      for (const text of removes) {
        rows.push({ type: "remove", text, parts: wholeLine(text) });
      }
      for (const text of adds) {
        rows.push({ type: "add", text, parts: wholeLine(text) });
      }
    }
  }

  return rows;
}

export function diffHasChanges(rows: DiffRow[]): boolean {
  return rows.some((row) => row.type !== "equal");
}
