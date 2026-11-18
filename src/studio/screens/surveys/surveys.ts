/**
 * Surveys, read on demand when the Surveys sheet opens. iOS: SurveyBaseStrategy.getSurveysWithoutDuplications
 * (invitations through survey subjects pointing at the account), SurveyRelatedListModel (status) and the
 * flow JSON in the profile's metadata cache (SurveyViewModel). Read-only, as the connected admin.
 */

import { cacheContents, cacheFile } from "../../metadata-cache.js";
import { inList, query, type Row } from "../../helpers.js";
import {
  buildList,
  findFlow,
  parseFlow,
  type Flow,
  type SurveyForm,
  type SurveyListRow,
} from "./logic.js";

export interface PublishedSurveys {
  surveys: SurveyListRow[];
  notes: string[];
}

const s = (v: unknown): string => (v == null ? "" : String(v));

export async function loadSurveys(
  org: string,
  accountId: string,
  viewerUserId?: string
): Promise<PublishedSurveys> {
  const notes: string[] = [];
  const subjects = await query(
    `SELECT ParentId, SurveyId FROM SurveySubject WHERE SubjectId IN (${inList([accountId])}) LIMIT 500`,
    org
  );
  if (subjects.length === 500)
    notes.push("Showing surveys from the first 500 invitations for this account.");
  const invIds = [...new Set(subjects.map((r) => s(r.ParentId)).filter(Boolean))];
  if (!invIds.length) return { surveys: [], notes };
  const invitations = await query(
    `SELECT Id, SurveyId, InviteExpiryDateTime, CreatedDate FROM SurveyInvitation WHERE Id IN (${inList(invIds)}) LIMIT 500`,
    org
  );
  const surveyIds = [...new Set(invitations.map((r) => s(r.SurveyId)).filter(Boolean))];
  const surveys = surveyIds.length
    ? await query(
        `SELECT Id, Name, DeveloperName, ActiveVersionId FROM Survey WHERE Id IN (${inList(surveyIds)}) LIMIT 500`,
        org
      )
    : [];
  const versionIds = [...new Set(surveys.map((r) => s(r.ActiveVersionId)).filter(Boolean))];
  const [versions, responses] = await Promise.all([
    versionIds.length
      ? query(
          `SELECT Id, VersionNumber FROM SurveyVersion WHERE Id IN (${inList(versionIds)})`,
          org
        )
      : Promise.resolve([] as Row[]),
    query(
      `SELECT InvitationId, Status, CompletionDateTime, LastModifiedDate, CreatedById FROM SurveyResponse WHERE InvitationId IN (${inList(invIds)})${viewerUserId ? ` AND CreatedById IN (${inList([viewerUserId])})` : ""} LIMIT 500`,
      org
    ).catch(() => [] as Row[]),
  ]);
  const userIds = [...new Set(responses.map((r) => s(r.CreatedById)).filter(Boolean))];
  const users = userIds.length
    ? await query(`SELECT Id, Name FROM User WHERE Id IN (${inList(userIds)})`, org).catch(
        () => [] as Row[]
      )
    : [];
  return { surveys: buildList({ invitations, surveys, versions, responses, users }), notes };
}

const flowCache = new Map<string, Record<string, Flow>>();

async function surveyFlows(org: string, cacheRecordId: string): Promise<Record<string, Flow>> {
  const hit = flowCache.get(cacheRecordId);
  if (hit) return hit;
  const { files } = await cacheContents(cacheRecordId, org);
  const path = files.find((f) => /(^|\/)metadata\/flows\.json$/.test(f.path))?.path;
  if (!path) throw new Error("This metadata cache has no flows file.");
  const file = await cacheFile(cacheRecordId, path, org);
  if (file.truncated) throw new Error("The flows file in this cache is too large to read here.");
  const all = JSON.parse(file.text) as Record<string, Flow>;
  const surveys: Record<string, Flow> = {};
  for (const [k, v] of Object.entries(all)) if (v?.processType === "Survey") surveys[k] = v;
  if (flowCache.size >= 3) flowCache.delete(flowCache.keys().next().value as string);
  flowCache.set(cacheRecordId, surveys);
  return surveys;
}

/** One survey's questions, from the flow in the profile's published metadata cache (SurveyViewModel). */
export async function loadSurveyForm(
  org: string,
  cacheRecordId: string,
  developerName: string,
  version: number | null
): Promise<SurveyForm> {
  const flow = findFlow(await surveyFlows(org, cacheRecordId), developerName, version);
  if (!flow) throw new Error("This survey isn't in the published metadata cache.");
  return parseFlow(flow);
}
