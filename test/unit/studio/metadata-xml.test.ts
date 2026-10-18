import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  childText,
  childrenNamed,
  escapeXml,
  insertInOrder,
  leaf,
  parseXml,
  serializeXml,
  unescapeXml,
} from "../../../src/studio/metadata/xml.js";

const FIXTURES = join(__dirname, "../../fixtures/metadata");

describe("metadata XML", () => {
  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".xml"))) {
    it(`writes ${file} back byte for byte`, () => {
      const xml = readFileSync(join(FIXTURES, file), "utf8");
      expect(serializeXml(parseXml(xml))).toBe(xml);
    });
  }

  it("reads text unescaped and writes new text escaped", () => {
    const root = parseXml(`<?xml version="1.0" encoding="UTF-8"?>\n<a><label>Rep&apos;s &amp; notes</label><empty/></a>\n`);
    expect(childText(root, "label")).toBe("Rep's & notes");
    expect(childText(root, "empty")).toBe("");
    expect(childText(root, "missing")).toBeUndefined();
    expect(escapeXml(`<"a" & 'b'>`)).toBe("&lt;&quot;a&quot; &amp; &apos;b&apos;&gt;");
    expect(unescapeXml("&#39;&#x41;")).toBe("'A");
  });

  it("inserts a child in schema order", () => {
    const root = parseXml(`<Layout><layoutSections/><showEmailCheckbox>false</showEmailCheckbox></Layout>`);
    const order = ["layoutSections", "relatedLists", "showEmailCheckbox"];
    insertInOrder(root, leaf("relatedLists", "A"), order);
    insertInOrder(root, leaf("relatedLists", "B"), order);
    expect(root.children.map((c) => c.tag)).toEqual(["layoutSections", "relatedLists", "relatedLists", "showEmailCheckbox"]);
    expect(childrenNamed(root, "relatedLists").map((c) => c.text)).toEqual(["A", "B"]);
  });
});
