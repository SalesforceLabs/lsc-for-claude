import { describe, expect, it } from "vitest";
import { changesTouching, refsOfTarget, whereRows } from "../../../src-renderer/components/studio/where-this-is";
import type { PendingChange } from "../../../src-renderer/components/studio/changes";
import type { StudioFix } from "../../../src-renderer/components/studio/types";
import type { UnpublishedItem } from "../../../src-renderer/components/studio/org-ahead";
import type { DraftTab } from "../../../src-renderer/components/studio/edit-draft";

const change = (fix: Partial<StudioFix> & { kind: string }): PendingChange => ({ fix: { label: `${fix.kind} change`, ...fix } as StudioFix });

const layoutEdit = change({ kind: "editMetadata", doc: { type: "Layout", fullName: "Account-Account Layout", label: "Account Layout" }, ops: [] } as never);
const pageEdit = change({ kind: "editMetadata", doc: { type: "FlexiPage", fullName: "Home_Page", label: "Home" }, ops: [] } as never);
const related = change({ kind: "setLayoutRelatedList", layoutName: "Visit-Visit Layout", layoutLabel: "Visit", objectName: "X", relationshipName: "R" } as never);
const field = change({ kind: "setConfigField", category: "UISchema", developerName: "Tab_Accounts", recordLabel: "Accounts", field: "TabOrder", from: 1, to: 2 } as never);
const active = change({ kind: "setActive", record: { type: "validationRule", id: "03d", label: "VR" }, from: true, to: false } as never);
const pending = [layoutEdit, pageEdit, related, field, active];

describe("changesTouching", () => {
  it("matches metadata documents by type and name, ignoring case", () => {
    expect(changesTouching(pending, { docs: [{ type: "Layout", fullName: "account-account layout" }], records: [] })).toEqual([layoutEdit]);
    expect(changesTouching(pending, { docs: [{ type: "Layout", fullName: "Home_Page" }], records: [] })).toEqual([]);
  });

  it("counts a Visit sidebar related-list change against its layout", () => {
    expect(changesTouching(pending, { docs: [{ type: "Layout", fullName: "Visit-Visit Layout" }], records: [] })).toEqual([related]);
  });

  it("matches Admin Console records by DeveloperName and queued creates by identity", () => {
    const create = change({ kind: "createConfigRecord", category: "UISchema", developerName: "New_Tab" } as never);
    expect(changesTouching([...pending, create], { docs: [], records: ["Tab_Accounts"], creates: [create] })).toEqual([field, create]);
  });
});

describe("refsOfTarget", () => {
  const tabs = [
    { tab: { fullName: "Tab_A" }, state: "same", item: { edit: { record: { type: "config", category: "UISchema", developerName: "Tab_A_Dev", label: "A" } } } },
    { tab: { fullName: "standard-Account" }, state: "same" },
  ] as unknown as DraftTab[];

  it("reads a UI Settings tab's record, and an app tab's app", () => {
    expect(refsOfTarget({ kind: "tab", fullName: "Tab_A", label: "A", index: 0 }, { tabs, homeMenu: [], app: "LSC_App" })).toEqual({ docs: [], records: ["Tab_A_Dev"], creates: [] });
    expect(refsOfTarget({ kind: "tab", fullName: "standard-Account", label: "Accounts", index: 1 }, { tabs, homeMenu: [], app: "LSC_App" }).docs).toEqual([
      { type: "CustomApplication", fullName: "LSC_App" },
    ]);
  });

  it("names the list view a column belongs to", () => {
    expect(
      refsOfTarget({ kind: "listColumn", object: "Account", listView: "Account.Mine", viewLabel: "Mine", column: "Name", label: "Name" }, { tabs: [], homeMenu: [] }).docs
    ).toEqual([{ type: "ListView", fullName: "Account.Mine" }]);
  });
});

describe("whereRows", () => {
  const ahead = (extra: Partial<UnpublishedItem> = {}): UnpublishedItem => ({
    id: "1",
    kind: "layout",
    name: "A",
    label: "A",
    lastModifiedAt: "2026-10-17T12:00:00.000Z",
    lastModifiedBy: "Ann",
    target: "A",
    ...extra,
  });

  it("says nothing is waiting when the tray, org and iPads agree", () => {
    const rows = whereRows({ mine: [], publishedAt: "2026-10-01T12:00:00.000Z" });
    expect(rows.map((r) => r.text)).toEqual(["None queued", "Same as on iPads", expect.stringMatching(/^Published /)]);
    expect(rows[0].quiet && rows[1].quiet).toBe(true);
  });

  it("names the org's change and that iPads don't have it", () => {
    const rows = whereRows({ mine: [layoutEdit, pageEdit], orgAhead: ahead(), publishedAt: "2026-10-01T12:00:00.000Z" });
    expect(rows[0].text).toBe("2 queued: editMetadata change, …");
    expect(rows[0].title).toBe("editMetadata change\neditMetadata change");
    expect(rows[1].text).toMatch(/^Changed on .* by Ann$/);
    expect(rows[2].text).toMatch(/without the org's change$/);
  });

  it("says live items are already on iPads", () => {
    const rows = whereRows({ mine: [], orgAhead: ahead({ live: true, lastModifiedBy: null }), publishedAt: null });
    expect(rows[1].text).not.toMatch(/ by /);
    expect(rows[2].text).toBe("Read from the org, so reps already have it");
  });

  it("says the org moved on when the draft sees it, even without an unpublished item", () => {
    const rows = whereRows({ mine: [], orgDiffers: true, publishedAt: "2026-10-01T12:00:00.000Z" });
    expect(rows[1]).toMatchObject({ text: "Changed in Setup since the publish" });
    expect(rows[1].quiet).toBeUndefined();
    expect(rows[2].text).toMatch(/without the org's change$/);
  });

  it("says when the profile was never published", () => {
    expect(whereRows({ mine: [], publishedAt: null })[2].text).toBe("Not published yet");
  });
});
