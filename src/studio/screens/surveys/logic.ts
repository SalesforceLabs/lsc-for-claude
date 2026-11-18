/**
 * Surveys from the ••• menu, pure rules. iOS: OCEDemo/Tabs/Survey (list) and
 * module/CustomerRatings/CustomerRatings/SurveysQuestionViewModel.swift (questions).
 */

export type SurveyStatus = "open" | "started" | "completed";

export interface SurveyListRow {
  /** The survey (one row per survey, newest invitation). */
  id: string;
  invitationId: string;
  name: string;
  developerName: string;
  version: number | null;
  status: SurveyStatus;
  /** 0-100; 0 with no response. */
  percent: number;
  completedBy?: string;
  completedOn?: string;
  expires?: string;
}

export type QuestionKind =
  | "single"
  | "picklist"
  | "rating"
  | "multi"
  | "slider"
  | "date"
  | "short"
  | "text"
  | "info";

export interface SurveyChoice {
  id: string;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  text: string;
  help: string;
  required: boolean;
  kind: QuestionKind;
  choices: SurveyChoice[];
  min?: number;
  max?: number;
}

export interface SurveyPage {
  name: string;
  label: string;
  questions: SurveyQuestion[];
}

export interface SurveyForm {
  title: string;
  pages: SurveyPage[];
}

/** HTML entities and tags the flow's text carries; iOS shows `html2String`. */
export function plainText(html: unknown): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Which control a question gets. iOS: SurveysQuestionViewModel.getSurveysQuestionControl (~L164-190), by
 * (dataType, fieldType) and the extension name. A field with no data type (the welcome component) has no
 * control on the device's mapper either; the preview shows its text.
 */
export function questionKind(
  dataType: string | undefined,
  fieldType: string | undefined,
  extensionName: string | undefined
): QuestionKind {
  if (fieldType === "MultiSelectCheckboxes" || fieldType === "MultiSelectPicklist") return "multi";
  if (fieldType === "ComponentInstance") return "info";
  const choice = fieldType === "RadioButtons" || fieldType === "ComponentChoice";
  if (dataType === "String" && choice)
    return extensionName === "survey:runtimePicklist" ? "picklist" : "single";
  if (dataType === "Number" && choice) return "rating";
  if (dataType === "Number" && fieldType === "ComponentInput")
    return extensionName === "survey:cmpInputRuntimeSlider" ? "slider" : "text";
  if (dataType === "Date") return "date";
  if (dataType === "String" && fieldType === "ComponentInput") return "short";
  return "text";
}

interface FlowField {
  name?: string;
  fieldType?: string;
  dataType?: string;
  extensionName?: string;
  fieldText?: string;
  helpText?: string;
  isRequired?: boolean;
  choiceReferences?: string[];
  processMetadataValues?: { name?: string; value?: { stringValue?: string } }[];
}
interface FlowScreen {
  name?: string;
  label?: string;
  fields?: FlowField[];
}
interface FlowChoice {
  name?: string;
  choiceText?: string;
  value?: { stringValue?: string; numberValue?: number };
}
export interface Flow {
  label?: string;
  processType?: string;
  screens?: FlowScreen[];
  choices?: FlowChoice[];
}

function pmv(f: FlowField, key: string): number | undefined {
  const raw = f.processMetadataValues?.find((p) => p.name === key)?.value?.stringValue;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The pages and questions of a survey flow. iOS: SurveysQuestionViewModel.loadSurveyQuestions (L270) takes every
 * field of every screen in order; the screen's label is the page. Choice text is HTML (html2String).
 */
export function parseFlow(flow: Flow): SurveyForm {
  const byName = new Map((flow.choices ?? []).map((c) => [c.name ?? "", c]));
  const pages = (flow.screens ?? []).map(
    (s, i): SurveyPage => ({
      name: s.name ?? `page${i}`,
      label: s.label || `Page ${i + 1}`,
      questions: (s.fields ?? []).map((f): SurveyQuestion => {
        const kind = questionKind(f.dataType, f.fieldType, f.extensionName);
        return {
          id: f.name ?? "",
          text: plainText(f.fieldText),
          help: plainText(f.helpText),
          required: f.isRequired === true,
          kind,
          choices: (f.choiceReferences ?? []).flatMap((ref) => {
            const c = byName.get(ref);
            return c ? [{ id: ref, label: plainText(c.choiceText) }] : [];
          }),
          min: pmv(f, "min"),
          max: pmv(f, "max"),
        };
      }),
    })
  );
  return { title: flow.label ?? "", pages: pages.filter((p) => p.questions.length > 0) };
}

/** Flow keys are `<developerName>-<version>`, bare or with a namespace. iOS: SurveyViewModel loadFromFlowJSON ~L299. */
export function findFlow<T>(
  flows: Record<string, T>,
  developerName: string,
  version: number | null
): T | undefined {
  const want = `${developerName}-${version ?? ""}`;
  if (version != null) {
    if (flows[want]) return flows[want];
    const hit = Object.keys(flows).find((k) => k.endsWith(`__${want}`));
    if (hit) return flows[hit];
  }
  const prefix = `${developerName}-`;
  const keys = Object.keys(flows).filter((k) => k.startsWith(prefix) || k.includes(`__${prefix}`));
  const ver = (k: string) => Number(k.slice(k.lastIndexOf("-") + 1)) || 0;
  keys.sort((a, b) => ver(a) - ver(b));
  return keys.length ? flows[keys[keys.length - 1]] : undefined;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v));

/**
 * One row per survey. iOS: SurveyBaseStrategy.getSurveysWithoutDuplications keeps the newest invitation per
 * survey (later createddate) and orders by survey name. Status comes from the viewer's response
 * (SurveyRelatedListModel: no response is open at 0%; completed and completedandmigrated are completed).
 */
export function buildList(input: {
  invitations: Row[];
  surveys: Row[];
  versions: Row[];
  responses: Row[];
  users: Row[];
}): SurveyListRow[] {
  const surveys = new Map(input.surveys.map((r) => [s(r.Id), r]));
  const versions = new Map(input.versions.map((r) => [s(r.Id), r]));
  const users = new Map(input.users.map((r) => [s(r.Id), s(r.Name)]));
  const newest = new Map<string, Row>();
  for (const inv of input.invitations) {
    const sid = s(inv.SurveyId);
    if (!surveys.has(sid)) continue;
    const cur = newest.get(sid);
    if (!cur || s(inv.CreatedDate) > s(cur.CreatedDate)) newest.set(sid, inv);
  }
  const rows: SurveyListRow[] = [];
  for (const [sid, inv] of newest) {
    const sv = surveys.get(sid) as Row;
    const ver = versions.get(s(sv.ActiveVersionId));
    const resp = input.responses
      .filter((r) => s(r.InvitationId) === s(inv.Id))
      .sort((a, b) => s(b.LastModifiedDate).localeCompare(s(a.LastModifiedDate)))[0];
    const raw = s(resp?.Status).toLowerCase();
    const done = raw === "completed" || raw === "completedandmigrated";
    rows.push({
      id: sid,
      invitationId: s(inv.Id),
      name: s(sv.Name),
      developerName: s(sv.DeveloperName),
      version: ver?.VersionNumber == null ? null : Number(ver.VersionNumber),
      status: done ? "completed" : resp ? "started" : "open",
      percent: done ? 100 : 0,
      completedBy: done ? users.get(s(resp?.CreatedById)) || undefined : undefined,
      completedOn: done
        ? s(resp?.LastModifiedDate || resp?.CompletionDateTime) || undefined
        : undefined,
      expires: s(inv.InviteExpiryDateTime) || undefined,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
