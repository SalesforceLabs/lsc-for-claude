/**
 * Visit page layout helpers for the visit engagement sidebar — shared by the
 * `add_visit_engagement_sidebar_item` MCP tool and LSC Studio.
 *
 * The mobile sidebar shows a Visit layout's related lists (8 out-of-the-box plus
 * 2 custom). Changing it means retrieving the layout XML, editing it, and
 * deploying it back.
 */

import type { StatusHook } from "./direct-metadata.js";
import * as fs from "fs";
import * as path from "path";
import { retrieveMetadata } from "./cli.js";

/** The visit engagement sidebar holds 8 OOB + 2 custom related lists. */
export const MAX_SIDEBAR_RELATED_LISTS = 10;

export type RetrievedLayout =
  | { ok: true; xml: string; filePath: string; outputDir: string }
  | { ok: false; reason: "retrieve" | "noDir" | "noFile"; error?: string };

/** Retrieve a layout's XML into the session's temp SFDX project. */
export async function retrieveLayoutXml(fullLayoutName: string, org: string, onStatus?: StatusHook): Promise<RetrievedLayout> {
  const retrieveResult = await retrieveMetadata("", `Layout:${fullLayoutName}`, org, onStatus);
  if (!retrieveResult.success) return { ok: false, reason: "retrieve", error: retrieveResult.error };

  const outputDir = (retrieveResult.data as { outputDir: string }).outputDir;
  // With --output-dir the CLI writes layouts/ straight into the output dir; older versions nested it under force-app.
  const layoutDir = [path.join(outputDir, "layouts"), path.join(outputDir, "force-app", "main", "default", "layouts")].find((d) =>
    fs.existsSync(d)
  );
  if (!layoutDir) return { ok: false, reason: "noDir" };

  const layoutFiles = fs.readdirSync(layoutDir).filter((f) => f.endsWith(".layout-meta.xml"));
  if (layoutFiles.length === 0) return { ok: false, reason: "noFile" };

  const filePath = path.join(layoutDir, layoutFiles[0]);
  return { ok: true, xml: fs.readFileSync(filePath, "utf-8"), filePath, outputDir };
}

const RELATED_LIST_NAME = /^\w+$/;

function assertRelationship(relationshipName: string): void {
  if (!RELATED_LIST_NAME.test(relationshipName)) throw new Error(`Invalid relationship name: ${relationshipName}`);
}

export function hasRelatedList(xml: string, relationshipName: string): boolean {
  return xml.includes(`<relatedList>${relationshipName}</relatedList>`);
}

export function countRelatedLists(xml: string): number {
  return (xml.match(/<relatedLists>/g) || []).length;
}

/** Relationship names of the layout's related lists, in layout order. */
export function relatedListNames(xml: string): string[] {
  return [...xml.matchAll(/<relatedList>([^<]+)<\/relatedList>/g)].map((m) => m[1]);
}

/** The related list block inserted for a sidebar item. */
export function relatedListBlock(relationshipName: string): string {
  return `    <relatedLists>
        <relatedList>${relationshipName}</relatedList>
        <fields>NAME</fields>
        <excludeButtons>New</excludeButtons>
        <excludeButtons>MassDeleteAll</excludeButtons>
    </relatedLists>
`;
}

/** Insert the related list before </Layout>. */
export function insertRelatedList(xml: string, relationshipName: string): string {
  return xml.replace("</Layout>", `${relatedListBlock(relationshipName)}</Layout>`);
}

/** Remove the related list's block; the XML is returned unchanged when it isn't there. */
export function removeRelatedList(xml: string, relationshipName: string): string {
  assertRelationship(relationshipName);
  const block = new RegExp(
    `[ \\t]*<relatedLists>(?:(?!</relatedLists>)[\\s\\S])*?<relatedList>${relationshipName}</relatedList>(?:(?!</relatedLists>)[\\s\\S])*?</relatedLists>[ \\t]*\\r?\\n?`
  );
  return xml.replace(block, "");
}

/** Write edited layout XML back to where it was retrieved. */
export function writeLayoutXml(layout: Extract<RetrievedLayout, { ok: true }>, xml: string): void {
  fs.writeFileSync(layout.filePath, xml, "utf-8");
}

/** The directory to deploy after `writeLayoutXml`. */
export function layoutDeployPath(layout: Extract<RetrievedLayout, { ok: true }>): string {
  return path.dirname(layout.filePath);
}
