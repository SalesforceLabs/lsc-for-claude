import { describe, it, expect } from "vitest";
import type { CliResult, SoqlQueryResult } from "../../../src/salesforce/cli.js";
import { memoizeQuerier, type OrgQuerier } from "../../../src/perf/sync-volume.js";

const ok = (records: Record<string, unknown>[]): CliResult<SoqlQueryResult> => ({
  success: true,
  data: { totalSize: records.length, done: true, records },
});

function counting(answer: (q: string, n: number) => Promise<CliResult<SoqlQueryResult>>) {
  const seen: string[] = [];
  const org: OrgQuerier = {
    soql: (q) => (seen.push(q), answer(q, seen.length)),
    tooling: (q) => (seen.push("T:" + q), answer(q, seen.length)),
  };
  return { org, seen };
}

describe("memoizeQuerier", () => {
  it("answers an identical query once, including concurrent ones", async () => {
    const { org, seen } = counting(async () => ok([{ n: 1 }]));
    const m = memoizeQuerier(org);
    const [a, b] = await Promise.all([m.soql("SELECT COUNT() FROM Account"), m.soql("SELECT COUNT() FROM Account")]);
    await m.soql("SELECT COUNT() FROM Account");
    expect(a).toBe(b);
    expect(seen).toHaveLength(1);
  });

  it("keeps different queries, kinds and row caps apart", async () => {
    const { org, seen } = counting(async () => ok([]));
    const m = memoizeQuerier(org);
    await m.soql("SELECT Id FROM A");
    await m.soql("SELECT Id FROM B");
    await m.tooling("SELECT Id FROM A");
    await m.soql("SELECT Id FROM A", { maxRows: 10 });
    expect(seen).toHaveLength(4);
  });

  it("does not keep a failed or rejected answer", async () => {
    let calls = 0;
    const { org } = counting(async () => {
      calls++;
      if (calls === 1) return { success: false, error: "boom" } as CliResult<SoqlQueryResult>;
      if (calls === 2) throw new Error("net");
      return ok([{ n: 3 }]);
    });
    const m = memoizeQuerier(org);
    expect((await m.soql("q")).success).toBe(false);
    await expect(m.soql("q")).rejects.toThrow("net");
    expect((await m.soql("q")).success).toBe(true);
    await m.soql("q");
    expect(calls).toBe(3);
  });
});
