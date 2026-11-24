import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { folderProblem, packageRoot, writeToFolder } from "../../../src-electron/engine/app-folder.js";
import { cleanInGit, hashText, memoryHashStore } from "../../../src-electron/source-files.js";
import type { AppFile } from "../../../src-electron/engine/app-types.js";
import { conflictText, deployExtras, projectSave } from "../../../src-renderer/components/studio/builder/project-save.js";
import type { AppProject } from "../../../src-renderer/components/studio/builder/types.js";

const git = (cwd: string, ...args: string[]): boolean => {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const commitAll = (cwd: string) => {
  git(cwd, "add", ".");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
};

const files = (js: string, extra: AppFile[] = []): AppFile[] => [
  { bundle: "lscMobileInline_visits", path: "lwc/lscMobileInline_visits/lscMobileInline_visits.js", source: js },
  { bundle: "lscMobileInline_visits", path: "lwc/lscMobileInline_visits/lscMobileInline_visits.html", source: "<template></template>" },
  ...extra,
];
const JS = "force-app/main/default/lwc/lscMobileInline_visits/lscMobileInline_visits.js";

describe("writeToFolder", () => {
  let folder: string;
  const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf-8");
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), text);
  };

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "app-folder-"));
    fs.writeFileSync(path.join(folder, "sfdx-project.json"), JSON.stringify({ packageDirectories: [{ path: "force-app", default: true }] }));
  });
  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

  it("needs an sfdx project and uses its default package", () => {
    expect(folderProblem("rel/path")).toMatch(/folder on this computer/);
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "app-folder-bare-"));
    expect(folderProblem(bare)).toMatch(/isn't an sfdx project/);
    fs.rmSync(bare, { recursive: true });
    fs.writeFileSync(path.join(folder, "sfdx-project.json"), JSON.stringify({ packageDirectories: [{ path: "other" }, { path: "pkg", default: true }] }));
    expect(packageRoot(folder)).toBe(path.join(folder, "pkg", "main", "default"));
    fs.writeFileSync(path.join(folder, "sfdx-project.json"), JSON.stringify({ packageDirectories: [{ path: "../outside", default: true }] }));
    expect(folderProblem(folder)).toMatch(/outside the project/);
  });

  it("writes a version, then replaces files it wrote and deletes ones a later version drops", async () => {
    const hashes = memoryHashStore();
    const helper: AppFile = { bundle: "lscMobileInline_visits", path: "lwc/lscMobileInline_visits/util.js", source: "export const a = 1;" };
    const first = await writeToFolder(folder, files("// v1", [helper]), "v1", { hashes, now: "t1" });
    expect(first.link).toEqual({ path: folder, savedVersionId: "v1", savedAt: "t1" });
    expect(first.written).toBe(3);
    expect(read(JS)).toBe("// v1");

    // The team adds a test of their own beside it; Studio never wrote it, so it stays.
    put("force-app/main/default/lwc/lscMobileInline_visits/__tests__/visits.test.js", "test");
    const second = await writeToFolder(folder, files("// v2"), "v2", { hashes, previous: first.link, now: "t2" });
    expect(second.link.savedVersionId).toBe("v2");
    expect(second.deleted).toBe(1);
    expect(read(JS)).toBe("// v2");
    expect(fs.existsSync(path.join(folder, "force-app/main/default/lwc/lscMobileInline_visits/util.js"))).toBe(false);
    expect(fs.existsSync(path.join(folder, "force-app/main/default/lwc/lscMobileInline_visits/__tests__/visits.test.js"))).toBe(true);
    expect(hashes.get(folder)[JS]).toBe(hashText("// v2"));
  });

  it("holds back a version when the project has edits, until told to replace", async () => {
    const hashes = memoryHashStore();
    const first = await writeToFolder(folder, files("// v1"), "v1", { hashes });
    put(JS, "// mine");
    const held = await writeToFolder(folder, files("// v2"), "v2", { hashes, previous: first.link });
    expect(held.link).toEqual({ path: folder, savedVersionId: "v1", savedAt: first.link.savedAt, conflict: { versionId: "v2", files: [JS] } });
    expect(read(JS)).toBe("// mine");

    const forced = await writeToFolder(folder, files("// v2"), "v2", { hashes, previous: held.link, force: true });
    expect(forced.link.conflict).toBeUndefined();
    expect(read(JS)).toBe("// v2");
  });

  it("treats a file it never wrote as the team's, unless Git has it committed and unedited", async () => {
    put(JS, "// from the repo");
    const hashes = memoryHashStore();
    expect((await writeToFolder(folder, files("// v1"), "v1", { hashes })).link.conflict?.files).toEqual([JS]);

    if (!git(folder, "init", "-q")) return; // no git on this machine
    commitAll(folder);
    expect(await cleanInGit(folder, [JS])).toEqual(new Set([JS]));
    expect((await writeToFolder(folder, files("// v1"), "v1", { hashes })).link.savedVersionId).toBe("v1");
    expect(read(JS)).toBe("// v1");
    // Now edited and uncommitted (Studio's write counts as known, so edit it again).
    put(JS, "// edited");
    expect(await cleanInGit(folder, [JS])).toEqual(new Set());
    expect((await writeToFolder(folder, files("// v2"), "v2", { hashes })).link.conflict?.files).toEqual([JS]);
  });

  it("reads Git paths from a project that is a subfolder of the repository", async () => {
    if (!git(folder, "init", "-q")) return;
    const sub = path.join(folder, "packages", "crm");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "sfdx-project.json"), "{}");
    fs.mkdirSync(path.join(sub, "force-app/main/default/lwc/lscMobileInline_visits"), { recursive: true });
    fs.writeFileSync(path.join(sub, JS), "// committed");
    commitAll(folder);
    expect(await cleanInGit(sub, [JS])).toEqual(new Set([JS]));
  });

  it("refuses a file outside its bundle folder", async () => {
    const bad: AppFile = { bundle: "lscMobileInline_visits", path: "lwc/lscMobileInline_visits/../../x.js", source: "" };
    const r = await writeToFolder(folder, [bad], "v1", { hashes: memoryHashStore() });
    expect(r.link.error).toMatch(/isn't inside its bundle folder/);
    expect(fs.existsSync(path.join(folder, "force-app/main/default/x.js"))).toBe(false);
  });
});

