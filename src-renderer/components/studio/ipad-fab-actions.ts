import type { PublishedFabItem } from "./screens/fabs-types";
import { bundleName, isLwcAction } from "./actions/lwc/logic";

/** What tapping a ••• menu item presents (SFActionFactory → the quick-action handlers / ExterAppOrURLCoordinator / AgentForceActionHandler). */
export type Presentation =
  /** New Visit: the Visit Engagement editor (the Account comes from the record you tapped it on). */
  | {
      kind: "visit";
      /** Edit Visit from Home's Visits To Submit: the Visit record id whose values fill the editor. */ edit?: string;
    }
  /** Inquiry: the record type picker, then the create form. */
  | { kind: "inquiry" }
  /** Email: ChooseAccountCoordinator (Home only), then the field-email template picker. */
  | { kind: "email"; pickProvider: boolean }
  /** Next Best Customer: the "Why <account>?" sheet. */
  | { kind: "nbc" }
  /** Survey: the survey picker. */
  | { kind: "survey" }
  /** URL custom action, Internal target: ModalWebViewController titled "External URL". */
  | { kind: "browser"; url: string; hideSafari: boolean }
  /** URL custom action, External target: Safari. */
  | { kind: "safari"; url: string }
  /** Utterance custom action, or the Agentforce button (empty utterance): the agent panel. */
  | { kind: "agent"; utterance: string }
  /** Account action newquote / createquote: the Quote create flow, price book, products (SFActionType.swift:277 → module/Orders). */
  | { kind: "order" }
  /** A "+" on an object: its create form from the published layout (SObjectsCoordinator.showAddNewScreen). */
  | { kind: "create"; object: string; label: string }
  | { kind: "consent" }
  /** Account action createpromoplan: KAMPromoPlanCoordinator, an 800x650 form sheet (KAMActionsProvider). */
  | { kind: "promoPlan" }
  /** A LightningWebComponent action (an LSC app): SFLMRAction pushes the component's page, passing the record (LMRContext.swift:215-239). */
  | { kind: "lwcAction"; title: string; actionName: string; bundle: string }
  /** Anything the preview can't draw: says what the app would open. */
  | { kind: "placeholder"; title: string; type: string; target: string; detail: string };

const placeholder = (item: PublishedFabItem, type: string, detail: string): Presentation => ({
  kind: "placeholder",
  title: item.label,
  type,
  target: item.name,
  detail,
});

const key = (name: string): string =>
  (name.split(".").pop() ?? name).replace(/^lsc4ce__/i, "").toLowerCase();

/** The Agentforce button opens the agent panel with no utterance. */
export const AGENT_BUTTON: Presentation = { kind: "agent", utterance: "" };

function custom(item: PublishedFabItem): Presentation | undefined {
  const a = item.action;
  if (!a) return undefined;
  const type = a.type.toLowerCase();
  const target = a.target ?? "";
  if (type === "utterance") return { kind: "agent", utterance: target };
  if (type === "url") {
    if (!target)
      return {
        kind: "placeholder",
        title: item.label,
        type: "URL",
        target: "(no URL on the action)",
        detail: "The app opens the action's URL, but this action has none.",
      };
    return a.targetType?.toLowerCase() === "external"
      ? { kind: "safari", url: target }
      : { kind: "browser", url: target, hideSafari: !!a.hideBrowser };
  }
  if (type === "app")
    return {
      kind: "placeholder",
      title: item.label,
      type: "App",
      target: target || "(none)",
      detail: "The app launches another app from this link (UIApplication.open); Studio can't.",
    };
  if (type === "flow")
    return {
      kind: "placeholder",
      title: item.label,
      type: "Flow",
      target: target || "(none)",
      detail: "The app runs this flow for users with the RunFlow permission.",
    };
  if (isLwcAction(type, item.name, a.target))
    return { kind: "lwcAction", title: item.label, actionName: item.name, bundle: bundleName(item.name, a.target) };
  if (type === "lightningcomponent" || type === "lightningwebcomponent") {
    return {
      kind: "placeholder",
      title: item.label,
      type: "Lightning component",
      target: target || item.name,
      detail: "The app opens this Lightning component in a page; Studio can't run it.",
    };
  }
  return undefined;
}

