import type { ConfigFieldInput, CreateConfigFix, StudioItem } from "./types";

/**
 * Forms for new Admin Console records — which fields each category's form
 * shows, how they're entered, and where its profiles live. Values follow what
 * the create_* tools write, so a record made in Studio matches one made in chat.
 */

export type FieldInput = "picklist" | "text" | "longtext" | "number" | "boolean";
export type FormValue = string | number | boolean;

export interface FieldSpec {
  name: string;
  label: string;
  input: FieldInput;
  options?: string[];
  required?: boolean;
  help?: string | ((values: Record<string, FormValue>) => string);
  /** Shown only when this returns true for the form's current values. */
  showIf?: (values: Record<string, FormValue>) => boolean;
  /** Suggestions offered as the admin types (e.g. object names). */
  suggest?: "objects";
  min?: number;
  max?: number;
}

export interface FormSpec {
  noun: string;
  /** Prefix for API names derived from the label. */
  prefix: string;
  /** Where the record's profiles are kept: its `Profiles` field, or Admin Console assignments. */
  profilesIn: "field" | "assignments";
  fields: FieldSpec[];
}

export const FORMS: Record<string, FormSpec> = {
  QuickAction: {
    noun: "quick action",
    prefix: "QuickAction_",
    profilesIn: "field",
    fields: [
      {
        name: "Location",
        label: "Where it appears",
        input: "picklist",
        required: true,
        options: ["HomePage", "Account", "Visit", "Search", "NextBestCustomer", "Presentation", "VisitSearch"],
      },
      {
        name: "ActionName",
        label: "Action",
        input: "picklist",
        required: true,
        options: ["Email", "NewVisit", "LogCall", "NewTask", "NewEvent", "IntelligentContent", "ViewOnline", "Consent", "WebEmail"],
      },
      {
        name: "SortOrder",
        label: "Position",
        input: "number",
        min: 1,
        max: 100,
        help: (v) => (v.Location === "HomePage" ? "The iPad home page shows the first 5." : "Lower numbers come first."),
      },
    ],
  },
  CustomAction: {
    noun: "custom action",
    prefix: "CustomAction_",
    profilesIn: "field",
    fields: [
      { name: "EntityType", label: "Where it appears", input: "picklist", required: true, options: ["HomePage", "SObject", "StagePath", "Visit"] },
      {
        name: "EntityName",
        label: "Object",
        input: "text",
        suggest: "objects",
        help: "The object API name whose records show the action, e.g. Account.",
        showIf: (v) => v.EntityType === "SObject",
      },
      { name: "ActionType", label: "Type", input: "picklist", required: true, options: ["URL", "App", "Utterance"] },
      {
        name: "ActionTarget",
        label: "Target",
        input: "text",
        required: true,
        help: (v) =>
          v.ActionType === "App"
            ? "The component or flow to open."
            : v.ActionType === "Utterance"
              ? "What to say to Agentforce."
              : "The URL to open.",
      },
      {
        name: "TargetType",
        label: "Opens",
        input: "picklist",
        options: ["Internal", "External"],
        help: "Internal opens inside the app; External opens the browser.",
        showIf: (v) => v.ActionType === "URL",
      },
      {
        name: "TargetParameters",
        label: "Parameters",
        input: "text",
        help: "Passed to the target, e.g. q=$record.Name.",
      },
    ],
  },
  UISchema: {
    noun: "navigation tab",
    prefix: "NavTab_",
    profilesIn: "assignments",
    fields: [
      { name: "TabName", label: "Tab", input: "text", required: true, help: "The tab's API name, e.g. Account or a custom tab like My_Tab__c." },
      { name: "TabOrder", label: "Position", input: "number", required: true, min: 1, help: "Tabs are shown in this order on the iPad." },
    ],
  },
  DbSchema: {
    noun: "DB Schema record",
    prefix: "DbSchema_",
    profilesIn: "assignments",
    fields: [
      { name: "SObject", label: "Object", input: "text", required: true, suggest: "objects", help: "The object API name to sync to the iPad." },
      { name: "Type", label: "Type", input: "picklist", required: true, options: ["DATA", "CONFIGURATION"] },
      {
        name: "WhereSoql",
        label: "Filter",
        input: "longtext",
        help: "A SOQL WHERE condition, without WHERE. Empty syncs every record the user can see — keep it tight on large objects.",
      },
      { name: "OneWaySync", label: "Download only", input: "boolean", help: "Reps can't create or edit these records offline." },
    ],
  },
};

/** Salesforce API name rules; null when the name is fine. Mirrors src/studio/create.ts. */
export function developerNameProblem(name: string): string | null {
  if (!name) return "Enter an API name.";
  if (name.length > 80) return "The API name must be 80 characters or fewer.";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return "The API name must start with a letter and use only letters, numbers, and underscores.";
  if (name.includes("__") || name.endsWith("_")) return "The API name can't have two underscores in a row or end with one.";
  return null;
}

