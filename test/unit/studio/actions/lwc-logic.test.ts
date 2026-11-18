import { describe, it, expect } from "vitest";
import {
  actionContext,
  bundleName,
  isLwcAction,
  notInPreview,
  offlineLines,
  worksOffline,
} from "../../../../src-renderer/components/studio/actions/lwc/logic";
import { presentationFor } from "../../../../src-renderer/components/studio/ipad-fab-actions";

describe("isLwcAction", () => {
  it("needs the LightningWebComponent type and a non-inline bundle", () => {
    expect(isLwcAction("LightningWebComponent", "Account.Foo", "lscMobileQuickAction_Foo")).toBe(
      true
    );
    expect(isLwcAction("lightningwebcomponent", "Account.Foo")).toBe(true);
    expect(isLwcAction("LightningWebComponent", "Account.lscMobileInline_Foo")).toBe(false);
    expect(isLwcAction("LightningWebComponent", "Account.Foo", "c:lscMobileInline_Foo")).toBe(
      false
    );
    expect(isLwcAction("URL", "Account.Foo")).toBe(false);
  });
});

describe("bundleName", () => {
  it("prefers the layout's component and drops a c: prefix", () => {
    expect(bundleName("Account.Foo", "c:bar")).toBe("bar");
    expect(bundleName("Account.Foo")).toBe("Foo");
  });
});

describe("actionContext", () => {
  it("takes the object from the action name, else the record", () => {
    expect(actionContext("Account.Foo", { id: "001", object: "Visit" })).toEqual({
      recordId: "001",
      objectApiName: "Account",
    });
    expect(actionContext("Foo", { id: "001", object: "Visit" })).toEqual({
      recordId: "001",
      objectApiName: "Visit",
    });
    expect(actionContext("Foo", null)).toEqual({ recordId: "", objectApiName: "" });
  });
});

describe("worksOffline", () => {
  it("is true only for the quick action prefix", () => {
    expect(worksOffline("Account.x", "lscMobileQuickAction_X")).toBe(true);
    expect(worksOffline("Account.x", "other")).toBe(false);
  });
});

describe("offlineLines / notInPreview", () => {
  it("words the check and trims the reason", () => {
    expect(offlineLines(undefined)).toEqual([]);
    expect(
      offlineLines({
        bundles: [],
        issues: [{ severity: "online", kind: "apex", detail: "Foo.bar" }],
      })[0]
    ).toContain("Needs a connection");
    expect(notInPreview("  it  broke ")).toBe("Not in the preview: it broke");
    expect(notInPreview("x".repeat(400)).length).toBeLessThan(250);
  });
});

describe("presentationFor", () => {
  it("routes an LWC action to lwcAction, but keeps native names native", () => {
    const lwc = presentationFor(
      {
        name: "Account.Log_Sample",
        label: "Log Sample",
        action: { type: "lightningwebcomponent", target: "lscMobileQuickAction_Log" },
      },
      { onRecord: true }
    );
    expect(lwc).toEqual({
      kind: "lwcAction",
      title: "Log Sample",
      actionName: "Account.Log_Sample",
      bundle: "lscMobileQuickAction_Log",
    });
    expect(
      presentationFor(
        {
          name: "Account.lsc4ce__Survey",
          label: "Survey",
          action: { type: "lightningwebcomponent" },
        },
        { onRecord: true }
      ).kind
    ).toBe("survey");
  });
});

describe("account plan routing", () => {
  const route = (name: string) => presentationFor({ name, label: "X" }, { onRecord: true });
  it("sends plan actions to their sheets", () => {
    expect(route("AccountPlan.createAccountPlan")).toEqual({
      kind: "create",
      object: "AccountPlan",
      label: "New Account Plan",
    });
    expect(route("Account.newAccountPlan").kind).toBe("create");
    expect(route("Account.createPromoPlan")).toEqual({ kind: "promoPlan" });
    expect(route("AccountPlan.generateDocument").kind).toBe("placeholder");
    expect(route("BusinessToDo.clone")).toMatchObject({ kind: "create", object: "BusinessToDo" });
    expect(route("Account.clone").kind).toBe("placeholder");
  });
});
