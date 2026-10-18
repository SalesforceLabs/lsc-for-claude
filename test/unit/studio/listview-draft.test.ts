import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyListViewOps as applyServerOps, listColumns } from "../../../src/studio/metadata/listview-ops.js";
import { liveListViewOf } from "../../../src/studio/metadata/live.js";
import { parseXml, serializeXml } from "../../../src/studio/metadata/xml.js";
import {
  addableColumns,
  alignListView,
  applyListViewOps,
  diffListViewOps,
  draftListColumns,
  filterProblem,
  filtersChanged,
  listColumnVerbs,
  listViewNotes,
  listViewTargetOf,
  listViewVerbs,
  modelOf,
  moveListColumnTo,
  setFilters,
  setScope,
  validLogic,
  type ListViewDraft,
} from "../../../src-renderer/components/studio/listview-draft.js";
import { StaleDraftError } from "../../../src-renderer/components/studio/layout-draft.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { PublishedListView } from "../../../src-renderer/components/studio/published-types.js";
import type { ListViewOp, LiveListView } from "../../../src-renderer/components/studio/types.js";

const xml = readFileSync(join(__dirname, "../../fixtures/metadata/Visit.My_Next_Visits.listView-meta.xml"), "utf8");
const FULL_NAME = "Visit.My_Next_Visits";
const live: LiveListView = {
  ...liveListViewOf(FULL_NAME, parseXml(xml)),
  available: [
    { name: "Name", label: "Visit Name", type: "string", filterable: true },
    { name: "Phone", label: "Phone", type: "phone", filterable: true },
    { name: "IsFutureVisit__c", label: "Is Future Visit", type: "boolean", filterable: true },
    { name: "Notes__c", label: "Notes", type: "textarea", filterable: false },
    { name: "Photo", label: "Photo", type: "base64", filterable: false },
  ],
  production: false,
};
const base = modelOf(live);

const draftOf = (pending: PendingChange[] = []): ListViewDraft => {
  const target = listViewTargetOf(FULL_NAME, base, pending);
  return { fullName: FULL_NAME, label: live.label, live, base, target, shown: target.columns, legacy: false };
};
const opsOf = (pending: PendingChange[]): ListViewOp[] => {
  const fix = pending[0]?.fix;
  return fix?.kind === "editMetadata" ? (fix.ops as ListViewOp[]) : [];
};
const run = (verbs: ReturnType<typeof listColumnVerbs>, id: string, pending: PendingChange[] = []) => verbs.find((v) => v.id === id)!.run!(pending);

describe("list view ops", () => {
  it("diffs a model into ops that reproduce it, and the server agrees", () => {
    const target = { ...base, columns: ["Status", "Name", "Phone", "Account"], filters: [], logic: null };
    const ops = diffListViewOps(base, target);
    expect(applyListViewOps(base, ops)).toEqual(target);
    const serverRoot = applyServerOps(parseXml(xml), ops).root;
    expect(listColumns(serverRoot)).toEqual(target.columns);
  });

  it("leaves no ops when the model is the org's", () => {
    expect(diffListViewOps(base, modelOf(live))).toEqual([]);
  });

  it("throws stale when an op no longer fits", () => {
    expect(() => applyListViewOps(base, [{ op: "removeListColumn", column: "Nope" }])).toThrow(StaleDraftError);
    expect(() => applyListViewOps(base, [{ op: "setListFilterScope", from: "Everything", to: "Mine" }])).toThrow(StaleDraftError);
  });

  it("never lets the last column go", () => {
    const one = { ...base, columns: ["Name"] };
    expect(() => applyListViewOps(one, [{ op: "removeListColumn", column: "Name" }])).toThrow(StaleDraftError);
  });
});

