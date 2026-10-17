import { describe, it, expect } from "vitest";
import {
  effectiveProfiles,
  isQueued,
  profileChange,
  publishProfiles,
  queueChange,
  activeChange,
  effectiveActive,
  layoutChange,
  scriptChange,
} from "../../../src-renderer/components/studio/changes.js";
import type { ItemEdit } from "../../../src-renderer/components/studio/types.js";

const record = { type: "config" as const, category: "QuickAction", developerName: "New_Visit", label: "New Visit" };
const fieldEdit: ItemEdit = { record, active: true, profiles: { source: "field", raw: "System Administrator;LS MT Rep" } };

describe("pending changes", () => {
  it("keeps entry order and the original separator when editing a Profiles field", () => {
    const fix = profileChange(fieldEdit, ["LS MT Rep", "LS PH Rep"]);
    expect(fix).toMatchObject({ kind: "setConfigField", from: "System Administrator;LS MT Rep", to: "LS MT Rep;LS PH Rep" });
  });

  it("merges edits to the same setting, keeping the original from, and drops edits that undo it", () => {
    let pending = queueChange([], { fix: profileChange(fieldEdit, ["LS MT Rep"])! });
    pending = queueChange(pending, { fix: profileChange(fieldEdit, ["LS MT Rep", "LS PH Rep"])! });
    expect(pending).toHaveLength(1);
    expect(pending[0].fix).toMatchObject({ from: "System Administrator;LS MT Rep", to: "LS MT Rep;LS PH Rep" });
    expect(effectiveProfiles(fieldEdit, pending)).toEqual(["LS MT Rep", "LS PH Rep"]);

    pending = queueChange(pending, { fix: profileChange(fieldEdit, ["System Administrator", "LS MT Rep"])! });
    expect(pending).toEqual([]);
  });

  it("matches a queued toggle only for the same target value", () => {
    const off = activeChange(fieldEdit, false)!;
    const pending = queueChange([], { fix: off });
    expect(isQueued(pending, off)).toBe(true);
    expect(isQueued(pending, activeChange(fieldEdit, true)!)).toBe(false);
  });

  it("preselects affected profiles for publishing unless a change affects everyone", () => {
    const fix = activeChange(fieldEdit, false)!;
    expect(publishProfiles([{ fix, affects: ["A", "a", "B"] }])).toEqual(["a", "B"]);
    expect(publishProfiles([{ fix }])).toBeNull();
  });
});

describe("pending changes for code, validation rules, and layouts", () => {
  const item = { id: "a1B000000000001", label: "Sign Check", properties: {}, findings: [] };
  const rule = { type: "validationRule" as const, id: "03d000000000001", label: "Hours_Cant_be_negative" };

  it("keys script edits by script, keeps the first from, and drops an edit that restores it", () => {
    let pending = queueChange([], { fix: scriptChange(item, "a", "b") });
    pending = queueChange(pending, { fix: scriptChange(item, "b", "c") });
    expect(pending).toHaveLength(1);
    expect(pending[0].fix).toMatchObject({ from: "a", to: "c" });
    expect(queueChange(pending, { fix: scriptChange(item, "c", "a") })).toEqual([]);
  });

  it("toggles validation rules through the active switch without a developer name", () => {
    const edit: ItemEdit = { record: rule, active: true };
    const fix = activeChange(edit, false)!;
    const pending = queueChange([], { fix });
    expect(pending).toHaveLength(1);
    expect(effectiveActive(edit, pending)).toBe(false);
    expect(queueChange(pending, { fix: activeChange(edit, true)! })).toEqual([]);
  });

  it("drops a sidebar add that is taken back out, and counts the layout as an iPad change", () => {
    const cand = { objectName: "Thing__c", relationshipName: "Things__r" };
    const add = layoutChange("Visit-Visit Layout", "Visit Layout", cand, true);
    const pending = queueChange([], { fix: add });
    expect(publishProfiles(pending)).toBeNull();
    expect(queueChange(pending, { fix: layoutChange("Visit-Visit Layout", "Visit Layout", cand, false) })).toEqual([]);
  });
});
