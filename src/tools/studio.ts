import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateOrgConnection } from "../salesforce/auth.js";
import { getFeature, listFeatures } from "../studio/features.js";
import { collectFeatureMap, collectItemDetail, collectProfileOptions } from "../studio/collect.js";
import { accessOptions, userAccess } from "../studio/access.js";
import { applyFix, previewFix } from "../studio/fixes.js";
import { publishStatus, startPublish } from "../studio/publish.js";
import { loadPublishedIpad } from "../studio/published.js";
import type { StudioFix } from "../studio/types.js";

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
const accessSchema = z.object({
  type: z.enum(["permissionSet", "permissionSetGroup", "territory"]),
  id,
  label: z.string(),
});
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
    },
    async ({ featureId }) => {
      const feature = getFeature(featureId);
      if (!feature) return jsonError(`Unknown feature: ${featureId}`);
      if (!feature.available) return jsonError(`${feature.title} isn't available in Studio yet.`);

      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      return json(await collectFeatureMap(feature, connection.targetOrg));
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
        return json(await collectItemDetail(kind, id, connection.targetOrg));
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
    "studio_user_access",
    "LSC Studio (GUI data): a user's permission set licenses, permission sets, permission set groups, and territories. Read-only. Returns JSON.",
    { userId: id },
    async ({ userId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await userAccess(userId, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_ipad_published",
    "LSC Studio (GUI data): what the iPad actually renders for one user of a profile — tabs, Home page components, record layouts, and list views — read from the profile's published mobile metadata cache with the user's permission sets merged in (the profile's most typical user unless userId is given). Read-only. Returns JSON.",
    { profile: z.string().min(1).max(255), userId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/).optional() },
    async ({ profile, userId }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await loadPublishedIpad(profile, connection.targetOrg, userId));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_access_options",
    "LSC Studio (GUI data): permission sets, permission set groups, and territories that can be given to a user. Read-only. Returns JSON.",
    {},
    async () => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await accessOptions(connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  if (process.env.LSC_STUDIO_FIXES === "1") registerFixTools(server);
}

function registerFixTools(server: McpServer) {
  server.tool(
    "studio_preview_fix",
    "LSC Studio (GUI only): preview a Studio fix against the live org — the exact changes, warnings, and whether it can be applied. Read-only. Returns JSON.",
    { fix: fixSchema },
    async ({ fix }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      try {
        return json(await previewFix(fix as StudioFix, connection.targetOrg));
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    "studio_apply_fix",
    "LSC Studio (GUI only): apply a previewed Studio fix. WRITES to the org. Only called from the Studio UI after the user confirms. Refuses if the target org isn't `expectedOrg`. Returns JSON with an undo fix.",
    {
      fix: fixSchema,
      expectedOrg: z.string().describe("The org the user confirmed — the fix is refused if the target org differs"),
    },
    async ({ fix, expectedOrg }) => {
      const connection = await validateOrgConnection();
      if (!connection.valid || !connection.targetOrg) {
        return jsonError(connection.error || "No Salesforce org connected.");
      }
      if (connection.targetOrg !== expectedOrg) {
        return jsonError(`Target org is ${connection.targetOrg}, not ${expectedOrg}. Nothing was changed.`);
      }
      try {
        return json(await applyFix(fix as StudioFix, connection.targetOrg));
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