describe("column verbs", () => {
  it("moves a column left and right, and back leaves nothing queued", () => {
    const col = base.columns[2];
    const left = run(listColumnVerbs(draftOf(), col, "C"), "up");
    expect(draftOf(left).target.columns.indexOf(col)).toBe(1);
    const back = run(listColumnVerbs(draftOf(left), col, "C"), "down", left);
    expect(back).toEqual([]);
  });

  it("disables moves at the ends", () => {
    const first = listColumnVerbs(draftOf(), base.columns[0], "A").find((v) => v.id === "up")!;
    expect(first.run).toBeUndefined();
    expect(first.reason).toBeTruthy();
  });

  it("removes a column, offers Restore on the ghost, and restores it in place", () => {
    const col = base.columns[1];
    const removed = run(listColumnVerbs(draftOf(), col, "B"), "remove");
    expect(opsOf(removed)).toEqual([{ op: "removeListColumn", column: col }]);
    const d = draftOf(removed);
    const restored = run(listColumnVerbs(d, col, "B"), "restore", removed);
    expect(restored).toEqual([]);
  });

  it("refuses to remove the only column", () => {
    const d = draftOf();
    const one: ListViewDraft = { ...d, target: { ...d.target, columns: ["Name"] }, shown: ["Name"] };
    expect(listColumnVerbs(one, "Name", "N").find((v) => v.id === "remove")!.run).toBeUndefined();
  });

  it("Add column offers describable fields not already shown, after the selected one", () => {
    const d = draftOf();
    const add = listViewVerbs(d)[0];
    const values = add.pick!.options.map((o) => o.value);
    expect(values).toContain("Phone");
    expect(values).not.toContain("Name"); // already a column? only when it is
    expect(values).not.toContain("Photo");
    expect(values).not.toContain("Notes__c");
    const queued = add.pick!.run("Phone", []);
    expect(draftOf(queued).target.columns.at(-1)).toBe("Phone");
    const after = listColumnVerbs(d, base.columns[0], "A").find((v) => v.id === "addField")!;
    expect(draftOf(after.pick!.run("Phone", [])).target.columns[1]).toBe("Phone");
  });

  it("doesn't offer a lookup's Id field when the view shows the lookup", () => {
    const d = draftOf();
    const withLookup: ListViewDraft = {
      ...d,
      target: { ...d.target, columns: [...d.target.columns, "Account"] },
      live: { ...d.live, available: [...d.live.available, { name: "AccountId", label: "Account ID", type: "reference" }] },
    };
    expect(addableColumns(withLookup).map((a) => a.name)).not.toContain("AccountId");
  });

  it("an old-style view takes only custom fields", () => {
    const legacy: ListViewDraft = { ...draftOf(), legacy: true };
    expect(addableColumns(legacy).map((a) => a.name)).toEqual(["IsFutureVisit__c"]);
  });

  it("stops adding at the column limit", () => {
    const d = draftOf();
    const many: ListViewDraft = { ...d, target: { ...d.target, columns: Array.from({ length: 15 }, (_, i) => `F${i}__c`) } };
    expect(listViewVerbs(many)[0].reason).toMatch(/at most 15/);
  });

  it("drags a column before another, or last", () => {
    const d = draftOf();
    const moved = moveListColumnTo(d, base.columns[0], null, [])!;
    expect(draftOf(moved).target.columns.at(-1)).toBe(base.columns[0]);
    expect(moveListColumnTo(d, base.columns[0], base.columns[0], [])).toEqual([]);
    expect(moveListColumnTo(d, "Nope", null, [])).toBeNull();
  });
});

