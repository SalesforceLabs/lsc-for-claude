import { describe, it, expect } from "vitest";
import { componentNameProblem, deriveComponentName } from "../../../src-renderer/components/studio/scripts/script-names";
import { countLabel, groupRows, rowMatches, type LibraryRow } from "../../../src-renderer/components/studio/scripts/script-library-logic";
import { scriptShortcut, shortcutLabel } from "../../../src-renderer/components/studio/scripts/script-keys";
import { countProblems, fixProblemText, lineColumn, nextOfSeverity, problemLabel, sortProblems } from "../../../src-renderer/components/studio/scripts/script-problems";
import { SCRIPT_TEMPLATES, blankCodeFor, templatesFor } from "../../../src-renderer/components/studio/scripts/script-templates";
import { SCRIPT_API } from "../../../src-renderer/components/studio/scripts/script-api";
import { draftIsDirty, draftProblems, newDraft, vavSettingsProblem, withType, VAV_EVENT, VAV_OBJECT } from "../../../src-renderer/components/studio/scripts/script-drafts";

const key = (k: string, extra: Partial<Parameters<typeof scriptShortcut>[0]> = {}) => ({ key: k, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

describe("script names", () => {
  it("derives a camelCase component name", () => {
    expect(deriveComponentName("Visit checks (v2)")).toBe("visitChecksV2");
    expect(deriveComponentName("3 day rule")).toBe("script3DayRule");
    expect(deriveComponentName("")).toBe("");
  });

  it("explains why a component name can't be used", () => {
    expect(componentNameProblem("visitChecks")).toBeNull();
    expect(componentNameProblem("")).toMatch(/name/);
    expect(componentNameProblem("Visit")).toMatch(/lowercase/);
    expect(componentNameProblem("a__b")).toMatch(/underscores/);
    expect(componentNameProblem("visitChecks", ["VISITCHECKS"])).toMatch(/already/);
  });
});

describe("library logic", () => {
  const row = (name: string, type: LibraryRow["type"]): LibraryRow => ({
    key: name,
    name,
    componentName: name,
    type,
    isNew: false,
    dirty: false,
    queued: false,
    status: { tone: "pass", label: "Runs at Submit", detail: "" },
  });

  it("groups by type in the library order and sorts by name", () => {
    const groups = groupRows([row("b", "Checklist"), row("a", "Checklist"), row("v", "VisitActionValidation")]);
    expect(groups.map((g) => g.type)).toEqual(["VisitActionValidation", "Checklist"]);
    expect(groups[1].rows.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("searches every word in any field", () => {
    expect(rowMatches(row("Visit checks", "Validation"), "visit submit")).toBe(true);
    expect(rowMatches(row("Visit checks", "Validation"), "samples")).toBe(false);
  });

  it("counts", () => {
    expect(countLabel(1)).toBe("1 script");
    expect(countLabel(3)).toBe("3 scripts");
  });
});

describe("keyboard", () => {
  const idle = { proposal: false, blocked: false };
  it("maps the page shortcuts", () => {
    expect(scriptShortcut(key("s"), idle, true)).toBe("save");
    expect(scriptShortcut(key("k"), idle, true)).toBe("ask");
    expect(scriptShortcut(key("Enter", { shiftKey: true }), idle, true)).toBe("test");
    expect(scriptShortcut(key("s", { metaKey: false, ctrlKey: true }), idle, false)).toBe("save");
    expect(scriptShortcut(key("s", { metaKey: false, ctrlKey: true }), idle, true)).toBeNull();
  });

  it("only accepts and rejects a suggestion while one is on screen", () => {
    expect(scriptShortcut(key("Enter"), idle, true)).toBeNull();
    expect(scriptShortcut(key("Enter"), { proposal: true, blocked: false }, true)).toBe("accept");
    expect(scriptShortcut(key("Escape", { metaKey: false }), { proposal: true, blocked: false }, true)).toBe("reject");
  });

  it("does nothing behind a dialog", () => {
    expect(scriptShortcut(key("s"), { proposal: false, blocked: true }, true)).toBeNull();
  });

  it("labels for each platform", () => {
    expect(shortcutLabel("S", true)).toBe("⌘S");
    expect(shortcutLabel("S", false)).toBe("Ctrl+S");
  });
});

describe("problems strip", () => {
  const diags = [
    { id: "a", severity: "warning" as const, message: "", from: 20, to: 21 },
    { id: "b", severity: "error" as const, message: "", from: 40, to: 41 },
    { id: "c", severity: "error" as const, message: "", from: 5, to: 6 },
  ];

  it("counts and labels", () => {
    expect(countProblems(diags)).toEqual({ error: 2, warning: 1, info: 0 });
    expect(problemLabel("error", 1)).toBe("1 error");
    expect(problemLabel("info", 2)).toBe("2 notes");
  });

  it("lists worst first, then in code order", () => {
    expect(sortProblems(diags).map((d) => d.id)).toEqual(["c", "b", "a"]);
  });

  it("steps through one severity and wraps", () => {
    expect(nextOfSeverity(diags, "error", null)?.id).toBe("c");
    expect(nextOfSeverity(diags, "error", 5)?.id).toBe("b");
    expect(nextOfSeverity(diags, "error", 40)?.id).toBe("c");
    expect(nextOfSeverity(diags, "info", null)).toBeNull();
  });

  it("words the request for Ask Roz, with the line unless the finding is about the whole script", () => {
    expect(fixProblemText({ message: "Missing await.", from: 10, to: 14 }, 3)).toBe("Fix this: Missing await. (line 3)");
    expect(fixProblemText({ message: "Script is too large.", from: 0, to: 0 }, 1)).toBe("Fix this: Script is too large.");
  });

  it("finds line and column", () => {
    expect(lineColumn("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
    expect(lineColumn("ab", 99)).toEqual({ line: 1, column: 3 });
  });
});

describe("templates", () => {
  it("has a blank and at least one template for every type", () => {
    for (const type of ["Validation", "Checklist", "VisitActionValidation"] as const) {
      expect(templatesFor(type).length).toBeGreaterThan(0);
      expect(blankCodeFor(type).trim().length).toBeGreaterThan(0);
    }
  });

  it("has unique ids and parseable code", () => {
    expect(new Set(SCRIPT_TEMPLATES.map((t) => t.id)).size).toBe(SCRIPT_TEMPLATES.length);
    for (const t of SCRIPT_TEMPLATES) expect(() => new Function(t.code), t.id).not.toThrow();
  });

  it("documents the script API for completions", () => {
    expect(SCRIPT_API.length).toBeGreaterThan(20);
    expect(SCRIPT_API.every((c) => c.label && c.doc)).toBe(true);
  });
});

describe("drafts", () => {
  const draft = () => newDraft({ name: "Visit checks", componentName: "visitChecks", type: "Validation", code: "(function () {})();" });

  it("a new draft is always unsaved and a visit script gets its settings", () => {
    expect(draftIsDirty(draft())).toBe(true);
    const vav = withType(draft(), "VisitActionValidation");
    expect(vav.fields.objectName).toBe(VAV_OBJECT);
    expect(vav.fields.operationEventType).toBe(VAV_EVENT);
    expect(vavSettingsProblem(vav.fields)).toBeNull();
    expect(vavSettingsProblem({ ...vav.fields, objectName: "Account" })).toMatch(/ProviderVisit/);
  });

  it("says what blocks saving", () => {
    expect(draftProblems(draft(), [])).toEqual([]);
    expect(draftProblems({ ...draft(), code: " " }, [])).toContain("The script has no code yet.");
    expect(draftProblems(draft(), ["visitchecks"])[0]).toMatch(/already/);
  });
});
