import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkDraft,
  deleteDraft,
  draftDir,
  draftExists,
  draftFiles,
  draftPlayer,
  fileProblems,
  references,
  writeDraft,
  zipDraft,
} from "../../../../src/studio/content/drafts.js";

const ID = `test-${process.pid}`;
const SLIDE =
  '<html><head><meta name="viewport" content="width=1024, height=768"><link rel="stylesheet" href="css/style.css"></head><body><img src="img/logo.svg">{{user.name}}</body></html>';

afterAll(() => deleteDraft(ID));

describe("draft file rules", () => {
  it("accepts slides at the top and assets one folder down", () => {
    expect(
      fileProblems([
        { path: "01_intro.html", content: SLIDE },
        { path: "css/style.css", content: "body{}" },
      ])
    ).toEqual([]);
  });

  it("refuses deep paths, odd types, player names, thumbnails and slides in folders", () => {
    const problems = fileProblems([
      { path: "a/b/c.css", content: "" },
      { path: "run.exe", content: "" },
      { path: "../up.html", content: "" },
      { path: "thumbnail.jpg", content: "" },
      { path: "slides/01.html", content: "" },
      { path: "01.html", content: "" },
      { path: "01.HTML", content: "" },
    ]);
    expect(problems.join("\n")).toMatch(/one folder deep/);
    expect(problems.join("\n")).toMatch(/\.exe files aren't kept/);
    expect(problems.join("\n")).toMatch(/thumbnails are drawn by the app/);
    expect(problems.join("\n")).toMatch(/slides go at the top/);
    expect(problems.join("\n")).toMatch(/in the list twice/);
  });

  it("finds local and outside references", () => {
    const r = references(
      `<img src="img/a.png"><a href="#top"></a><script src="https://cdn.x/y.js"></script><div style="background:url('./img/b.jpg?v=1')"></div><a href="mailto:x@y"></a><img src="{{thumb}}">`
    );
    expect(r.local.sort()).toEqual(["img/a.png", "img/b.jpg"]);
    expect(r.external).toEqual(["https://cdn.x/y.js"]);
  });
});

describe("a draft on disk", () => {
  it("is written, checked, played and zipped", async () => {
    expect(() => draftDir("../nope")).toThrow();
    expect(draftExists(ID)).toBe(false);
    writeDraft(
      ID,
      [
        { path: "01_intro.html", content: SLIDE },
        { path: "intro.html", content: '<html><script src="https://cdn.x/y.js"></script></html>' },
        { path: "css/style.css", content: "body{background:url(img/missing.png)}" },
      ],
      true
    );
    expect(draftExists(ID)).toBe(true);
    const checks = checkDraft(ID);
    const text = checks.map((c) => `${c.level} ${c.file ?? ""} ${c.message}`).join("\n");
    expect(text).toMatch(/error 01_intro.html img\/logo.svg isn't in the draft/);
    expect(text).toMatch(/error intro.html https:\/\/cdn.x\/y.js is on the internet/);
    expect(text).toMatch(/warning intro.html The iPad orders slides/);
    expect(text).toMatch(/warning intro.html No viewport tag/);
    expect(text).toMatch(/error css\/style.css img\/missing.png isn't in the draft/);

    writeDraft(
      ID,
      [
        { path: "01_intro.html", content: SLIDE },
        { path: "css/style.css", content: "body{}" },
        { path: "img/logo.svg", content: "<svg/>" },
      ],
      true
    );
    expect(checkDraft(ID)).toEqual([]);
    expect(draftFiles(ID)).toEqual(["01_intro.html", "css/style.css", "img/logo.svg"]);

    const player = draftPlayer(ID, "Intro");
    expect(player.slides.map((s) => s.name)).toEqual(["01_intro.html"]);
    expect(player.slides[0].pageId).toBe(`new:${ID}`);
    const rendered = readFileSync(join(player.root, player.slides[0].file), "utf8");
    expect(rendered).not.toContain("{{user.name}}");
    // the rendered copy and bridge are the player's, not the draft's
    expect(draftFiles(ID)).toEqual(["01_intro.html", "css/style.css", "img/logo.svg"]);

    const zip = await zipDraft(ID);
    expect(existsSync(zip)).toBe(true);
    const listing = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    expect(listing).toEqual(["01_intro.html", "css/style.css", "img/logo.svg"]);

    deleteDraft(ID);
    expect(draftExists(ID)).toBe(false);
  });
});
