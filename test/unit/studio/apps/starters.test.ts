import { describe, expect, it } from "vitest";
import { checkApp } from "../../../../src/studio/apps/check.js";
import { listStarters, starterSource } from "../../../../src/studio/apps/starters.js";
import { helperName, renameBundle } from "../../../../src-electron/engine/app-builder.js";

// The pinned copies in knowledge/app-starters (scripts/sync-app-starters.mjs). A refresh that
// breaks one of them fails here, before the builder offers it.
describe("app starters", () => {
  const starters = listStarters();

  it("lists the manifest's starters with where they came from", () => {
    expect(starters.length).toBeGreaterThan(0);
    for (const s of starters) {
      expect(s.repo).toMatch(/^afls-ideas\//);
      expect(s.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(s.url).toBe(`https://github.com/${s.repo}/tree/${s.sha}`);
      expect(s.description.length).toBeGreaterThan(20);
      expect(s.tryNext.length).toBeGreaterThan(0);
      if (s.target === "record" || s.target === "action") expect(s.objectApiName).toBeTruthy();
    }
    expect(new Set(starters.map((s) => s.id)).size).toBe(starters.length);
  });

  it.each(listStarters().map((s) => [s.id]))("%s passes Studio's checks", async (id) => {
    const source = starterSource(id);
    expect(source.files.some((f) => f.path === `lwc/${source.name}/${source.name}.js-meta.xml`)).toBe(true);
    const check = await checkApp(source);
    expect(check.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.script).toBeTruthy();
    // Every bundle copied is one the app uses.
    expect([...new Set(source.files.map((f) => f.bundle))].sort()).toEqual([...check.offline.bundles].sort());
  }, 60_000);

  it.each(listStarters().map((s) => [s.id]))("%s still passes with its bundles renamed for a project", async (id) => {
    const source = starterSource(id);
    const parent = `${source.name}2`;
    let files = renameBundle(source.files, source.name, parent);
    for (const helper of [...new Set(source.files.map((f) => f.bundle))].filter((b) => b !== source.name)) files = renameBundle(files, helper, helperName(parent, helper));
    expect(files.some((f) => f.source.includes(source.name + "."))).toBe(false);
    const check = await checkApp({ ...source, name: parent, files });
    expect(check.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(check.issues.map((i) => i.rule)).not.toContain("child.prefixed");
    expect(check.script).toBeTruthy();
    expect([...check.offline.bundles].sort()).toEqual([...new Set(files.map((f) => f.bundle))].sort());
  }, 60_000);

  it("refuses ids that aren't starters", () => {
    expect(() => starterSource("../manifest")).toThrow(/Not a starter id/);
    expect(() => starterSource("no-such-starter")).toThrow(/no starter app/);
  });
});
