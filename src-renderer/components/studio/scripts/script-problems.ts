import type { ScriptDiagnostic } from "./script-model";

export interface ProblemCounts {
  error: number;
  warning: number;
  info: number;
}

export function countProblems(diags: readonly Pick<ScriptDiagnostic, "severity">[]): ProblemCounts {
  const out: ProblemCounts = { error: 0, warning: 0, info: 0 };
  for (const d of diags) out[d.severity] += 1;
  return out;
}

/** The 1-based line and column an offset falls on (offsets past the end land on the last position). */
export function lineColumn(code: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, code.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (code.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: at - lineStart + 1 };
}

/** "1 error", "2 warnings", "1 note". */
export function problemLabel(severity: ScriptDiagnostic["severity"], n: number): string {
  const noun = severity === "info" ? "note" : severity;
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Problems worst first, then in code order — the order the strip lists them. */
export function sortProblems<T extends Pick<ScriptDiagnostic, "severity" | "from">>(diags: readonly T[]): T[] {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return [...diags].sort((a, b) => rank[a.severity] - rank[b.severity] || a.from - b.from);
}

/** What "Ask Roz to fix" puts in the composer for one problem, for the user to add context to. */
export function fixProblemText(diag: Pick<ScriptDiagnostic, "message" | "from" | "to">, line: number): string {
  const wholeScript = diag.from === 0 && diag.to === 0;
  return wholeScript ? `Fix this: ${diag.message}` : `Fix this: ${diag.message} (line ${line})`;
}

/** Which problem of a severity a click on its chip goes to next: it steps through them, wrapping. */
export function nextOfSeverity<T extends Pick<ScriptDiagnostic, "severity" | "from">>(diags: readonly T[], severity: ScriptDiagnostic["severity"], current: number | null): T | null {
  const same = diags.filter((d) => d.severity === severity).sort((a, b) => a.from - b.from);
  if (!same.length) return null;
  const after = same.find((d) => current === null || d.from > current);
  return after ?? same[0];
}
