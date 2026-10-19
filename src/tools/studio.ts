import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { refreshSharedReads, withSharedReads } from "../config/read-cache.js";
import { z } from "zod";
import { validateOrgConnection } from "../salesforce/auth.js";
import { getFeature, listFeatures } from "../studio/features.js";
import { collectFeatureMap, collectItemDetail, collectProfileOptions } from "../studio/collect.js";
import { findProfileApp, readLiveApp } from "../studio/metadata/live-app.js";
import { flexiPageReach, readLiveCompactLayout, readLiveFlexiPage, readLiveLayout, readLiveListView } from "../studio/metadata/live.js";
import { resolveSetupLinks, type SetupRef } from "../studio/setup-links.js";
import { collectCatalog } from "../studio/component-catalog.js";
import { collectComponentProps } from "../studio/component-props.js";
import { accessOptions, userAccess } from "../studio/access.js";
import { collectReadiness } from "../studio/readiness/index.js";
import { collectSetupOverview } from "../studio/overview.js";
import { traceUser } from "../studio/user-trace.js";
import { drift } from "../studio/drift.js";
import { applyFix, previewFix } from "../studio/fixes.js";
import { publishStatus, startPublish } from "../studio/publish.js";
import { loadIpadReports, loadPublishedIpad, searchProfileUsers } from "../studio/published.js";
import { runReport } from "../studio/screens/report-data.js";
import { loadProgress } from "../studio/published-progress.js";
import { mapProgress, mapKey, readinessKey } from "../studio/map-progress.js";
import { collectUnpublished } from "../studio/unpublished.js";
import { cacheContents, cacheFile, cacheLog, collectMetadataCache } from "../studio/metadata-cache.js";
import { fixProgress, startFixChange } from "../studio/fix-progress.js";
import { compileInlineLwc } from "../studio/lwc/compile.js";
import { lwcRequest } from "../studio/lwc/request.js";
import type { StudioFix } from "../studio/types.js";
import { collectScriptDetail, collectScriptLibrary } from "../studio/scripts/library.js";
import {
  activePerfRun,
  cancelPerfRun,
  checkPerfPlan,
  perfRunStatus,
  perfTerritories,
  searchPerfUsers,
  startPerfRun,
} from "../studio/perf.js";
import { nfrProfileSchema, parseNfrProfile } from "../perf/nfr.js";
import { renderAssessment, type AssessmentResult } from "../perf/assessment.js";
import { activeSimulation, cancelSimulation, simulationStatus, startSimulation } from "../studio/simulate.js";
import { renderSimulation } from "./perf-simulate.js";
import { MAX_SIM_RUNS, renderRunsSection, type SimRunsSummary } from "../studio/sim-runs.js";
import type { SimulationResult } from "../perf/simulate.js";
import { syncOverview, syncOverviewInput } from "../studio/sync-overview.js";
import { syncUserDetail, syncUserInput, syncUserProgress } from "../studio/sync-user.js";
import { syncImpact, syncImpactInput } from "../studio/sync-impact.js";
import { renderSignoffReport, signoffReportInput } from "../studio/signoff-report.js";
import { exportSource, SOURCE_TYPES } from "../studio/source-export.js";
import { checkApp } from "../studio/apps/check.js";
import { describeForApp, MAX_DESCRIBE_OBJECTS } from "../studio/apps/describe.js";
import { sampleRecords } from "../studio/apps/sample.js";
import type { RunAs } from "../studio/apps/run-as.js";
import { appSource, listOrgApps } from "../studio/apps/org-apps.js";
import { listStarters, starterSource } from "../studio/apps/starters.js";
import { deployApp } from "../studio/apps/deploy.js";
import { planDeploy } from "../studio/apps/plan.js";
import { tabOptions } from "../studio/apps/tab-options.js";
import { APP_BUILDER_GUIDE } from "../studio/apps/guide.js";
import { MAX_FILES, MAX_FILE_BYTES } from "../studio/apps/lint.js";
// --- custom scripts: runner ---
import { createOrgReader, listScriptTestRecords, runScriptTest } from "../studio/scripts/runner/index.js";

/**
 * LSC Studio data tools. These return raw JSON for the Electron app's visual
 * Studio mode (the app hides `studio_*` tools from the chat model). The map and
 * detail tools are read-only and safe for any MCP client to call.
 *
 * The fix and publish tools write to the org, so they're only registered when
 * the Electron app starts the server (`LSC_STUDIO_FIXES=1`) — there, a change
 * is applied only from a user's click on a previewed change, never by the model.
 */

const id = z.string().regex(/^[a-zA-Z0-9]{15,18}$/);
// --- custom scripts: server ---
const scriptTypeSchema = z.enum(["Validation", "Checklist", "VisitActionValidation"]);
const scriptEventSchema = z.enum(["OnCreate", "OnUpdate", "OnDelete"]);
const scriptRoleSchema = z.enum(["validation", "checklist"]);
/** An LWC folder name: lower-case start, letters/digits/underscores, no double or trailing underscore. */
const lwcNameSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9_]{0,79}$/)
  .refine((n) => !n.includes("__") && !n.endsWith("_"), "No double or trailing underscore");
const scriptFieldsSchema = z.object({
  name: z.string().min(1).max(80),
  componentName: lwcNameSchema,
  type: scriptTypeSchema,
  objectName: z.string().max(80).nullable(),
  operationEventType: scriptEventSchema.nullable(),
});
// --- end custom scripts: server ---

const accessSchema = z.object({
  type: z.enum(["permissionSet", "permissionSetGroup", "territory"]),
  id,
  label: z.string(),
});
const sectionRef = z.object({ label: z.string(), nth: z.number().int().min(0) });
const fieldSlot = z.object({
  section: sectionRef,
  column: z.number().int().min(0),
  before: z.string().nullable(),
  at: z.number().int().min(0).optional(),
});
const behavior = z.enum(["Edit", "Required", "Readonly"]);
const layoutOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("moveField"), field: z.string(), to: fieldSlot }),
  z.object({ op: z.literal("removeField"), field: z.string() }),
  z.object({ op: z.literal("addField"), field: z.string(), behavior, to: fieldSlot, xml: z.string().optional(), relatedObject: z.boolean().optional() }),
  z.object({ op: z.literal("setFieldBehavior"), field: z.string(), from: behavior, to: behavior }),
  z.object({ op: z.literal("moveSection"), section: sectionRef, before: sectionRef.nullable() }),
  z.object({ op: z.literal("removeSection"), section: sectionRef }),
  z.object({ op: z.literal("addSection"), xml: z.string(), before: sectionRef.nullable() }),
  z.object({ op: z.literal("setSectionHeading"), section: sectionRef, from: z.boolean(), to: z.boolean() }),
  z.object({ op: z.literal("moveRelatedList"), relatedList: z.string(), before: z.string().nullable() }),
  z.object({ op: z.literal("removeRelatedList"), relatedList: z.string() }),
  z.object({ op: z.literal("addAction"), action: z.string().max(255), before: z.string().max(255).nullable(), actionType: z.string().max(60).optional() }),
  z.object({ op: z.literal("removeAction"), action: z.string().max(255), dropList: z.boolean().optional() }),
  z.object({
    op: z.literal("addRelatedList"),
    relatedList: z.string(),
    before: z.string().nullable(),
    xml: z.string().optional(),
    object: z.string().optional(),
    nameField: z.string().optional(),
  }),
]);
const flexiItemRef = z.object({ component: z.string().max(255), identifier: z.string().max(255).nullable(), index: z.number().int().min(0) });
const flexiComponentRef = z.object({ region: z.string().max(255), item: flexiItemRef });
const flexiPageOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("moveComponent"), component: flexiComponentRef, before: flexiItemRef.nullable() }),
  z.object({ op: z.literal("removeComponent"), component: flexiComponentRef }),
  z.object({
    op: z.literal("addComponent"),
    region: z.string().max(255),
    before: flexiItemRef.nullable(),
    component: z.string().max(255),
    identifier: z.string().max(255).nullable(),
    properties: z.array(z.object({ name: z.string().max(255), value: z.string().max(4000) })).max(50).optional(),
    xml: z.string().max(1_000_000).optional(),
    facets: z.array(z.object({ xml: z.string().max(1_000_000), at: z.number().int().min(0) })).max(100).optional(),
  }),
  z.object({
    op: z.literal("setComponentProperty"),
    component: flexiComponentRef,
    property: z.string().regex(/^\w+$/).max(80),
    from: z.string().max(1000).nullable(),
    to: z.string().max(1000).nullable(),
  }),
]);
const flexiPageName = z.string().regex(/^\w+$/).max(255);

