import { describe, expect, it } from "vitest";
import {
  clickStreamRows,
  slidePrefix,
} from "../../../../src-renderer/components/studio/visit/sections/logic";

const e = (id: string, pageId: string, slideId?: string, start?: string) => ({
  id,
  pageId,
  slideId,
  start,
});

describe("slidePrefix", () => {
  it("is the name before the first underscore (ClickStreamsPlugin.swift slidePrefix)", () => {
    expect(slidePrefix("01_intro")).toBe("01");
    expect(slidePrefix("cover")).toBe("cover");
  });
});

describe("clickStreamRows", () => {
  it("keeps one entry per page and slide prefix, the first seen", () => {
    const rows = clickStreamRows([
      e("a", "p1", "01_v1", "2026-01-01T10:00:00Z"),
      e("b", "p1", "01_v2", "2026-01-01T10:05:00Z"),
      e("c", "p1", "02_x", "2026-01-01T10:06:00Z"),
      e("d", "p2", "01_v1", "2026-01-01T10:07:00Z"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  it("counts an entry with no slide id by its page", () => {
    expect(clickStreamRows([e("a", "p1"), e("b", "p1"), e("c", "p2")]).map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("sorts by start time, entries without one first", () => {
    const rows = clickStreamRows([
      e("late", "p1", "01", "2026-01-01T12:00:00Z"),
      e("none", "p2", "01"),
      e("early", "p3", "01", "2026-01-01T09:00:00Z"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["none", "early", "late"]);
  });

  it("drops entries with no page", () => {
    expect(clickStreamRows([e("a", "")])).toEqual([]);
  });

  it("hides slides no longer in the presentation, matching in-place updates by prefix", () => {
    const current = ["p1|01_renamed", "p2|03_z"];
    const rows = clickStreamRows(
      [e("a", "p1", "01_old"), e("b", "p1", "02_gone"), e("c", "p2"), e("d", "p9")],
      current
    );
    // a: prefix 01 still current; b: removed; c: no slide id, page p2 is live; d: page gone.
    expect(rows.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("checks a PDF at page level", () => {
    const rows = clickStreamRows(
      [e("a", "p1", "pdf page 3"), e("b", "p2", "pdf page 1")],
      ["p1|x"],
      true
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
});
