import type { OrgKind, OrgRef } from "../orgs.js";

/** The org a session works in, as its engine needs it. */
export interface SessionOrg {
  ref: OrgRef;
  /** Unknown when the connection is no longer in `sf org list`. */
  kind?: OrgKind;
}

/** Tools that would point the session's server at another org. */
export const ORG_SWITCH_TOOLS = new Set(["set_target_org"]);

const KIND_LABEL: Record<OrgKind, string> = {
  production: "a production org",
  sandbox: "a sandbox",
  scratch: "a scratch org",
  developer: "a Developer Edition org",
  trial: "a trial org",
};

/** The system prompt section that tells the model which org the session works in. */
export function orgPromptSection(org: SessionOrg | null): string {
  if (!org) {
    return [
      "# Salesforce org",
      "",
      "No Salesforce org is connected for this session. Answer from the LSC knowledge tools; if the user needs org data, tell them to log in to an org from the org menu at the top of the sidebar and start a new session.",
    ].join("\n");
  }
  const { ref, kind } = org;
  const where = [ref.username, ref.instanceUrl].filter(Boolean).join(", ");
  const lines = [
    "# Salesforce org for this session",
    "",
    `This session works in the org "${ref.label}" (${where})${kind ? `, ${KIND_LABEL[kind]}` : ""}. Every Salesforce tool already runs against it.`,
    "Never call set_target_org, never ask which org to use, and don't list orgs to choose one. If the user wants to work in another org, tell them to switch orgs from the org menu at the top of the sidebar — that opens that org's sessions — and ask there.",
  ];
  if (kind === "production") {
    lines.push(
      "This is a production org: before any tool creates, updates, or deletes records, metadata, settings, or permissions, say exactly what will change and get the user's confirmation in this conversation first."
    );
  }
  return lines.join("\n");
}

export function orgSwitchRefusal(org: SessionOrg | null): string {
  const label = org ? `"${org.ref.label}"` : "no org";
  return `This session works in ${label} and can't switch orgs. To work in another org, the user switches orgs from the org menu at the top of the sidebar and starts a session there.`;
}