/** The sheet for a tapped menu item; `onRecord` is whether the menu belongs to a record page (the account is then known). */
export function presentationFor(item: PublishedFabItem, ctx: { onRecord: boolean }): Presentation {
  switch (key(item.name)) {
    case "newvisit":
    case "logavisit":
      return { kind: "visit" };
    case "inquiry":
      return { kind: "inquiry" };
    case "email":
      return { kind: "email", pickProvider: !ctx.onRecord };
    case "survey":
      return { kind: "survey" };
    case "newquote":
    case "createquote":
    case "neworder":
      return { kind: "order" };
    case "newaccountplan":
    case "createaccountplan":
      return { kind: "create", object: "AccountPlan", label: "New Account Plan" };
    case "generatedocument":
      return placeholder(
        item,
        "Quick action",
        // KAMActionsProvider routes AccountPlan generateDocument to generateDocumentsCoordinator, the Documents template flow (SFActionFactory generateDocumentsCoordinator).
        "Not in the preview: the app opens its document flow to build a document from a template."
      );
    case "clone":
      // BusinessToDo clone opens the create form seeded from the record; other objects' clone isn't drawn.
      if (/^(\w+__)?BusinessToDo\./i.test(item.name)) return { kind: "create", object: "BusinessToDo", label: item.label || "Clone" };
      break;
    case "createpromoplan":
      return { kind: "promoPlan" };
    case "logacall":
    case "callwithrtselection":
      return placeholder(
        item,
        "Quick action",
        // SFAccountActionCoordinator.swift:215 logACall → LogCallCoordinator; LogCallViewController is a web view container.
        "The app opens the Log a Call screen, a web page inside the app that needs the Call object to be creatable. Studio can't draw that page."
      );
    case "startremotesession":
    case "startremotesessionaura":
      return placeholder(
        item,
        "Quick action",
        // SFAccountActionCoordinator.swift:155 startRemoteCall → AdHocCall2Coordinator: validates, downloads the call, starts a Twilio session.
        "The app checks the account can be called, creates the call and starts a Twilio video session. Studio can't start one."
      );
    case "captureconsent":
    case "capturecommunicationconsent":
      if (ctx.onRecord) return { kind: "consent" };
      break;
    case "storecheck":
      return placeholder(
        item,
        "Quick action",
        // SFActionType.swift:307 .storeCheck → module/StoreCheck, an assortment and KPI data grid driven by the org's store check setup.
        "The app opens the Store Check grid of assortment and KPI rows for the account. Studio doesn't read that setup yet."
      );
    case "nbc":
    case "nextbestcustomer":
      return ctx.onRecord
        ? { kind: "nbc" }
        : {
            kind: "placeholder",
            title: item.label,
            type: "Quick action",
            target: item.name,
            detail: "Next Best Customer opens from an account.",
          };
  }
  const c = custom(item);
  if (c) return c;
  return {
    kind: "placeholder",
    title: item.label,
    type: item.action?.type ? item.action.type : "Quick action",
    target: item.name,
    detail: "The app runs this action; Studio doesn't draw its screen yet.",
  };
}

/** The agent's display name: the Agentforce agent permission set the viewer holds (`Field_Sales_HCP_Agent_US_Access` becomes "Field Sales HCP Agent US"), else "Agentforce". */
export function agentName(permissionSets: string[] | undefined): string {
  const ps = (permissionSets ?? []).find(
    (p) => /Agent_.*_Access$/.test(p) && !/All_Agents/.test(p)
  );
  return ps ? ps.replace(/_Access$/, "").replace(/_/g, " ") : "Agentforce";
}