/** An API name from a label: "Log a call" → "QuickAction_Log_a_call". */
export function apiNameFor(label: string, prefix: string): string {
  const base = label
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "X$1");
  return `${prefix}${base || "New"}`.slice(0, 80).replace(/_+$/, "");
}

/** Parentheses round a filter, so it can't change meaning when the app adds its own conditions. */
export function wrapFilter(soql: string): string {
  const s = soql.trim();
  if (!s) return "";
  return s.startsWith("(") && s.endsWith(")") ? s : `(${s})`;
}

/** A "Duplicate…" draft for an editable Admin Console item: everything copied, then overridden by the form. */
export function duplicateDraft(item: StudioItem): CreateConfigFix | null {
  const edit = item.edit;
  if (!edit || edit.record.type !== "config" || !FORMS[edit.record.category]) return null;
  const { category, developerName, label } = edit.record;
  const spec = FORMS[category];
  const base = developerName.startsWith(spec.prefix) ? developerName : `${spec.prefix}${developerName}`;
  return {
    kind: "createConfigRecord",
    label: `Duplicate ${label}`,
    category,
    developerName: `${base.slice(0, 75).replace(/_+$/, "")}_Copy`,
    recordLabel: `${label} (copy)`.slice(0, 80),
    copyFrom: developerName,
    fields: [],
    profiles: edit.profiles?.source === "assignments" ? edit.profiles.names : [],
    active: edit.active ?? true,
  };
}

/** The form's starting values: the draft's fields, else what the copied item shows. */
export function initialValues(draft: CreateConfigFix, item?: StudioItem): Record<string, FormValue> {
  const spec = FORMS[draft.category];
  const values: Record<string, FormValue> = {};
  for (const f of spec?.fields ?? []) {
    const fromDraft = draft.fields.find((d) => d.name === f.name)?.value;
    const fromItem = item?.properties[f.name];
    const v = fromDraft ?? fromItem;
    values[f.name] = v === null || v === undefined ? (f.input === "boolean" ? false : "") : v;
  }
  return values;
}

/**
 * Field values to send. A new record sends every visible field that's filled
 * in; a duplicate sends only what the admin changed, so the rest is copied exactly.
 */
export function fieldInputs(
  spec: FormSpec,
  values: Record<string, FormValue>,
  opts: { copying: boolean; touched: Set<string>; profiles: string[]; profilesTouched: boolean; profilesIn: FormSpec["profilesIn"] }
): ConfigFieldInput[] {
  const out: ConfigFieldInput[] = [];
  for (const f of spec.fields) {
    if (f.showIf && !f.showIf(values)) continue;
    if (opts.copying && !opts.touched.has(f.name)) continue;
    let v = values[f.name];
    if (f.input === "number") {
      if (v === "" || v === undefined) continue;
      v = Number(v);
    }
    if (f.name === "WhereSoql") v = wrapFilter(String(v ?? ""));
    if (!opts.copying && f.input !== "boolean" && f.name !== "WhereSoql" && (v === "" || v === undefined)) continue;
    out.push({ name: f.name, value: v });
  }
  if (opts.profilesIn === "field" && (opts.copying ? opts.profilesTouched : opts.profiles.length > 0)) {
    out.push({ name: "Profiles", value: opts.profiles.join(";") });
  }
  return out;
}

/** Problems the form can catch before anything is sent: missing required fields and a bad API name. */
export function formProblems(spec: FormSpec, values: Record<string, FormValue>, draft: { developerName: string; recordLabel: string; copying: boolean }): string[] {
  const problems: string[] = [];
  if (!draft.recordLabel.trim()) problems.push("Enter a label.");
  const name = developerNameProblem(draft.developerName);
  if (name) problems.push(name);
  if (!draft.copying) {
    for (const f of spec.fields) {
      if (!f.required || (f.showIf && !f.showIf(values))) continue;
      if (values[f.name] === "" || values[f.name] === undefined) problems.push(`Fill in ${f.label}.`);
    }
  }
  for (const f of spec.fields) {
    if (f.input !== "number" || values[f.name] === "") continue;
    const n = Number(values[f.name]);
    if (!Number.isInteger(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
      problems.push(`${f.label} must be a whole number${f.max ? ` from ${f.min ?? 1} to ${f.max}` : f.min ? ` of ${f.min} or more` : ""}.`);
    }
  }
  return problems;
}

/** The profiles a draft starts with, wherever the category keeps them. */
export function draftProfiles(draft: CreateConfigFix, item?: StudioItem): string[] {
  if (profilesWhere(draft, item) === "assignments" || draft.profiles.length) return draft.profiles;
  const listed = draft.fields.find((f) => f.name === "Profiles")?.value;
  const raw = listed !== undefined ? String(listed ?? "") : item?.edit?.profiles?.source === "field" ? item.edit.profiles.raw : "";
  return raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

/** Where this record keeps its profiles — a duplicate keeps the original's choice. */
export function profilesWhere(draft: CreateConfigFix, item?: StudioItem): FormSpec["profilesIn"] {
  return item?.edit?.profiles?.source ?? FORMS[draft.category]?.profilesIn ?? "assignments";
}
