import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recallPreview, rememberPreview } from "../../../src-renderer/components/studio/preview-memory";

describe("preview memory", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the profile and rep per org, whatever the username's case", () => {
    rememberPreview("Admin@Demo.org", { profile: "Field Sales", userId: "005000000000001AAA" });
    expect(recallPreview("admin@demo.org")).toEqual({ profile: "Field Sales", userId: "005000000000001AAA" });
    expect(recallPreview("other@demo.org")).toBeNull();
  });

  it("keeps the profile when no rep was picked", () => {
    rememberPreview("a@b.c", { profile: "KAM" });
    expect(recallPreview("a@b.c")).toEqual({ profile: "KAM", userId: undefined });
  });

  it("ignores what it can't read", () => {
    localStorage.setItem("roz.ipadPreview.a@b.c", "{not json");
    expect(recallPreview("a@b.c")).toBeNull();
    localStorage.setItem("roz.ipadPreview.a@b.c", JSON.stringify({ profile: "" }));
    expect(recallPreview("a@b.c")).toBeNull();
  });
});
