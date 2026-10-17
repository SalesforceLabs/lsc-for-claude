/**
 * A small line diff for previews of long text (custom script code): changed
 * lines prefixed "- " / "+ ", a little unchanged context around them, and "…"
 * where unchanged stretches are skipped.
 */

const CONTEXT = 2;
const MAX_CELLS = 4_000_000;

const lines = (text: string) => text.replace(/\r\n/g, "\n").split("\n");

/** Ops for turning `a` into `b`: shared prefix and suffix are trimmed first, then an LCS over what's left. */
function ops(a: string[], b: string[]): { op: " " | "-" | "+"; line: string }[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: { op: " " | "-" | "+"; line: string }[] = a.slice(0, start).map((line) => ({ op: " ", line }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);

  if (x.length * y.length > MAX_CELLS) {
    // Too big to align — show the middle as replaced.
    out.push(...x.map((line) => ({ op: "-" as const, line })), ...y.map((line) => ({ op: "+" as const, line })));
  } else {
    const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        out.push({ op: " ", line: x[i] });
        i++;
        j++;
      } else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
        // Removals come before the additions that replace them.
        out.push({ op: "-", line: x[i++] });
      } else {
        out.push({ op: "+", line: y[j++] });
      }
    }
  }
  out.push(...a.slice(endA).map((line) => ({ op: " " as const, line })));
  return out;
}

/** Diff lines for `before` → `after`; empty when they're identical. */
export function lineDiff(before: string, after: string): string[] {
  const all = ops(lines(before), lines(after));
  if (!all.some((o) => o.op !== " ")) return [];

  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((o, i) => {
    if (o.op === " ") return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(all.length - 1, i + CONTEXT); k++) keep[k] = true;
  });

  const out: string[] = [];
  all.forEach((o, i) => {
    if (keep[i]) out.push(`${o.op} ${o.line}`);
    else if (keep[i - 1] !== false || i === 0) out.push("…");
  });
  // Don't open or close with a skipped stretch.
  while (out[0] === "…") out.shift();
  while (out[out.length - 1] === "…") out.pop();
  return out;
}

export const lineCount = (text: string) => (text ? lines(text).length : 0);
