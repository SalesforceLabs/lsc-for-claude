import { describe, it, expect } from "vitest";
import { orgPagePathProblem } from "../../../src/salesforce/cli.js";
import { detailsOpen, inputEntries, INPUT_SHOWN } from "../../../src-renderer/components/chat-cards/approval-logic.js";

describe("open_org page paths", () => {
  it("takes pages in the org", () => {
    for (const p of ["/lightning/setup/SetupOneHome/home", "/lightning/r/Account/001A/view", "/apex/Page?id=a:b", "/one/one.app#/sObject/Account/home"]) {
      expect(orgPagePathProblem(p)).toBeNull();
    }
  });

  it("refuses other sites, schemes and login pages", () => {
    for (const p of ["https://evil.example", "//evil.example/x", "/%2F%2Fevil.example", "/\\\\evil.example", "/javascript:alert(1)", "lightning/x", "/secur/frontdoor.jsp?retURL=x", "/frontdoor.jsp", "/a\nb", "/%E0%A4%A"]) {
      expect(orgPagePathProblem(p)).not.toBeNull();
    }
  });
});

describe("approval card input", () => {
  it("shows strings as they are and other values as JSON", () => {
    expect(inputEntries({ code: "System.debug(1);\nSystem.debug(2);", values: { Name: "x" } })).toEqual([
      { key: "code", text: "System.debug(1);\nSystem.debug(2);", hidden: 0 },
      { key: "values", text: '{\n  "Name": "x"\n}', hidden: 0 },
    ]);
  });

  it("says how much isn't shown past the limit instead of cutting silently", () => {
    const [a, b] = inputEntries({ a: "x".repeat(INPUT_SHOWN - 10), b: "y".repeat(50) });
    expect(a.hidden).toBe(0);
    expect(b.text).toHaveLength(10);
    expect(b.hidden).toBe(40);
  });

  it("opens the details of code and record writes", () => {
    expect(detailsOpen("run_apex")).toBe(true);
    expect(detailsOpen("update_record")).toBe(true);
    expect(detailsOpen("toggle_trigger_handler")).toBe(false);
  });
});
