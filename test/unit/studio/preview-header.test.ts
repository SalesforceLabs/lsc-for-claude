import { describe, it, expect } from "vitest";
import { headerLead, nextPublishBasis } from "../../../src-renderer/components/studio/PublishedIpadPreview";
import { pendingForProfile, type PendingChange } from "../../../src-renderer/components/studio/changes";

const change = (affects?: string[]): PendingChange => ({ fix: { kind: "assignPsl", label: "x" } as never, ...(affects ? { affects } : {}) });

describe("iPad preview header", () => {
  it("names the mode it draws", () => {
    expect(headerLead("published")).toBe("Published for");
    expect(headerLead("draft")).toBe("Next publish for");
    expect(headerLead("split")).toBe("On iPads now and next publish for");
  });

  it("says what Next publish is made of", () => {
    expect(nextPublishBasis(0)).toBe("the org as it is now");
    expect(nextPublishBasis(1)).toBe("the org now plus 1 change");
    expect(nextPublishBasis(3)).toBe("the org now plus 3 changes");
  });

  it("counts the changes that reach the profile", () => {
    expect(pendingForProfile([change(), change(["rep"]), change(["Manager"])], "Rep")).toHaveLength(2);
  });
});
