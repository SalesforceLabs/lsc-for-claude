import { describe, it, expect } from "vitest";
import { emailTemplateList, homeMenu, recordMenu, recordMenus, type HomeQuickAction, type LayoutActionItem } from "../../../../src/studio/screens/fabs.js";
import { fabState, menuLayout, recordFabItems } from "../../../../src-renderer/components/studio/ipad-fabs-logic";

const PROFILE = "LS PH Field Sales Representative";
const q = (actionName: string, sortOrder: number, profiles = PROFILE, location = "HomePage"): HomeQuickAction => ({ actionName, masterLabel: `QuickAction_${actionName}`, location, sortOrder, profiles });
const c = (masterLabel: string, entityType = "HomePage", actionType = "URL") => ({ masterLabel, entityType, actionType });

describe("homeMenu", () => {
  it("lists HomePage quick actions by sort order, then custom actions by label", () => {
    const menu = homeMenu(
      [q("Email", 5), q("NewVisit", 1), q("Inquiry", 3), q("Email", 5, PROFILE, "Search")],
      [c("TabNext Dashboard"), c("SF Maps"), c("Sample IM"), c("Salesforce Maps"), c("Log an Expense", "HomePage", "Utterance"), c("CustomAction_VeevaLink"), c("Veeva Link", "SObject")],
      PROFILE
    );
    expect(menu.map((m) => m.label)).toEqual(["New Visit", "Inquiry", "Email", "CustomAction_VeevaLink", "Log an Expense", "Salesforce Maps", "Sample IM", "SF Maps", "TabNext Dashboard"]);
  });

  it("keeps only the viewer's profile and the actions the app lists", () => {
    const menu = homeMenu([q("NewVisit", 1, "System Administrator;LS PH Field Medical"), q("CreateMedicalInsight", 5), q("Survey", 9), q("ShareContent", 4)], [], PROFILE);
    expect(menu.map((m) => m.label)).toEqual(["Share Content"]);
  });

  it("dedupes by name", () => {
    expect(homeMenu([q("Email", 5), q("Email", 6)], [], PROFILE)).toHaveLength(1);
  });
});

const item = (name: string, label: string, type: string, sortOrder: string): LayoutActionItem => ({ name, label, type, sortOrder });

describe("recordMenu", () => {
  it("falls back to the layout's actions: sorted, supported names only (Account device menu)", () => {
    const layout = [
      item("Account.lsc4ce__Email", "Send Email", "LightningComponent", "6"),
      item("Account.New_Inquiry", "New Inquiry", "LightningComponent", "1"),
      item("Account.lsc4ce__Inquiry", "Inquiry", "LightningComponent", "2"),
      item("Account.lsc4ce__NewVisit", "New Visit", "LightningComponent", "3"),
      item("Account.lsc4ce__NextBestCustomer", "Next Best Customer", "LightningComponent", "4"),
      item("Account.lsc4ce__Survey", "Survey", "LightningWebComponent", "5"),
      item("StandardButton.Edit", "Edit", "StandardButton", "7"),
      item("LogACall", "LogACall", "LogACall", "8"),
      item("lscMobileInline_x", "Inline", "LightningWebComponent", "9"),
    ];
    expect(recordMenu(undefined, layout).map((m) => m.label)).toEqual(["Inquiry", "New Visit", "Next Best Customer", "Survey", "Send Email"]);
  });

  it("drops actions typed as something the factory can't build", () => {
    expect(recordMenu(undefined, [item("Account.lsc4ce__Email", "Send Email", "Create", "1")])).toEqual([]);
  });

  it("uses the page's dynamic actions and hides Unlock (Visit device menu)", () => {
    const layout = [item("Visit.lsc4ce__Email", "Email", "", "1")];
    expect(recordMenu(["Edit", "Visit.lsc4ce__Email", "Visit.lsc4ce__Unlock", "ChangeOwnerOne"], layout)).toEqual([{ name: "Visit.lsc4ce__Email", label: "Email" }]);
  });

  it("titles an action by its type when the layout has no label", () => {
    expect(recordMenu(["Visit.lsc4ce__NewVisit"], undefined)[0].label).toBe("New Visit");
  });

  it("is empty when the page and layout offer nothing", () => {
    expect(recordMenu(undefined, undefined)).toEqual([]);
  });
});

