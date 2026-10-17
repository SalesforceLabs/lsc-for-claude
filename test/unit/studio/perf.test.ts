import { describe, it, expect, vi } from "vitest";
import type { OrgQuerier } from "../../../src/perf/sync-volume.js";
import type { NfrProfile } from "../../../src/perf/nfr.js";

vi.mock("../../../src/salesforce/cli.js", () => ({
  runSoqlQuery: vi.fn(),
  runToolingQuery: vi.fn(),
  cachedDescribeSObject: vi.fn(),
}));
vi.mock("../../../src/perf/assessment.js", () => ({
  runAssessment: vi.fn(),
}));

const { runSoqlQuery } = await import("../../../src/salesforce/cli.js");
const { runAssessment } = await import("../../../src/perf/assessment.js");
const { startPerfRun, perfRunStatus, cancelPerfRun, activePerfRun, searchPerfUsers } = await import("../../../src/studio/perf.js");

const profile: NfrProfile = { name: "Plan", personas: [{ name: "Rep", users: ["rep@example.com"] }] };

const ok = (records: Record<string, unknown>[]) => ({ success: true, data: { totalSize: records.length, done: true, records } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deps whose queriers record which org they were made for. */
function deps() {
  const made: string[] = [];
  return {
    made,
    deps: {
      querier: (org: string): OrgQuerier => {
        made.push(org);
        return { soql: async () => ok([]) as never, tooling: async () => ok([]) as never };
      },
      telemetryFields: () => async () => new Set<string>(),
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("startPerfRun", () => {
  let org = 0;
  // Each test uses its own org so a run left by one test doesn't trip another's in-progress guard.
  const nextOrg = () => `org${++org}`;

  it("reports steps and query counts while running, then the result", async () => {
    const done = deferred<unknown>();
    let configOrg: OrgQuerier | undefined;
    vi.mocked(runAssessment).mockImplementation((async (_p, _o, config, _count, _fields, opts) => {
      configOrg = config;
      opts?.onStep?.("Rep (1/1): Reading DB Schema records");
      return done.promise;
    }) as never);
    const { deps: d, made } = deps();
    const o = nextOrg();

    const started = startPerfRun(profile, o, d);
    expect(started).toMatchObject({ org: o, state: "running" });
    expect(started).not.toHaveProperty("cancelled");
    expect(made).toEqual([o]);

    await configOrg?.soql("SELECT Id FROM Account");
    await configOrg?.tooling("SELECT Id FROM LifeSciConfigRecord");
    expect(perfRunStatus(started.jobId)).toMatchObject({ step: "Rep (1/1): Reading DB Schema records", queries: 2 });

    done.resolve({ status: "pass" });
    await settle();
    expect(perfRunStatus(started.jobId)).toMatchObject({ state: "done", step: "Finished", result: { status: "pass" } });
    expect(perfRunStatus(started.jobId).finishedAt).toBeDefined();
  });

  it("refuses a second run for the same org while one is running", async () => {
    const done = deferred<unknown>();
    vi.mocked(runAssessment).mockImplementation((() => done.promise) as never);
    const o = nextOrg();
    startPerfRun(profile, o, deps().deps);
    expect(() => startPerfRun(profile, o, deps().deps)).toThrow(/already in progress/);
    expect(() => startPerfRun(profile, nextOrg(), deps().deps)).not.toThrow();
    done.resolve({ status: "pass" });
    await settle();
    // Finished runs no longer block the org.
    expect(() => startPerfRun(profile, o, deps().deps)).not.toThrow();
    await settle();
  });

  it("rejects a plan with no personas", () => {
    expect(() => startPerfRun({ name: "Empty", personas: [] }, nextOrg(), deps().deps)).toThrow(/persona/);
  });

  it("stops issuing queries once cancelled and ends as cancelled", async () => {
    const done = deferred<unknown>();
    let configOrg: OrgQuerier | undefined;
    vi.mocked(runAssessment).mockImplementation((async (_p, _o, config) => {
      configOrg = config;
      return done.promise;
    }) as never);
    const started = startPerfRun(profile, nextOrg(), deps().deps);

    expect(cancelPerfRun(started.jobId)).toMatchObject({ state: "running", step: "Cancelling…" });
    await expect(configOrg?.soql("SELECT Id FROM Account")).rejects.toThrow("Run cancelled");

    // The assessment catches per-table errors, so it may still resolve — the run is cancelled either way.
    done.resolve({ status: "pass" });
    await settle();
    const status = perfRunStatus(started.jobId);
    expect(status).toMatchObject({ state: "cancelled", step: "Cancelled" });
    expect(status.result).toBeUndefined();
  });

  it("records the error when the assessment fails", async () => {
    vi.mocked(runAssessment).mockImplementation((async () => {
      throw new Error("No DB Schema category");
    }) as never);
    const started = startPerfRun(profile, nextOrg(), deps().deps);
    await settle();
    expect(perfRunStatus(started.jobId)).toMatchObject({ state: "failed", error: "No DB Schema category" });
  });

  it("keeps the latest structured progress, as a copy", async () => {
    const done = deferred<unknown>();
    vi.mocked(runAssessment).mockImplementation((async (_p, _o, _c, _count, _fields, opts) => {
      opts?.onStep?.("Rep (1/2): Loading a@x", { persona: 1, personas: 2, user: 1, users: 3 });
      opts?.onStep?.("Rep (1/2): Counting 4 tables for a@x", {
        persona: 1,
        personas: 2,
        user: 1,
        users: 3,
        tables: { done: 2, total: 4 },
      });
      opts?.onStep?.("Rep (1/2): Checking object sharing");
      return done.promise;
    }) as never);
    const started = startPerfRun(profile, nextOrg(), deps().deps);
    await settle();

    const status = perfRunStatus(started.jobId);
    expect(status).toMatchObject({
      step: "Rep (1/2): Checking object sharing",
      progress: { persona: 1, personas: 2, user: 1, users: 3, tables: { done: 2, total: 4 } },
    });
    if (status.progress) status.progress.persona = 99;
    expect(perfRunStatus(started.jobId).progress?.persona).toBe(1);
    done.resolve({ status: "pass" });
    await settle();
  });

  it("returns the org's running job as the active run, and null once it finishes", async () => {
    const done = deferred<unknown>();
    vi.mocked(runAssessment).mockImplementation((() => done.promise) as never);
    const o = nextOrg();
    expect(activePerfRun(o)).toBeNull();
    const started = startPerfRun(profile, o, deps().deps);
    expect(activePerfRun(o)).toMatchObject({ jobId: started.jobId, state: "running" });
    expect(activePerfRun(nextOrg())).toBeNull();
    done.resolve({ status: "pass" });
    await settle();
    expect(activePerfRun(o)).toBeNull();
  });

  it("throws for an unknown job", () => {
    expect(() => perfRunStatus("perf-missing")).toThrow(/no longer available/);
    expect(() => cancelPerfRun("perf-missing")).toThrow(/no longer available/);
  });
});

describe("searchPerfUsers", () => {
  it("escapes the search, filters by profile, and sorts by territory count", async () => {
    const queries: string[] = [];
    vi.mocked(runSoqlQuery).mockImplementation((async (q: string) => {
      queries.push(q);
      if (q.includes("FROM User ")) {
        return ok([
          { Id: "005A", Username: "a@x", Name: "Alice", Profile: { Name: "Field Sales" } },
          { Id: "005B", Username: "b@x", Name: "Bob", Profile: { Name: "Field Sales" } },
          { Id: "005C", Username: "c@x", Name: "Cy", Profile: { Name: "Field Sales" } },
        ]);
      }
      return ok([
        { UserId: "005B", cnt: 4 },
        { UserId: "005C", expr0: 4 },
        { UserId: "005A", cnt: 1 },
      ]);
    }) as never);

    const users = await searchPerfUsers({ search: "o'b_%", profile: "Field Sales" }, "org");

    expect(queries[0]).toContain("(Name LIKE '%o\\'b\\_\\%%' OR Username LIKE '%o\\'b\\_\\%%')");
    expect(queries[0]).toContain("Profile.Name = 'Field Sales'");
    expect(queries[1]).toContain("UserId IN ('005A','005B','005C')");
    expect(queries[1]).toContain("Territory2.Territory2Model.State = 'Active'");
    expect(users.map((u) => [u.name, u.territories])).toEqual([
      ["Bob", 4],
      ["Cy", 4],
      ["Alice", 1],
    ]);
    expect(users[0]).toMatchObject({ id: "005B", username: "b@x", profile: "Field Sales" });
  });

  it("skips the territory query when no users match", async () => {
    vi.mocked(runSoqlQuery).mockResolvedValue(ok([]) as never);
    expect(await searchPerfUsers({}, "org")).toEqual([]);
    expect(runSoqlQuery).toHaveBeenCalledTimes(1);
  });
});