describe("what the iPad draws", () => {
  const published: PublishedListView = {
    name: "My_Next_Visits",
    label: "My Next Visits",
    columns: base.columns.map((c) => c.toUpperCase()),
    source: { fullName: FULL_NAME, columns: base.columns, filterScope: live.filterScope, filters: live.filters, booleanFilter: live.booleanFilter },
  };

  it("lines up only when the published columns are the org's", () => {
    expect(alignListView(published, base.columns)).toBe(true);
    expect(alignListView(published, [...base.columns].reverse())).toBe(false);
    expect(alignListView({ ...published, source: undefined }, base.columns)).toBe(false);
    expect(alignListView(undefined, base.columns)).toBe(false);
    // The cache names a lookup by its Id field where the view stores the relationship.
    const lookup = { ...published, source: { ...published.source!, columns: ["Name", "AccountId", "OwnerId"] } };
    expect(alignListView(lookup, ["Name", "Account", "Owner"])).toBe(true);
    expect(alignListView(lookup, ["Name", "Owner", "Account"])).toBe(false);
  });

  it("notes filters or scope changed since the publish", () => {
    expect(filtersChanged(published, live)).toBe(false);
    expect(filtersChanged(published, { ...live, filterScope: "Everything" })).toBe(true);
    expect(filtersChanged(published, { ...live, filters: [] })).toBe(live.filters.length > 0);
  });

  it("draws ghosts, added and moved columns with their published cell index", () => {
    const [a, b, c] = base.columns;
    const target = { ...base, columns: [c, a, "Phone"] };
    const cols = draftListColumns(published, live, base.columns, target.columns);
    const by = (id: string) => cols.find((x) => x.id === id)!;
    expect(by(b).state).toBe("removed");
    expect(by(b).orig).toBe(1);
    expect(by("Phone")).toMatchObject({ state: "added", orig: null, label: "Phone" });
    expect(by(c).state).toBe("moved");
    expect(by(a).orig).toBe(0);
  });
});

describe("scope and filters", () => {
  it("sets the scope and drops the change when set back", () => {
    const to = live.filterScope === "Mine" ? "Everything" : "Mine";
    const q = setScope(draftOf(), to, []);
    expect(opsOf(q)).toEqual([{ op: "setListFilterScope", from: live.filterScope, to }]);
    expect(setScope(draftOf(q), live.filterScope!, q)).toEqual([]);
  });

  it("adds a filter row, extending logic with AND", () => {
    const d = draftOf();
    const row = { field: "Name", operation: "contains", value: "x" };
    const q = setFilters(d, [...d.target.filters, row], undefined, [])!;
    expect(draftOf(q).target.filters.at(-1)).toEqual(row);
    const withLogic = setFilters(draftOf(q), draftOf(q).target.filters, "1 AND (2 OR 3)", q)!;
    const third = setFilters(draftOf(withLogic), [...draftOf(withLogic).target.filters, row], undefined, withLogic)!;
    expect(draftOf(third).target.logic).toBe("(1 AND (2 OR 3)) AND 4");
  });

  it("clears logic when rows are removed, and refuses invalid input", () => {
    const d = draftOf();
    expect(setFilters(d, [{ field: "", operation: "equals", value: "" }], undefined, [])).toBeNull();
    expect(filterProblem([{ field: "A", operation: "equals", value: "" }], "1 AND 2")).toMatch(/logic/);
    expect(validLogic("1 AND (2 OR 3)", 3)).toBe(true);
    expect(validLogic("1 AND 2", 3)).toBe(false);
  });

  it("states what the iPad doesn't do", () => {
    const notes = listViewNotes(draftOf());
    expect(notes[0]).toMatch(/Sort/);
    const odd: ListViewDraft = { ...draftOf(), target: { ...base, scope: "Team" } };
    expect(listViewNotes(odd).join(" ")).toMatch(/ignores the "Team"/);
  });
});

describe("round trip", () => {
  it("renderer ops deploy to the list view drawn", () => {
    const d = draftOf();
    let q = run(listColumnVerbs(d, base.columns[0], "A"), "down");
    q = run(listColumnVerbs(draftOf(q), base.columns[3], "D"), "remove", q);
    q = listViewVerbs(draftOf(q))[0].pick!.run("Phone", q);
    const drawn = draftOf(q).target.columns;
    const server = applyServerOps(parseXml(xml), opsOf(q));
    expect(listColumns(server.root)).toEqual(drawn);
    expect(serializeXml(applyServerOps(server.root, server.inverse).root)).toBe(xml);
  });
});