describe("recordMenus", () => {
  it("resolves each record type through its flexipage and layout", () => {
    const core = {
      objects: { Visit: { recordTypes: [{ name: "Call", layout: "Visit-L", flexiPage: "VP" }, { name: "Plain", layout: "Visit-L", flexiPage: null }] } },
      pages: { VP: { regions: [{ name: "main", components: [{ name: "force:highlightsPanel", actions: ["Visit.lsc4ce__Email"] }] }] } },
      layouts: { "Visit-L": { actionItems: [item("Visit.lsc4ce__NewVisit", "New Visit", "", "1"), item("Visit.lsc4ce__Email", "Email", "", "2")] } },
    } as unknown as Parameters<typeof recordMenus>[0];
    const menus = recordMenus(core);
    expect(menus.Visit.Call.map((m) => m.label)).toEqual(["Email"]);
    expect(menus.Visit.Plain.map((m) => m.label)).toEqual(["New Visit", "Email"]);
  });
});

describe("fabState", () => {
  const base = { onRecord: false, menuCount: 3, agentforce: true };
  it("shows both on Home and on records", () => {
    expect(fabState({ ...base, kind: "home" })).toEqual({ astro: true, more: true });
    expect(fabState({ ...base, kind: "accounts", onRecord: true })).toEqual({ astro: true, more: true });
  });
  it("hides ••• when it has no actions", () => {
    expect(fabState({ ...base, kind: "home", menuCount: 0 })).toEqual({ astro: true, more: false });
  });
  it("hides Agentforce without the feature", () => {
    expect(fabState({ ...base, kind: "home", agentforce: false })).toEqual({ astro: false, more: true });
  });
  it("shows Agentforce alone on Tableau", () => {
    expect(fabState({ ...base, kind: "tableau" })).toEqual({ astro: true, more: false });
  });
  it("shows Agentforce alone on a flexipage tab (Pat Sim), whose ••• has no actions", () => {
    expect(fabState({ ...base, kind: "flexiPage", menuCount: 0 })).toEqual({ astro: true, more: false });
    expect(fabState({ ...base, kind: "flexiPage", menuCount: 0, agentforce: false })).toEqual({ astro: false, more: false });
  });
  it("shows nothing on the other lists, Calendar, Intelligent Content, Reports, Search", () => {
    for (const kind of ["accounts", "calendar", "content", "reports", "recent", "visits", undefined]) expect(fabState({ ...base, kind })).toEqual({ astro: false, more: false });
  });
});

describe("menuLayout", () => {
  const widths = (n: number, w = 45) => Array.from({ length: n }, () => w);
  it("stacks from 746 - 65n at a 63.5pt pitch (device: Home 96, Account 421, Visit 681)", () => {
    expect(menuLayout(widths(10)).tops[0]).toBe(96);
    const five = menuLayout(widths(5)).tops;
    expect(five[0]).toBe(421);
    expect(five[1]).toBeCloseTo(484.5, 1);
    expect(menuLayout(widths(1)).tops).toEqual([681]);
  });
  it("shares the widest title's width plus insets, at most 320", () => {
    expect(menuLayout([45]).width).toBe(81);
    expect(menuLayout([10, 214.2]).width).toBe(250);
    expect(menuLayout([400]).width).toBe(320);
  });
});

describe("recordFabItems", () => {
  const fabs = { records: { Visit: { Call: [{ name: "a", label: "A" }], Other: [] } } };
  it("picks the record type's menu, else the object's first", () => {
    expect(recordFabItems(fabs, "Visit", "Call")).toHaveLength(1);
    expect(recordFabItems(fabs, "Visit", "Missing")).toHaveLength(1);
    expect(recordFabItems(fabs, "Account", "x")).toEqual([]);
    expect(recordFabItems(undefined, "Visit", "Call")).toEqual([]);
  });
});

describe("emailTemplateList", () => {
  const rows = [
    { Id: "b", Name: "Zeta", Product: { Name: "P" }, Description: "d" },
    { Id: "a", Name: "alpha" },
    { Id: "c", Name: "" },
  ];
  it("sorts by name and drops unnamed templates", () => {
    expect(emailTemplateList(rows, []).map((t) => t.id)).toEqual(["a", "b"]);
  });
  it("narrows to the territory's assigned templates", () => {
    expect(emailTemplateList(rows, ["b"])).toEqual([{ id: "b", name: "Zeta", product: "P", description: "d" }]);
  });
});
