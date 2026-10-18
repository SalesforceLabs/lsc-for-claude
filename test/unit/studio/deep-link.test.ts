import { describe, it, expect } from "vitest";
import { findDeepLinkTab, findRecordId, isDeepLink, parseDeepLink } from "../../../src-renderer/components/studio/deep-link";
import type { PublishedTab } from "../../../src-renderer/components/studio/published-types";

const tabs: PublishedTab[] = [
  { fullName: "standard-home", label: "Home", kind: "home" },
  { fullName: "lsc4ce__AccountFilter", label: "Accounts", kind: "accounts" },
  { fullName: "standard-Visit", label: "Visits", kind: "object", sobject: "Visit" },
];

describe("parseDeepLink", () => {
  it("parses a tab with an existing record, the form alerts use", () => {
    const nav = parseDeepLink("lsc4ce://deeplink/tab/lsc4ce__AccountFilter/sobject-name/Account/record-id/001KX000007x2tWYAQ");
    expect(nav).toEqual({
      kind: "tabWithObject",
      tab: { name: "lsc4ce__AccountFilter", bySobject: false },
      object: { kind: "existing", sobject: "Account", recordId: "001KX000007x2tWYAQ" },
    });
  });

  it("parses tabs, actions, quick actions, modals and upserts", () => {
    expect(parseDeepLink("lsc4cedev://deeplink/tab/standard-Account")).toEqual({ kind: "tab", tab: { name: "standard-Account", bySobject: false } });
    expect(parseDeepLink("lsc4ce://deeplink/tab/t/sobject-name/Visit/action/new")).toMatchObject({ object: { kind: "new", sobject: "Visit" } });
    expect(parseDeepLink("lsc4ce://deeplink/tab/t/sobject-name/Visit/record-id/0Z5/action/edit")).toMatchObject({ object: { kind: "edit", recordId: "0Z5" } });
    expect(parseDeepLink("lsc4ce://deeplink/tab/t/sobject-name/Account/record-id/001/quick-action/LogCall")).toMatchObject({ object: { kind: "quickAction", action: "LogCall" } });
    expect(parseDeepLink("lsc4ce://deeplink/modal/sobject-name/Account/record-id/001?x=1")).toEqual({ kind: "modal", object: { kind: "existing", sobject: "Account", recordId: "001" } });
    expect(parseDeepLink("lsc4ce://deeplink/tab/t/action/upsert?Name=x")).toEqual({ kind: "upsert", tab: { name: "t", bySobject: false } });
  });

  it("parses Lightning-style paths", () => {
    expect(parseDeepLink("lsc4ce://deeplink/lightning/r/Account/001/view")).toMatchObject({ kind: "tabWithObject", tab: { name: "Account", bySobject: true } });
    expect(parseDeepLink("lsc4ce://deeplink/lightning/r/Account/001/view?modal=1")).toMatchObject({ kind: "modal" });
    expect(parseDeepLink("lsc4ce://deeplink/lightning/o/Visit/list")).toEqual({ kind: "tab", tab: { name: "Visit", bySobject: true } });
    expect(parseDeepLink("lsc4ce://deeplink/lightning/page/home")).toEqual({ kind: "tab", tab: { name: "standard-home", bySobject: false } });
  });

  it("rejects what the app can't parse", () => {
    expect(parseDeepLink("lsc4ce://deeplink/tab")).toBeNull();
    expect(parseDeepLink("lsc4ce://deeplink/tab/t/sobject-name/Account/action/delete")).toBeNull();
    expect(parseDeepLink("lsc4ce://deeplink/nowhere")).toBeNull();
  });
});

describe("matching", () => {
  it("finds tabs by name (case-insensitively) or by object", () => {
    expect(findDeepLinkTab({ name: "LSC4CE__accountfilter", bySobject: false }, tabs)?.label).toBe("Accounts");
    expect(findDeepLinkTab({ name: "Account", bySobject: true }, tabs)?.label).toBe("Accounts");
    expect(findDeepLinkTab({ name: "visit", bySobject: true }, tabs)?.label).toBe("Visits");
    expect(findDeepLinkTab({ name: "standard-Account", bySobject: false }, tabs)).toBeUndefined();
  });

  it("finds records by 15- or 18-character id", () => {
    const byId = { "001KX000007x2tWYAQ": {} };
    expect(findRecordId("001KX000007x2tWYAQ", byId)).toBe("001KX000007x2tWYAQ");
    expect(findRecordId("001KX000007x2tW", byId)).toBe("001KX000007x2tWYAQ");
    expect(findRecordId("001KX000007x2tWAAA", byId)).toBeUndefined();
  });

  it("recognizes the deep link schemes", () => {
    expect(isDeepLink("LSC4CE://deeplink/tab/x")).toBe(true);
    expect(isDeepLink("lsc4cedev://deeplink/tab/x")).toBe(true);
    expect(isDeepLink("https://example.com")).toBe(false);
  });
});
