import { describe, it, expect } from "vitest";
import { headerLead, nextPublishBasis } from "../../../src-renderer/components/studio/PublishedIpadPreview";
import { reviewTitle } from "../../../src-renderer/components/studio/ReviewDialog";
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

describe("review dialog title", () => {
  it("names an undo as one", () => {
    expect(reviewTitle(false, 1, 0, false)).toBe("1 pending change");
    expect(reviewTitle(false, 1, 0, true)).toBe("Undo last apply");
    expect(reviewTitle(false, 3, 0, true)).toBe("Undo 3 changes");
    expect(reviewTitle(true, 3, 2, true)).toBe("2 of 3 undone");
    expect(reviewTitle(true, 3, 3, false)).toBe("3 of 3 applied");
  });
});