const appName = z.string().regex(/^[\w]+$/).max(255);
const appOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("moveAppTab"), tab: z.string().max(255), before: z.string().max(255).nullable() }),
  z.object({ op: z.literal("removeAppTab"), tab: z.string().max(255) }),
  z.object({ op: z.literal("addAppTab"), tab: z.string().max(255), before: z.string().max(255).nullable() }),
]);

const compactOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("moveCompactField"), field: z.string(), before: z.string().nullable() }),
  z.object({ op: z.literal("removeCompactField"), field: z.string() }),
  z.object({ op: z.literal("addCompactField"), field: z.string(), before: z.string().nullable() }),
]);
const listViewFilterSchema = z.object({ field: z.string().max(255), operation: z.string().max(40), value: z.string().max(1000) });
const listViewOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("moveListColumn"), column: z.string(), before: z.string().nullable() }),
  z.object({ op: z.literal("removeListColumn"), column: z.string() }),
  z.object({ op: z.literal("addListColumn"), column: z.string(), before: z.string().nullable() }),
  z.object({ op: z.literal("setListFilterScope"), from: z.string().nullable(), to: z.string() }),
  z.object({
    op: z.literal("setListFilters"),
    from: z.array(listViewFilterSchema).max(50),
    to: z.array(listViewFilterSchema).max(50),
    fromLogic: z.string().max(255).nullable(),
    toLogic: z.string().max(255).nullable(),
  }),
]);
const layoutName = z.string().regex(/^[^\r\n:]+-[^\r\n]+$/).max(255);
const compactLayoutName = z.string().regex(/^\w+\.\w+$/).max(255);
const listViewName = compactLayoutName;

const fixSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assignPsl"), label: z.string(), userId: id, userName: z.string(), pslId: id, pslLabel: z.string() }),
  z.object({
    kind: z.literal("removePsl"),
    label: z.string(),
    assignmentId: id,
    userId: id,
    userName: z.string(),
    pslId: id,
    pslLabel: z.string(),
  }),
  z.object({
    kind: z.literal("setConfigField"),
    label: z.string(),
    category: z.string(),
    developerName: z.string(),
    recordLabel: z.string(),
    field: z.string(),
    from: z.union([z.string(), z.number(), z.null()]),
    to: z.union([z.string(), z.number(), z.null()]),
  }),
  z.object({
    kind: z.literal("setActive"),
    label: z.string(),
    record: z.discriminatedUnion("type", [
      z.object({ type: z.literal("config"), category: z.string(), developerName: z.string(), label: z.string() }),
      z.object({ type: z.literal("triggerHandler"), developerName: z.string(), label: z.string() }),
      z.object({ type: z.literal("validationRule"), id, label: z.string() }),
    ]),
    from: z.boolean(),
    to: z.boolean(),
  }),
  z.object({
    kind: z.literal("setProfileAssignments"),
    label: z.string(),
    category: z.string(),
    developerName: z.string(),
    recordLabel: z.string(),
    from: z.array(z.string()),
    to: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("createConfigRecord"),
    label: z.string(),
    category: z.string(),
    developerName: z.string(),
    recordLabel: z.string(),
    copyFrom: z.string().optional(),
    fields: z.array(
      z.object({
        name: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        dataType: z.string().optional(),
      })
    ),
    profiles: z.array(z.string()),
    permissionSets: z.array(z.string()).optional(),
    active: z.boolean(),
  }),
  z.object({
    kind: z.literal("deleteConfigRecord"),
    label: z.string(),
    category: z.string(),
    developerName: z.string(),
    recordLabel: z.string(),
  }),
  z.object({ kind: z.literal("assignAccess"), label: z.string(), userId: id, userName: z.string(), access: accessSchema }),
  z.object({
    kind: z.literal("removeAccess"),
    label: z.string(),
    userId: id,
    userName: z.string(),
    access: accessSchema,
    assignmentId: id,
  }),
  // --- custom scripts: server ---
  z.object({
    kind: z.literal("createCustomScript"),
    label: z.string(),
    name: z.string().min(1).max(80),
    componentName: lwcNameSchema,
    type: scriptTypeSchema,
    objectName: z.string().max(80).nullable(),
    operationEventType: scriptEventSchema.nullable(),
    code: z.string().max(131072),
    assign: z.array(z.object({ stageObjectId: id, role: scriptRoleSchema })).max(20).optional(),
    adoptBundle: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("saveCustomScript"),
    label: z.string(),
    scriptId: id,
    scriptName: z.string(),
    from: z.object({ code: z.string().max(131072), fields: scriptFieldsSchema }),
    to: z.object({ code: z.string().max(131072).optional(), fields: scriptFieldsSchema.partial().optional() }),
  }),
  z.object({ kind: z.literal("deleteCustomScript"), label: z.string(), scriptId: id, scriptName: z.string(), deleteBundle: z.boolean() }),
  z.object({
    kind: z.literal("assignCustomScript"),
    label: z.string(),
    stageObjectId: id,
    stageObjectName: z.string(),
    role: scriptRoleSchema,
    from: id.nullable(),
    to: id.nullable(),
  }),
  // --- end custom scripts: server ---
  z.object({
    kind: z.literal("setCustomScriptCode"),
    label: z.string(),
    scriptId: id,
    scriptName: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    kind: z.literal("setLayoutRelatedList"),
    label: z.string(),
    layoutName: z.string(),
    layoutLabel: z.string(),
    objectName: z.string(),
    relationshipName: z.string(),
    add: z.boolean(),
  }),
  z.object({
    kind: z.literal("editMetadata"),
    label: z.string(),
    // Ops are checked against the document's type when the edit is previewed.
    doc: z.discriminatedUnion("type", [
      z.object({ type: z.literal("Layout"), fullName: layoutName, label: z.string() }),
      z.object({ type: z.literal("CompactLayout"), fullName: compactLayoutName, label: z.string() }),
      z.object({ type: z.literal("FlexiPage"), fullName: flexiPageName, label: z.string() }),
      z.object({ type: z.literal("ListView"), fullName: listViewName, label: z.string() }),
      z.object({ type: z.literal("CustomApplication"), fullName: appName, label: z.string() }),
    ]),
    ops: z.array(z.union([layoutOpSchema, compactOpSchema, flexiPageOpSchema, listViewOpSchema, appOpSchema])).max(200),
  }),
  z.object({
    kind: z.literal("copyForProfile"),
    label: z.string(),
    doc: z.discriminatedUnion("type", [
      z.object({ type: z.literal("Layout"), fullName: layoutName, label: z.string() }),
      z.object({ type: z.literal("FlexiPage"), fullName: flexiPageName, label: z.string() }),
    ]),
    copy: z.object({ fullName: z.string().regex(/^[^\r\n:\\/]+$/).max(255), label: z.string().max(255) }),
    profile: z.string().max(255),
    ops: z.array(z.union([layoutOpSchema, flexiPageOpSchema])).max(200).optional(),
    revert: z
      .object({
        moves: z
          .array(z.object({ recordType: z.string().nullable().optional(), app: z.string().optional(), added: z.boolean().optional() }))
          .max(200),
      })
      .optional(),
  }),
]);

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function jsonError(error: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error }) }], isError: true };
}