describe("server copy of the Git check", () => {
  it("matches src-electron/source-files.ts", () => {
    const body = (file: string) => {
      const text = fs.readFileSync(path.join(__dirname, "../../..", file), "utf-8");
      const pick = (start: string, end: string) => {
        const i = text.indexOf(start);
        expect(i, `${start} in ${file}`).toBeGreaterThanOrEqual(0);
        return text.slice(i, text.indexOf(end, i) + end.length);
      };
      return [
        text.match(/export const hashText = .*\n/)?.[0],
        pick("const git = ", "\n  });\n"),
        pick("export async function cleanInGit", "\n}\n"),
      ].join("\n");
    };
    expect(body("src/studio/git-clean.ts")).toBe(body("src-electron/source-files.ts"));
  });
});

describe("builder header's project state", () => {
  const project = (folder?: AppProject["folder"]): AppProject =>
    ({ id: "p", org: "o", versions: [{ id: "v1" }, { id: "v2" }], currentVersionId: "v2", folder }) as unknown as AppProject;
  const on = { deployed: true, folder: "/Users/sam/proj" };

  it("follows the link for the org's folder only", () => {
    expect(projectSave(project(), { deployed: false })).toEqual({ kind: "off" });
    expect(projectSave(project(), { deployed: true })).toEqual({ kind: "no-folder" });
    expect(projectSave(project(), on)).toEqual({ kind: "unsaved", version: 2 });
    expect(projectSave(project({ path: on.folder, savedVersionId: "v2" }), on)).toMatchObject({ kind: "saved", version: 2, title: "v2 is in ~/proj" });
    expect(projectSave(project({ path: on.folder, savedVersionId: "v1" }), on)).toEqual({ kind: "unsaved", version: 2 });
    expect(projectSave(project({ path: "/elsewhere", savedVersionId: "v2" }), on)).toEqual({ kind: "unsaved", version: 2 });
    expect(projectSave(project({ path: on.folder, conflict: { versionId: "v2", files: ["a/b/c.js"] } }), on)).toEqual({ kind: "conflict", version: 2, files: ["a/b/c.js"] });
    expect(projectSave(project({ path: on.folder, error: "nope" }), on)).toEqual({ kind: "error", message: "nope" });
  });

  it("names conflicted files by bundle and file", () => {
    expect(conflictText([JS])).toContain("lscMobileInline_visits/lscMobileInline_visits.js. Replace it with");
    expect(conflictText([JS, JS])).toContain("These files were edited");
    expect(conflictText([JS, JS])).toContain("Replace them with");
  });

  it("saves a deploy's page, tab, action and app, and names profiles instead", () => {
    expect(
      deployExtras(["LightningComponentBundle:x", "QuickAction:Account.x", "FlexiPage:x", "CustomTab:x", "Profile:Rep", "CustomApplication:LSC"])
    ).toEqual({
      items: [
        { type: "QuickAction", fullName: "Account.x" },
        { type: "FlexiPage", fullName: "x" },
        { type: "CustomTab", fullName: "x" },
        { type: "CustomApplication", fullName: "LSC" },
      ],
      profiles: ["Rep"],
    });
  });
});
