import { describe, it, expect } from "vitest";
import { agentName, presentationFor, AGENT_BUTTON } from "../../../../src-renderer/components/studio/ipad-fab-actions";
import { homeMenu } from "../../../../src/studio/screens/fabs.js";
import type { PublishedFabItem } from "../../../../src-renderer/components/studio/screens/fabs-types";

const item = (name: string, label = name, action?: PublishedFabItem["action"]): PublishedFabItem => ({ name, label, ...(action ? { action } : {}) });
const home = { onRecord: false };
const rec = { onRecord: true };

describe("presentationFor: quick actions", () => {
  it("opens the Visit editor for New Visit, with or without namespace and object prefix", () => {
    expect(presentationFor(item("NewVisit"), home)).toEqual({ kind: "visit" });
    expect(presentationFor(item("Account.lsc4ce__NewVisit"), rec)).toEqual({ kind: "visit" });
  });

  it("opens the record type picker for Inquiry", () => {
    expect(presentationFor(item("Inquiry"), home)).toEqual({ kind: "inquiry" });
    expect(presentationFor(item("Account.lsc4ce__Inquiry"), rec)).toEqual({ kind: "inquiry" });
  });

  it("asks for a provider first for Email on Home, not on a record", () => {
    expect(presentationFor(item("Email"), home)).toEqual({ kind: "email", pickProvider: true });
    expect(presentationFor(item("Account.lsc4ce__Email", "Send Email"), rec)).toEqual({ kind: "email", pickProvider: false });
  });

  it("opens the survey picker for Survey", () => {
    expect(presentationFor(item("Account.lsc4ce__Survey"), rec)).toEqual({ kind: "survey" });
  });

  it("opens the Why sheet for Next Best Customer on a record only", () => {
    expect(presentationFor(item("Account.lsc4ce__NextBestCustomer"), rec)).toEqual({ kind: "nbc" });
    expect(presentationFor(item("NextBestCustomer", "Next Best Customer"), home).kind).toBe("placeholder");
  });

  it("labels what it can't draw, with the action's name", () => {
    expect(presentationFor(item("ShareContent", "Share Content"), home)).toMatchObject({ kind: "placeholder", title: "Share Content", target: "ShareContent" });
  });
});

describe("presentationFor: custom actions", () => {
  it("shows an Internal URL in the in-app browser, honoring HideViewInBrowserAction", () => {
    expect(presentationFor(item("Patient Journey", "Patient Journey", { type: "url", target: "https://x.example/pj", targetType: "Internal" }), home)).toEqual({ kind: "browser", url: "https://x.example/pj", hideSafari: false });
    expect(presentationFor(item("A", "A", { type: "url", target: "https://x.example", targetType: "Internal", hideBrowser: true }), home)).toMatchObject({ kind: "browser", hideSafari: true });
  });

  it("treats a URL with no target type as in-app, and External as Safari", () => {
    expect(presentationFor(item("A", "A", { type: "url", target: "https://x.example" }), home).kind).toBe("browser");
    expect(presentationFor(item("A", "A", { type: "url", target: "https://x.example", targetType: "External" }), home)).toEqual({ kind: "safari", url: "https://x.example" });
  });

  it("launches Agentforce with the utterance", () => {
    expect(presentationFor(item("Log an Expense", "Log an Expense", { type: "utterance", target: "Help me log an expense" }), home)).toEqual({ kind: "agent", utterance: "Help me log an expense" });
    expect(AGENT_BUTTON).toEqual({ kind: "agent", utterance: "" });
  });

  it("says what App, Flow and component actions would open", () => {
    expect(presentationFor(item("Maps", "Maps", { type: "app", target: "maps://" }), home)).toMatchObject({ kind: "placeholder", type: "App", target: "maps://" });
    expect(presentationFor(item("F", "F", { type: "flow", target: "My_Flow" }), home)).toMatchObject({ kind: "placeholder", type: "Flow" });
    expect(presentationFor(item("C", "C", { type: "LightningComponent" }), rec)).toMatchObject({ kind: "placeholder", type: "Lightning component", target: "C" });
  });

  it("flags a URL action with no URL instead of staying silent", () => {
    expect(presentationFor(item("U", "U", { type: "url" }), home)).toMatchObject({ kind: "placeholder", type: "URL" });
  });

  it("keeps a quick action ahead of a custom one with the same name", () => {
    expect(presentationFor(item("Email", "Email", { type: "url", target: "https://x" }), home).kind).toBe("email");
  });
});

describe("homeMenu carries the custom action target", () => {
  it("passes ActionTarget, TargetType and HideViewInBrowserAction through", () => {
    const menu = homeMenu([], [{ masterLabel: "PJ", entityType: "HomePage", actionType: "URL", actionTarget: "https://x", targetType: "Internal", hideBrowser: true }], "P");
    expect(menu[0].action).toEqual({ type: "url", target: "https://x", targetType: "Internal", hideBrowser: true });
  });
});

describe("agentName", () => {
  it("reads the agent permission set", () => {
    expect(agentName(["LSC_All_Agents_User", "Field_Sales_HCP_Agent_US_Access"])).toBe("Field Sales HCP Agent US");
  });
  it("falls back to Agentforce", () => {
    expect(agentName(["LSC_All_Agents_User"])).toBe("Agentforce");
    expect(agentName(undefined)).toBe("Agentforce");
  });
});
