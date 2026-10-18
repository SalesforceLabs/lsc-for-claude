/**
 * "Publish to iPad" — regenerate the LSC Mobile metadata cache for a set of
 * profiles so configuration changes reach reps' devices.
 *
 * Same steps as the `generate_mobile_metadata_cache` tool (parent record, one
 * child per profile, ValidationCompleted, Connect API generate), but split into
 * start + status so the Studio UI can show progress instead of blocking.
 */

import { createRecord, generateMobileMetadataCache, updateRecord } from "../salesforce/cli.js";
import { ID_PATTERN, inList, query } from "./helpers.js";
import type { PublishStatus } from "./types.js";

const API_VERSION = "65.0";
const PREFIX = "lsc4ce";

export async function startPublish(profileNames: string[], org: string): Promise<PublishStatus> {
  if (profileNames.length === 0) throw new Error("Pick at least one profile to publish.");
  const profiles = await query(`SELECT Id, Name FROM Profile WHERE Name IN (${inList(profileNames)})`, org);
  const missing = profileNames.filter((n) => !profiles.some((p) => String(p.Name).toLowerCase() === n.toLowerCase()));
  if (missing.length) throw new Error(`Profile not found: ${missing.join(", ")}`);

  const parent = await createRecord("LifeSciMobileMetadataRecord", { IntegrationStatus: "New", Status: "New" }, org);
  if (!parent.success || !parent.data?.id) throw new Error(parent.error || "Couldn't create the metadata cache record.");
  const parentId = parent.data.id;

  const childIds: string[] = [];
  for (const p of profiles) {
    const child = await createRecord(
      "LifeSciMobileMetadataRecord",
      { ParentMobileMetadataRecId: parentId, ProfileId: String(p.Id), IntegrationStatus: "New", Status: "New" },
      org
    );
    if (!child.success || !child.data?.id) throw new Error(`Couldn't add ${p.Name}: ${child.error || "unknown error"}`);
    childIds.push(child.data.id);
  }

  // Parent first, then children — each in its own transaction, as the generate API expects.
  for (const id of [parentId, ...childIds]) {
    const res = await updateRecord("LifeSciMobileMetadataRecord", id, { Status: "ValidationCompleted" }, org);
    if (!res.success) throw new Error(res.error || "Couldn't mark the cache records ready.");
  }

  // The generate call can report an error even when the async job starts; status polling is the source of truth.
  await generateMobileMetadataCache(parentId, API_VERSION, PREFIX, org);
  return { parentId, state: "running", status: "Generating", profiles: profiles.map((p) => String(p.Name)) };
}

export async function publishStatus(parentId: string, org: string): Promise<PublishStatus> {
  if (!ID_PATTERN.test(parentId)) throw new Error(`Invalid record Id: ${parentId}`);
  const rows = await query(
    `SELECT Id, Status, IntegrationStatus, IntegrationErrorMessage, Profile.Name FROM LifeSciMobileMetadataRecord WHERE Id = '${parentId}' OR ParentMobileMetadataRecId = '${parentId}'`,
    org
  );
  const parent = rows.find((r) => r.Id === parentId);
  if (!parent) throw new Error("The publish job no longer exists.");
  const profiles = rows
    .filter((r) => r.Id !== parentId)
    .map((r) => String((r.Profile as { Name?: string } | null)?.Name ?? ""))
    .filter(Boolean);
  const status = String(parent.Status ?? "Unknown");
  // The parent goes ValidationCompleted -> Published (job queued) -> Loading -> Active. Only Active has a cache
  // ZIP reps can download; a new job that ends Inactive was never activated (generation failed or a later
  // publish replaced it), so reporting it done would leave the old cache in place without saying so.
  const failed = status === "Error" || status === "Inactive" || parent.IntegrationStatus === "Error";
  const reason = status === "Inactive" ? "Salesforce ended the cache generation without activating it, so reps still get the previous cache. Publish again." : "Cache generation failed.";
  return {
    parentId,
    state: failed ? "failed" : status === "Active" ? "done" : "running",
    status,
    profiles,
    error: failed ? String(parent.IntegrationErrorMessage || reason) : undefined,
  };
}