export function register(server: McpServer) {
  server.tool(
    "studio_list_features",
    "LSC Studio (GUI data): list the features Studio can map. Returns JSON.",
    {},
    async () => json(listFeatures())
  );

  server.tool(
    "studio_feature_map",
    "LSC Studio (GUI data): collect every configuration surface for one LSC feature (objects, record types, layouts, custom scripts, validation rules, Apex triggers, flows, trigger handlers, DB Schema, actions, Admin Console settings, compliance) with health findings. Read-only. Returns JSON.",
    {
      featureId: z.string().describe("Feature id from studio_list_features, e.g. 'visit'"),
      refresh: z.boolean().optional().describe("Read the org again instead of reusing reads shared in the last minute"),
    },
    async ({ featureId, refresh }) => {
      const feature = getFeature(featureId);
      if (!feature) return jsonError(`Unknown feature: ${featureId}`);
      if (!feature.available) return jsonError(`${feature.title} isn't available in Studio yet.`);

      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      const org = connection.targetOrg;
      if (refresh) refreshSharedReads(org);
      return json(await withSharedReads(() => collectFeatureMap(feature, org)));
    }
  );

  server.tool(
    "studio_feature_map_progress",
    "LSC Studio (GUI data): which surface a running studio_feature_map (or, with `readiness`, studio_readiness) load for a feature is on — steps waiting / running / done / failed, with start and finish times and counts like \"12 layouts\" — or null when none has run. Read-only; makes no org calls. Returns JSON.",
    { featureId: z.string().min(1).max(80), readiness: z.boolean().optional() },
    async ({ featureId, readiness }) => json({ progress: mapProgress(readiness ? readinessKey(featureId) : mapKey(featureId)), now: Date.now() })
  );

  server.tool(
    "studio_readiness",
    "LSC Studio (GUI data): is one LSC feature ready for the field? Runs the feature's validation rules and Studio's checks (switched on, access, data, settings, iPad), each pass/fail/unknown with how to fix it. Read-only. Returns JSON.",
    {
      featureId: z.string().describe("Feature id from studio_list_features, e.g. 'visit'"),
      refresh: z.boolean().optional().describe("Read the org again instead of reusing reads shared in the last minute"),
    },
    async ({ featureId, refresh }) => {
      const feature = getFeature(featureId);
      if (!feature) return jsonError(`Unknown feature: ${featureId}`);
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      const org = connection.targetOrg;
      if (refresh) refreshSharedReads(org);
      return json(await withSharedReads(() => collectReadiness(feature, org)));
    }
  );

  server.tool(
    "studio_setup_overview",
    "LSC Studio (GUI data): org-wide setup signals no single feature owns — license capacity, metadata cache freshness, changes not yet published to the iPad, territory model. Read-only. Returns JSON.",
    { refresh: z.boolean().optional().describe("Read the org again instead of reusing reads shared in the last minute"), },
    async ({ refresh }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        const org = connection.targetOrg;
        if (refresh) refreshSharedReads(org);
        return json(await withSharedReads(() => collectSetupOverview(org)));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_user_trace",
    "LSC Studio (GUI data): check one user's setup end to end — licenses, permission sets, territory, what syncs to their iPad, metadata cache, last sync — optionally for one feature, and point at the first broken link. Read-only. Returns JSON.",
    {
      userId: id,
      featureId: z.string().optional().describe("Feature id to narrow the check to, e.g. 'samples'"),
      refresh: z.boolean().optional().describe("Read the org again instead of reusing reads shared in the last minute"),
    },
    async ({ userId, featureId, refresh }) => {
      if (featureId && !getFeature(featureId)) return jsonError(`Unknown feature: ${featureId}`);
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        const org = connection.targetOrg;
        if (refresh) refreshSharedReads(org);
        return json(await withSharedReads(() => traceUser(userId, featureId ?? null, org)));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_drift",
    "LSC Studio (GUI data): configuration snapshots for \"What changed\" — list saved snapshots, save one of the org now, diff the org now against one, or delete one. Reads the org; writes only local snapshot files. Returns JSON.",
    {
      action: z.enum(["list", "save", "diff", "delete"]),
      id: z.string().optional().describe("Snapshot id, for diff and delete"),
      label: z.string().optional().describe("Label for a new snapshot"),
      days: z.number().int().min(1).max(365).optional().describe("For list: how many days of recent changes (default 14)"),
      refresh: z.boolean().optional().describe("Read the org again instead of reusing reads shared in the last minute"),
    },
    async ({ action, id: snapshotId, label, days, refresh }) => {
      if ((action === "diff" || action === "delete") && !snapshotId) return jsonError(`${action} needs a snapshot id`);
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      const input =
        action === "list" ? { action, days } : action === "save" ? { action, label } : { action, id: snapshotId! };
      try {
        const org = connection.targetOrg;
        if (refresh) refreshSharedReads(org);
        // Only the list reads recent changes where a minute-old answer is fine; save and diff see the org as it is.
        return json(await (input.action === "list" ? withSharedReads(() => drift(input, org)) : drift(input, org)));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_item_detail",
    "LSC Studio (GUI data): fetch detail (validation rule formula, Apex trigger body, custom script code, Visit layout sidebar, flow outline and health checks) for one item. Read-only. Returns JSON.",
    {
      kind: z.enum(["customScript", "validationRule", "apexTrigger", "layout", "flow"]),
      id: z.string().describe("Salesforce record Id (for flows, the FlowDefinitionView DurableId)"),
    },
    async ({ kind, id }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        const org = connection.targetOrg;
        return json(await withSharedReads(() => collectItemDetail(kind, id, org)));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_metadata_doc",
    "LSC Studio (GUI data): a page layout, compact layout, Lightning page or list view as it is in the org now — a layout's sections, fields, related lists and the profiles using it; a compact layout's fields, the fields it could take and the record types using it; a Lightning page's regions, facets and components, the profiles and apps it's assigned in and whether it's managed; a list view's columns, filters, filter scope, who it's shared with and the object's fields; a Lightning app's tab bar (the tabs that can be arranged, the package's fixed ones, the tabs it could take and the profiles that open it) — and whether the org is production, for editing it in the iPad preview. Read-only. Returns JSON.",
    { type: z.enum(["Layout", "CompactLayout", "FlexiPage", "ListView", "CustomApplication"]), fullName: z.string().max(255) },
    async ({ type, fullName }) => {
      const name = (type === "Layout" ? layoutName : type === "CompactLayout" ? compactLayoutName : type === "ListView" ? listViewName : type === "CustomApplication" ? appName : flexiPageName).safeParse(fullName);
      if (!name.success) return jsonError(`Invalid ${type} name: ${fullName}`);
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        const org = connection.targetOrg;
        return json(
          type === "Layout"
            ? await readLiveLayout(fullName, org)
            : type === "CompactLayout"
              ? await readLiveCompactLayout(fullName, org)
              : type === "ListView"
                ? await readLiveListView(fullName, org)
                : type === "CustomApplication"
                  ? await readLiveApp(fullName, org)
                  : await readLiveFlexiPage(fullName, org)
        );
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_nav",
    "LSC Studio (GUI data): which Lightning app a profile's published iPad tab bar comes from, found by lining the tabs the profile's last publish knew of up with the tabs of the apps the profile can open. Returns JSON: `{ app: { fullName, label, installed } }`, or `{ app: null, reason }` when it can't be told (nothing fits, or two fit equally). Read-only.",
    { profile: z.string().max(255), tabs: z.array(z.string().max(255)).max(500) },
    async ({ profile, tabs }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await findProfileApp(profile, tabs, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_page_reach",
    "LSC Studio (GUI data): the profiles a Lightning page is assigned to and the apps it's the default page of, for when `studio_metadata_doc` answered before that was worked out (`reachPending`). Read-only. Returns JSON (null fields when it couldn't be read).",
    { fullName: z.string().max(255) },
    async ({ fullName }) => {
      if (!flexiPageName.safeParse(fullName).success) return jsonError(`Invalid FlexiPage name: ${fullName}`);
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      const reach = await flexiPageReach(fullName, connection.targetOrg);
      return json({ profiles: reach?.profiles ?? null, appDefaults: reach?.appDefaults ?? null });
    }
  );

  server.tool(
    "studio_component_catalog",
    "LSC Studio (GUI data): the components \"Insert component…\" offers for a Home or record Lightning page in the iPad preview — Recent items, the org's inline LWCs, related lists of synced child objects, and greyed-out ones that need Lightning App Builder. Read-only. Returns JSON.",
    { pageType: z.enum(["HomePage", "RecordPage"]), sobject: z.string().regex(/^\w+$/).max(80).nullable().optional() },
    async ({ pageType, sobject }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await collectCatalog(pageType, sobject ?? null, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_component_props",
    "LSC Studio (GUI data): the properties of a Home or record Lightning page component for the iPad preview's properties sheet — a custom LWC's from its js-meta.xml targetConfigs, standard and LSC components from a curated table — each with type, range, options, default and whether the iPad reads it. Read-only. Returns JSON.",
    { component: z.string().regex(/^\w+(:\w+)?$/).max(160), pageType: z.enum(["HomePage", "RecordPage"]).optional() },
    async ({ component, pageType }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await collectComponentProps(component, pageType, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_list_profiles",
    "LSC Studio (GUI data): list profiles with active users, for Studio's \"View as\" lens. Read-only. Returns JSON.",
    {},
    async () => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await collectProfileOptions(connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_setup_links",
    "LSC Studio (GUI data): the deepest Salesforce Setup page for each reference (page layout, field, compact layout, Lightning page, list view, record type, validation rule, Apex trigger, flow, user, profile, permission set, territory, record), as org-relative paths for `sf org open --path`; `exact` is false when the item's Id couldn't be found and the path is its list page. Read-only, cached per org. Returns JSON.",
    {
      refs: z
        .array(
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("layout"), object: z.string().max(80), name: z.string().max(255) }),
            z.object({ type: z.literal("field"), object: z.string().max(80), field: z.string().max(80) }),
            z.object({ type: z.literal("compactLayout"), object: z.string().max(80), name: z.string().max(255) }),
            z.object({ type: z.literal("flexiPage"), name: z.string().max(255) }),
            z.object({ type: z.literal("listView"), object: z.string().max(80), name: z.string().max(255) }),
            z.object({ type: z.literal("recordType"), object: z.string().max(80), name: z.string().max(255) }),
            z.object({ type: z.literal("validationRule"), object: z.string().max(80), id: z.string().max(18) }),
            z.object({ type: z.literal("apexTrigger"), id: z.string().max(18) }),
            z.object({ type: z.literal("flow"), id: z.string().max(18) }),
            z.object({ type: z.literal("user"), id: z.string().max(18) }),
            z.object({ type: z.literal("profile"), id: z.string().max(18) }),
            z.object({ type: z.literal("permissionSet"), id: z.string().max(18) }),
            z.object({ type: z.literal("territory"), id: z.string().max(18) }),
            z.object({ type: z.literal("record"), sobject: z.string().max(80), id: z.string().max(18) }),
          ])
        )
        .max(10),
    },
    async ({ refs }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json({ links: await resolveSetupLinks(refs as SetupRef[], connection.targetOrg) });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_user_access",
    "LSC Studio (GUI data): a user's permission set licenses, permission sets, permission set groups, and territories. Read-only. Returns JSON.",
    { userId: id },
    async ({ userId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        const org = connection.targetOrg;
        return json(await withSharedReads(() => userAccess(userId, org)));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_ipad_published",
    "LSC Studio (GUI data): what the iPad actually renders for one user of a profile — tabs, Home page components, record layouts, and list views — read from the profile's published mobile metadata cache with the user's permission sets merged in (the profile's most typical user unless userId is given). Read-only. Returns JSON.",
    {
      profile: z.string().min(1).max(255),
      userId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/).optional(),
      mobileLogins: z
        .array(
          z.object({
            instanceUrl: z.string().url().max(255),
            accessToken: z.string().min(1).max(4096),
            username: z.string().min(1).max(255),
            orgId: z.string().max(18).optional(),
            userId: z.string().max(18).optional(),
          })
        )
        .max(25)
        .optional()
        .describe(
          "Logins Studio made through the LSC mobile app's connected app. When one belongs to the previewed rep, the live screens and records are read with it (their own sharing and field-level security, rows limited to their sync filter); otherwise the sf CLI connection reads and approximates. Tokens are used for this load only and never returned."
        ),
    },
    async ({ profile, userId, mobileLogins }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await loadPublishedIpad(profile, connection.targetOrg, userId, mobileLogins ?? []));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_unpublished",
    "LSC Studio (GUI data): what changed in the org after a profile's live metadata cache was generated, so the iPad preview can say what iPads don't have yet. Layouts, compact layouts, Lightning pages, record types, tabs and Admin Console records (DB Schema, tabs, actions, settings) that reach the profile, each with who changed it and when; list views are marked live (the iPad reads them from the org). `known` limits document changes to the ones the profile's snapshot references. Kinds that couldn't be read come back in `errors`, never as \"no changes\". Read-only. Returns JSON.",
    {
      profile: z.string().min(1).max(255),
      known: z
        .object({
          layouts: z.array(z.string().max(255)).max(5000).optional(),
          compactLayouts: z.array(z.string().max(255)).max(5000).optional(),
          flexiPages: z.array(z.string().max(255)).max(5000).optional(),
          recordTypes: z.array(z.string().max(255)).max(5000).optional(),
          listViews: z.array(z.string().max(255)).max(5000).optional(),
          tabs: z.array(z.string().max(255)).max(5000).optional(),
        })
        .optional(),
    },
    async ({ profile, known }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await collectUnpublished(profile, connection.targetOrg, known));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_metadata_cache",
    "LSC Studio (GUI data): the Metadata cache page — every LSC profile's metadata cache (what its iPads download now, size, a newer failed or running attempt, how many Admin Console changes it is behind) and the newest generation jobs with each profile's record and the start of its ErrorLog. Read-only. Returns JSON.",
    {},
    async () => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await collectMetadataCache(connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_metadata_cache_log",
    "LSC Studio (GUI data): the full ErrorLog of one metadata cache record and, for a generation job, of each profile's record. Read-only. Returns JSON.",
    { recordId: id },
    async ({ recordId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await cacheLog(recordId, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_metadata_cache_contents",
    "LSC Studio (GUI data): the files inside one metadata cache record's ZIP (path, size, compressed size), downloading it to a temporary folder that keeps the last few. Read-only. Returns JSON.",
    { recordId: id },
    async ({ recordId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await cacheContents(recordId, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_metadata_cache_file",
    "LSC Studio (GUI data): one file from a metadata cache record's ZIP — text (files over 24 MB cut to their first 1 MB, marked truncated), an image as a data URL, or marked binary. Read-only. Returns JSON.",
    { recordId: id, path: z.string().min(1).max(1024) },
    async ({ recordId, path }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await cacheFile(recordId, path, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // --- custom scripts: server ---
  server.tool(
    "studio_custom_scripts",
    "LSC Studio (GUI data): the custom script library — every script with its type, object, status (will it run), LWC bundle, stage object assignments and static-check counts, plus the org's stage objects. Read-only. Returns JSON.",
    {},
    async () => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await collectScriptLibrary(connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_custom_script",
    "LSC Studio (GUI data): one custom script as the org holds it now — CodeText, the LWC bundle's code and other files, and whether they have drifted apart. Never cached. Read-only. Returns JSON.",
    { id },
    async ({ id: scriptId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await collectScriptDetail(scriptId, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );
  // --- end custom scripts: server ---

  server.tool(
    "studio_ipad_published_users",
    "LSC Studio (GUI data): active users of a profile whose name contains `search`, for the iPad preview's user picker when the profile has more users than it lists. Read-only. Returns JSON { users }.",
    { profile: z.string().min(1).max(255), search: z.string().min(1).max(80) },
    async ({ profile, search }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json({ users: await searchProfileUsers(profile, search, connection.targetOrg) });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_ipad_published_progress",
    "LSC Studio (GUI data): which step a running studio_ipad_published load for a profile is on (steps waiting / running / done / failed, with start and finish times), or null when none has run. Read-only; makes no org calls. Returns JSON.",
    { profile: z.string().min(1).max(255) },
    async ({ profile }) => json({ progress: loadProgress(profile) })
  );

  server.tool(
    "studio_ipad_reports",
    "LSC Studio (GUI data): the Reports tab of the published iPad for one user — the tab's custom settings and, with ShowSalesforceReports, the folder and report tree the user can read (no report results). Read when the Reports tab is first opened rather than with studio_ipad_published. Read-only. Returns JSON { settings, reports?, dataNotes? }.",
    { userId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/) },
    async ({ userId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await loadIpadReports(userId, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_report_data",
    "LSC Studio (GUI data): one report's result for the iPad preview's View Report sheet, run read-only as the connected account (Summary and Tabular only; first 150 rows), reused for six hours from memory. Read-only. Returns JSON { id, data } — data is null when the report couldn't be run here. `userId` is the previewed rep; it doesn't change the run.",
    { reportId: z.string().regex(/^00O[A-Za-z0-9]{12,15}$/), userId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/).optional() },
    async ({ reportId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        const data = await runReport(reportId, connection.targetOrg);
        return json({ id: reportId, data: data ?? null });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_lwc_bundle",
    "LSC Studio (GUI data): one inline LWC (lscMobileInline_*) and the c/ components it uses, compiled with lightning-base-components and Studio's stand-ins for LDS and other platform modules into a script for the iPad preview's live frame, plus its offline check. Read-only. Returns JSON.",
    { name: z.string().regex(/^\w{1,80}$/) },
    async ({ name }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await compileInlineLwc(connection.targetOrg, name));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_lwc_request",
    "LSC Studio (GUI data): answers a request from a live-previewed inline LWC — UI API GETs and GraphQL queries only, as the connected user or, with mobileLogin, as the previewed rep; writes are refused. Returns JSON.",
    {
      method: z.enum(["GET", "POST"]),
      path: z.string().min(1).max(8000),
      body: z.unknown().optional(),
      mobileLogin: z
        .object({
          instanceUrl: z.string().url().max(255),
          accessToken: z.string().min(1).max(4096),
          username: z.string().min(1).max(255),
          orgId: z.string().max(18).optional(),
        })
        .optional()
        .describe("The previewed rep's login, made by Studio through the LSC mobile app's connected app; answered as them instead of the sf CLI connection"),
    },
    async ({ method, path, body, mobileLogin }) => {
      const connection = await validateOrgConnection();
      if (!mobileLogin && (!connection.valid || !connection.targetOrg)) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await lwcRequest(mobileLogin ?? connection.targetOrg!, { method, path, body }));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_access_options",
    "LSC Studio (GUI data): permission sets, permission set groups, and territories that can be given to a user (at most 2,000 of each; `truncated` gives totals — pass `search` to find others by name). Read-only. Returns JSON.",
    { search: z.string().max(80).optional() },
    async ({ search }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await accessOptions(connection.targetOrg, search));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // --- custom scripts: runner ---
  server.tool(
    "studio_script_test_records",
    "LSC Studio (GUI data): recent records a custom script can be tested against (Visit Action Validation: ProviderVisit records with account, date, status and child counts; other types: records of `objectName`). Read-only. Returns JSON.",
    {
      type: z.enum(["Validation", "Checklist", "VisitActionValidation"]),
      objectName: z.string().max(255).nullable().optional(),
      search: z.string().max(100).optional(),
    },
    async ({ type, objectName, search }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await listScriptTestRecords({ type, objectName, search }, createOrgReader(connection.targetOrg)));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_script_test",
    "LSC Studio (GUI data): run a custom script in a sandbox against a real record, as the connected admin (a simulation, not the rep). Reads the org with read-only SOQL; setValue/save are recorded, never written. Returns JSON.",
    {
      code: z.string().max(200_000),
      type: z.enum(["Validation", "Checklist", "VisitActionValidation"]),
      recordId: z.string().max(18).optional(),
      objectName: z.string().max(255).nullable().optional(),
      operationEventType: z.string().max(50).nullable().optional(),
      platform: z.enum(["web", "ipad"]),
      env: z
        .object({
          actionName: z.string().max(255).optional(),
          fromStatus: z.string().max(255).optional(),
          toStatus: z.string().max(255).optional(),
          fieldName: z.string().max(255).optional(),
        })
        .optional(),
      userId: z.string().max(18).optional(),
    },
    async (request) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await runScriptTest(request, createOrgReader(connection.targetOrg)));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  registerPerfTools(server);
  registerSyncHealthTools(server);
  registerAppTools(server);
  if (process.env.LSC_STUDIO_FIXES === "1") registerFixTools(server);
}

const appFileSchema = z.object({
  bundle: z.string().regex(/^\w{1,80}$/),
  path: z.string().max(200),
  source: z.string().max(MAX_FILE_BYTES),
});
const runAsLogin = z
  .object({
    instanceUrl: z.string().url().max(255),
    accessToken: z.string().min(1).max(4096),
    username: z.string().min(1).max(255),
    orgId: z.string().max(18).optional(),
    userId: z.string().max(18).optional(),
  })
  .optional()
  .describe("A test user's login, made by Studio through the LSC mobile app's connected app; the read is answered as them (their sharing and field access), never as the sf CLI admin. The token is used for this call only and never returned");

const appInputShape = {
  name: z.string().regex(/^\w{1,80}$/),
  target: z.enum(["home", "record", "action", "tab"]),
  objectApiName: z.string().regex(/^\w{1,80}$/).optional(),
  files: z.array(appFileSchema).max(MAX_FILES),
  tab: z
    .object({
      label: z.string().max(80).optional(),
      application: z.string().regex(/^\w{1,80}$/).optional(),
      profiles: z.array(z.string().regex(/^[^/\\]{1,120}$/)).max(50).optional(),
    })
    .optional()
    .describe("tab target only: label, the CustomApplication that gets the tab, and the profiles that see it"),
};

/** The LSC App builder's tools (Studio → Build → LSC apps). Read-only; the deploy is in registerFixTools. */
function registerAppTools(server: McpServer) {
  server.tool(
    "studio_app_guide",
    "LSC Studio (GUI only): the LSC App builder's system prompt — the rules, offline data patterns, design guidance and workflow it follows. Read-only; no org needed. Returns JSON { guide }.",
    {},
    async () => json({ guide: APP_BUILDER_GUIDE })
  );

  server.tool(
    "studio_app_check",
    "LSC Studio (GUI only): check an LSC App's files — lint (meta file, targets, mobileHeight, naming), a real compile, the offline scan, and (when an org is connected) whether DB Schema syncs the objects it reads. Needs no org to compile. Read-only. Returns JSON { ok, issues, offline, script?, placeholders, mobileHeight?, objects? }.",
    {
      ...appInputShape,
      userId: z.string().regex(/^005\w{12}(\w{3})?$/).optional().describe("Judge \"synced\" for this user's profile and permission sets"),
      profile: z.string().regex(/^[^/\\]{1,120}$/).optional().describe("Judge \"synced\" for this profile (when no userId)"),
    },
    async ({ userId, profile, ...input }) => {
      try {
        const connection = await validateOrgConnection();
        return json(await checkApp(input, connection.valid ? connection.targetOrg : undefined, { userId, profile }));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_describe",
    `LSC Studio (GUI only): compact descriptions (real field API names, types, picklist values, whether DB Schema syncs it to the iPad, record count) of up to ${MAX_DESCRIBE_OBJECTS} objects, for the app builder. Read-only. Returns JSON { objects }.`,
    { objects: z.array(z.string().regex(/^\w{1,80}$/)).min(1).max(MAX_DESCRIBE_OBJECTS), mobileLogin: runAsLogin },
    async ({ objects, mobileLogin }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json({ objects: await describeForApp(objects, connection.targetOrg, mobileLogin as RunAs | undefined) });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_sample",
    "LSC Studio (GUI only): up to 5 real records from a SELECT-only SOQL query (anything else is refused, LIMIT is forced to 5 or less), so the app builder sees real values. Read-only. Returns JSON { records, totalSize }.",
    { soql: z.string().min(1).max(2000), mobileLogin: runAsLogin },
    async ({ soql, mobileLogin }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await sampleRecords(soql, connection.targetOrg, mobileLogin as RunAs | undefined));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_list",
    "LSC Studio (GUI only): the org's LSC apps (unmanaged lscMobileInline_* bundles) with target, objects and last change. Read-only. Returns JSON { apps }.",
    {},
    async () => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json({ apps: await listOrgApps(connection.targetOrg) });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_source",
    "LSC Studio (GUI only): an LSC app's files from the org — the lscMobileInline_* bundle and the c/ components it uses. Read-only. Returns JSON { name, target, objectApiName?, files }.",
    { name: z.string().regex(/^\w{1,80}$/) },
    async ({ name }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await appSource(name, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_starters",
    "LSC Studio (GUI only): starter LSC apps the builder can begin from — working apps from the afls-ideas GitHub account, copied at pinned commits — with label, description, target, objects read and follow-up prompts. Read-only; no org needed. Returns JSON { starters }.",
    {},
    async () => {
      try {
        return json({ starters: listStarters() });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_starter_source",
    "LSC Studio (GUI only): one starter LSC app's files (the lscMobileInline_* bundle and the c/ components it uses) and where they came from. Read-only; no org needed. Returns JSON { name, target, objectApiName?, files, starter }.",
    { id: z.string().regex(/^[a-z0-9-]{1,60}$/) },
    async ({ id }) => {
      try {
        return json(starterSource(id));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_tab_options",
    "LSC Studio (GUI data): who can be given a nav tab app and which apps can hold it — profiles with active users (LSC permission set holders first; `name` is the metadata name `tab.profiles` takes) and the org's Lightning apps (`fullName` is what `tab.application` takes). Read-only. Returns JSON { profiles: { label, name, activeUsers, lscUsers }[], apps: { fullName, label }[] }.",
    {},
    async () => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await tabOptions(connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_app_deploy_plan",
    "LSC Studio (GUI data): what deploying an LSC App would write (components, e.g. LightningComponentBundle, QuickAction, FlexiPage, CustomTab, Profile), which of those already exist in the org and would be overwritten, whether the org is production (not a sandbox and not a trial), and warnings. Read-only. Returns JSON { components, existing, production, warnings }.",
    appInputShape,
    async (input) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await planDeploy(input, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function registerPerfTools(server: McpServer) {
  server.tool(
    "studio_perf_users",
    "LSC Studio (GUI data): active users to test in a performance plan, filtered by name/username search and/or profile, most territories first, with each user's DeviceSyncSummary count over the last `days` days (default 30). Read-only. Returns JSON.",
    {
      search: z.string().max(100).optional(),
      profile: z.string().max(255).optional(),
      days: z.number().int().min(1).max(365).optional(),
    },
    async ({ search, profile, days }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await searchPerfUsers({ search, profile, days }, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_perf_parse_plan",
    "LSC Studio (GUI data): validate an NFR profile YAML (the run_perf_assessment format) and return it as a JSON test plan. Doesn't touch the org. Returns JSON.",
    { yaml: z.string().max(200_000) },
    async ({ yaml }) => {
      try {
        return json(parseNfrProfile(yaml));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_perf_start",
    "LSC Studio (GUI data): start a performance assessment of a test plan (predicted sync volume + field telemetry per persona, evaluated against NFR thresholds) as a background job. Read-only against the org. Returns JSON status; poll with studio_perf_status.",
    {
      plan: nfrProfileSchema,
      mobileLogins: z
        .array(
          z.object({
            instanceUrl: z.string().url().max(255),
            accessToken: z.string().min(1).max(4096),
            username: z.string().min(1).max(255),
            orgId: z.string().max(18).optional(),
          })
        )
        .max(25)
        .optional()
        .describe(
          "Logins Studio made through the LSC mobile app's connected app. A persona user whose username matches one gets their exact table list from their own metadata download instead of the ObjectPermissions approximation; tokens are used for this job only and never returned."
        ),
    },
    async ({ plan, mobileLogins }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(startPerfRun(plan, connection.targetOrg, undefined, mobileLogins ?? []));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_perf_status",
    "LSC Studio (GUI data): progress of a performance run started by studio_perf_start, with the full result once done. Returns JSON.",
    { jobId: z.string().max(64) },
    async ({ jobId }) => {
      try {
        return json(perfRunStatus(jobId));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_connected_org",
    "LSC Studio (GUI data): the org alias or username the tools are connected to. Returns JSON { org }.",
    {},
    async () => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      return json({ org: connection.targetOrg });
    }
  );

  server.tool(
    "studio_perf_active",
    "LSC Studio (GUI data): the performance run in progress for the connected org, if any, so the GUI can reattach to it. Returns JSON { job } (null when nothing is running).",
    {},
    async () => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      return json({ job: activePerfRun(connection.targetOrg) });
    }
  );

  server.tool(
    "studio_perf_check",
    "LSC Studio (GUI data): pre-flight check of a test plan against the connected org — users that don't exist or are inactive, profile selections with no users, and territories none of a persona's users are in. Read-only. Returns JSON { org, issues, personas }.",
    { plan: nfrProfileSchema },
    async ({ plan }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await checkPerfPlan(plan, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_perf_territories",
    "LSC Studio (GUI data): territories in the active model that a persona's users are in (listed users plus those a profile selection picks), with how many of them are in each. Read-only. Returns JSON { territories }.",
    {
      users: z.array(z.string().max(255)).max(50),
      select: z.object({ profile: z.string().min(1).max(255), count: z.number().int().min(1).max(10).optional() }).optional(),
    },
    async ({ users, select }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json({ territories: await perfTerritories({ users, select }, connection.targetOrg) });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_perf_report",
    "LSC Studio (GUI data): render a finished performance run (the result from studio_perf_status) as a shareable markdown report. Doesn't touch the org. Returns JSON { markdown }.",
    { result: z.object({}).passthrough(), days: z.number().int().positive().max(365).optional() },
    async ({ result, days }) => {
      if (!Array.isArray((result as { personas?: unknown }).personas)) {
        return jsonError("Not a performance run result (no personas).");
      }
      try {
        return json({ markdown: renderAssessment(result as unknown as AssessmentResult, days ?? 30) });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_perf_cancel",
    "LSC Studio (GUI data): stop a running performance run; queries already in flight finish, no new ones start. Returns JSON status.",
    { jobId: z.string().max(64) },
    async ({ jobId }) => {
      try {
        return json(cancelPerfRun(jobId));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const networkSchema = z
    .object({
      profile: z.enum(["none", "3g", "4g", "5g", "wifi", "custom"]),
      rttMs: z.number().min(0).max(5000).optional(),
      downMbps: z.number().min(0.05).max(10000).optional(),
      upMbps: z.number().min(0.05).max(10000).optional(),
    })
    .describe(
      "Network conditions added on top of this machine's connection: 3g, 4g (LTE), 5g, wifi (approximate presets), custom (needs rttMs, downMbps, upMbps) or none (default). Can only slow the real connection down."
    );

  const sobjects = z.array(z.string().min(1).max(80)).max(500).optional();

  server.tool(
    "studio_sim_start",
    "LSC Studio (GUI data): start a first-sync simulation (the network part of an iOS initial sync: user-info, metadata archive, every table's data) as a background job, running as the given sf CLI connection — admin or end user — or as a mobileLogin the Studio app made through the LSC mobile app's connected app (the token is used for this job only and never returned). Read-only against the org. Returns JSON status; poll with studio_sim_status.",
    {
      connection: z.string().min(1).max(255).describe("sf CLI alias or username to run as; the label when mobileLogin is given"),
      mobileLogin: z
        .object({
          instanceUrl: z.string().url().max(255),
          accessToken: z.string().min(1).max(4096),
          username: z.string().min(1).max(255),
          orgId: z.string().max(18).optional(),
        })
        .optional()
        .describe("A login Studio made through the LSC mobile app's connected app; used instead of the sf CLI connection"),
      options: z
        .object({
          territory: z.string().max(255).optional(),
          forceFlow: z.enum(["enhanced", "legacy"]).optional(),
          include: sobjects,
          exclude: sobjects,
          maxSeconds: z.number().int().min(10).max(7200).optional(),
          maxRecordsPerTable: z.number().int().min(1).optional(),
          maxTotalRecords: z.number().int().min(1).optional(),
          network: networkSchema.optional(),
          deviceRamGB: z.number().int().min(1).max(32).optional().describe("RAM of the simulated iPad in GB (default 8); sizes metadata chunks and legacy dynamic batches"),
          dynamicBatchSize: z.boolean().optional().describe("Legacy flow: the app's dynamicBatchRequestSize setting (default true)"),
          runs: z
            .number()
            .int()
            .min(1)
            .max(MAX_SIM_RUNS)
            .optional()
            .describe("Runs back to back as the same login (default 1); the result reports median and min–max times"),
          delta: z
            .object({ sinceHours: z.number().min(0.01).max(8760) })
            .optional()
            .describe("After the initial sync, simulate a delta sync as if the device last synced this many hours ago (record-visibility rounds plus IdSubquery downloads of changed records; enhanced flow only)"),
          content: z
            .object({
              attachments: z.boolean().optional(),
              clm: z.boolean().optional(),
              maxFiles: z.number().int().min(1).optional(),
              maxBytes: z.number().int().min(1).optional(),
            })
            .optional()
            .describe("Opt-in file downloads after the sync (GET, bodies counted and discarded): background attachments one at a time, CLM presentations in Range chunks. Outside the sync window; not in the totals. maxFiles and maxBytes are per kind (defaults 200 and 2 GiB); with several runs this happens in the last run only"),
        })
        .optional(),
    },
    async ({ connection, mobileLogin, options }) => {
      try {
        return json(startSimulation(mobileLogin ?? connection, options ?? {}));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_sim_status",
    "LSC Studio (GUI data): progress of a first-sync simulation started by studio_sim_start, with the result once finished (also when cancelled, covering what was downloaded). Returns JSON.",
    { jobId: z.string().max(64) },
    async ({ jobId }) => {
      try {
        return json(simulationStatus(jobId));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_sim_active",
    "LSC Studio (GUI data): the first-sync simulation in progress, if any, so the GUI can reattach to it. Returns JSON { job } (null when nothing is running).",
    {},
    async () => json({ job: activeSimulation() })
  );

  server.tool(
    "studio_sim_cancel",
    "LSC Studio (GUI data): stop a running first-sync simulation; requests in flight are aborted and no new tables start. Returns JSON status.",
    { jobId: z.string().max(64) },
    async ({ jobId }) => {
      try {
        return json(cancelSimulation(jobId));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_sim_report",
    "LSC Studio (GUI data): render a finished first-sync simulation (the result from studio_sim_status) as a shareable markdown report. Doesn't touch the org. Returns JSON { markdown }.",
    { result: z.object({}).passthrough() },
    async ({ result }) => {
      if (!Array.isArray((result as { tables?: unknown }).tables)) {
        return jsonError("Not a first-sync simulation result (no tables).");
      }
      try {
        const markdown = renderSimulation(result as unknown as SimulationResult);
        const runs = renderRunsSection(result as { runs?: SimRunsSummary });
        return json({ markdown: runs ? markdown.replace("## Slowest tables", () => `${runs}## Slowest tables`) : markdown });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function registerSyncHealthTools(server: McpServer) {
  server.tool(
    "studio_sync_overview",
    "LSC Studio (GUI data): org-wide mobile sync health from DeviceSyncSummary over the last `days` days (default 30) — trend, failure rate, by app version and network — and the users most at risk. Read-only. Returns JSON.",
    syncOverviewInput,
    async (input) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await syncOverview(connection.targetOrg, input));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_sync_user",
    "LSC Studio (GUI data): one user's predicted mobile sync volume per table with the DB Schema record behind each and why heavy tables are heavy, plus their own recent syncs. Read-only. Returns JSON.",
    syncUserInput,
    async (input) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await syncUserDetail(connection.targetOrg, input));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_sync_user_progress",
    "LSC Studio (GUI data): how far a running studio_sync_user for this user has got (phase, tables counted of all, and per territory), or null when none ran lately. Read-only; makes no org calls. Returns JSON { progress }.",
    { userId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/) },
    async ({ userId }) => json({ progress: syncUserProgress(userId) })
  );

  server.tool(
    "studio_sync_impact",
    "LSC Studio (GUI data): predicted mobile sync volume before and after pending DB Schema changes (Studio fixes), per affected profile. Read-only — nothing is written. Returns JSON.",
    syncImpactInput,
    async (input) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await syncImpact(connection.targetOrg, input));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_export_source",
    "LSC Studio (GUI data): save the org's current version of applied Studio changes (or named metadata items) as sfdx source files in a local folder (force-app/main/default, or the project's default package), plus manifest/studio-package.xml. Read-only against the org — it only retrieves. Returns JSON { folder, packageDir, manifest, files, toRemove, orgOnly (changes with no source file, with why), missing, notes }.",
    {
      folder: z.string().min(1).max(1024),
      changes: z.array(fixSchema).max(200).optional(),
      items: z
        .array(z.object({ type: z.enum(SOURCE_TYPES as [string, ...string[]]), fullName: z.string().min(1).max(255) }))
        .max(200)
        .optional(),
    },
    async ({ folder, changes, items }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(
          await exportSource(
            { folder, changes: changes as StudioFix[] | undefined, items: items as Parameters<typeof exportSource>[0]["items"] },
            connection.targetOrg
          )
        );
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_signoff_report",
    "LSC Studio (GUI data): render a plain-language go-live sign-off report from a performance assessment result and optional first-sync simulation results, with the detailed reports as an appendix. Doesn't touch the org. Returns JSON { markdown }.",
    signoffReportInput,
    async (input) => {
      try {
        return json({ markdown: renderSignoffReport(input) });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

/** Names a batch of previews or applies so studio_fix_progress can report on it; one entry per change. */
const progressSchema = z.object({
  id: z.string().min(1).max(80),
  index: z.number().int().min(0).max(999),
  total: z.number().int().min(1).max(1000),
});

function registerFixTools(server: McpServer) {
  server.tool(
    "studio_fix_progress",
    "LSC Studio (GUI only): the steps each change of a running studio_preview_fix / studio_apply_fix batch is on (waiting / running / done / failed, with times and counts), keyed by the `progress.id` those calls were given; null once it has expired. Read-only; makes no org calls. Returns JSON { progress }.",
    { id: z.string().min(1).max(80) },
    async ({ id }) => json({ progress: fixProgress(id) })
  );

  server.tool(
    "studio_preview_fix",
    "LSC Studio (GUI only): preview a Studio fix against the live org — the exact changes, warnings, and whether it can be applied. Read-only. With `progress` ({ id, index, total }), the steps it takes can be read with studio_fix_progress while it runs. Returns JSON.",
    { fix: fixSchema, progress: progressSchema.optional() },
    async ({ fix, progress }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      const tracker = progress ? startFixChange(progress, fix as StudioFix, "preview") : undefined;
      try {
        return json(await previewFix(fix as StudioFix, connection.targetOrg, tracker));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      } finally {
        tracker?.finish();
      }
    }
  );

  server.tool(
    "studio_apply_fix",
    "LSC Studio (GUI only): apply a previewed Studio fix. WRITES to the org. Only called from the Studio UI after the user confirms. Refuses if the target org isn't `expectedOrg`. Returns JSON with an undo fix.",
    {
      fix: fixSchema,
      expectedOrg: z.string().describe("The org the user confirmed — the fix is refused if the target org differs"),
      progress: progressSchema.optional(),
    },
    async ({ fix, expectedOrg, progress }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      if (connection.targetOrg !== expectedOrg) {
        return jsonError(`Target org is ${connection.targetOrg}, not ${expectedOrg}. Nothing was changed.`);
      }
      const tracker = progress ? startFixChange(progress, fix as StudioFix, "apply") : undefined;
      try {
        return json(await applyFix(fix as StudioFix, connection.targetOrg, tracker));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      } finally {
        tracker?.finish();
      }
    }
  );

  server.tool(
    "studio_app_deploy",
    "LSC Studio (GUI only): deploy an LSC App — its bundles; for a record page or quick action app the LightningWebComponent quick action; for a nav tab app the App page, custom tab, and (when given) the app membership and profile tab visibility. WRITES to the org. Only called from the Studio UI after the user confirms. Refuses if the app has lint errors or the target org isn't `expectedOrg`. Returns JSON { ok, deployed, error?, warnings, production }.",
    { ...appInputShape, expectedOrg: z.string().describe("The org the user confirmed — the deploy is refused if the target org differs") },
    async ({ expectedOrg, ...input }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      if (connection.targetOrg !== expectedOrg) {
        return jsonError(`Target org is ${connection.targetOrg}, not ${expectedOrg}. Nothing was deployed.`);
      }
      try {
        return json(await deployApp(input, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_publish_mobile",
    "LSC Studio (GUI only): start regenerating the LSC Mobile metadata cache for the given profiles (\"Publish to iPad\"). WRITES to the org. Refuses if the target org isn't `expectedOrg`. Returns JSON status; poll with studio_publish_status.",
    {
      profiles: z.array(z.string()).min(1),
      expectedOrg: z.string(),
    },
    async ({ profiles, expectedOrg }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      if (connection.targetOrg !== expectedOrg) {
        return jsonError(`Target org is ${connection.targetOrg}, not ${expectedOrg}. Nothing was published.`);
      }
      try {
        return json(await startPublish(profiles, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_publish_status",
    "LSC Studio (GUI only): check a \"Publish to iPad\" metadata cache generation. Read-only. Returns JSON.",
    { parentId: id },
    async ({ parentId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await publishStatus(parentId, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
