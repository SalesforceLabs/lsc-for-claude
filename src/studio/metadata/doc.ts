/**
 * One metadata document (a page layout, compact layout, Lightning page or list view)
 * retrieved into the session's temp SFDX project, edited as an XML tree, and
 * deployed back as that single file. The retrieve folder is removed afterwards.
 */

import * as fs from "fs";
import * as path from "path";
import { deployMetadata, retrieveMetadata } from "../../salesforce/cli.js";
import type { StatusHook } from "../../salesforce/direct-metadata.js";
import { parseXml, serializeXml, type XmlNode } from "./xml.js";

export type MetadataDocType = "Layout" | "CompactLayout" | "FlexiPage" | "Profile" | "ListView";

const SUFFIX: Record<MetadataDocType, string> = {
  Layout: ".layout-meta.xml",
  CompactLayout: ".compactLayout-meta.xml",
  FlexiPage: ".flexipage-meta.xml",
  Profile: ".profile-meta.xml",
  ListView: ".listView-meta.xml",
};

export interface MetadataDoc {
  type: MetadataDocType;
  fullName: string;
  /** The file as retrieved. */
  xml: string;
  root: XmlNode;
  filePath: string;
  /** The retrieve folder, removed by `discardDoc`. */
  outputDir: string;
}

function findFile(dir: string, suffix: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, suffix);
      if (found) return found;
    } else if (entry.name.endsWith(suffix)) return full;
  }
  return undefined;
}

/** Retrieve one document. Throws with the CLI's message when it can't. */
export async function retrieveDoc(type: MetadataDocType, fullName: string, org: string, onStatus?: StatusHook): Promise<MetadataDoc> {
  const result = await retrieveMetadata("", `${type}:${fullName}`, org, onStatus);
  if (!result.success || !result.data) throw new Error(`Couldn't retrieve ${fullName}: ${result.error ?? "unknown error"}`);
  const { outputDir } = result.data;
  // A compact layout comes with its object's file; only the compact layout is ours.
  const filePath = fs.existsSync(outputDir) ? findFile(outputDir, SUFFIX[type]) : undefined;
  if (!filePath) {
    discardDir(outputDir);
    throw new Error(`${fullName} wasn't found in the org. It may have been renamed or deleted.`);
  }
  const xml = fs.readFileSync(filePath, "utf-8");
  return { type, fullName, xml, root: parseXml(xml), filePath, outputDir };
}

/**
 * Retrieve several documents of different types in one call (one of each type); they share one retrieve folder (removed by `discardDoc` on any of them).
 * A profile comes with its layout assignments only for the layouts retrieved beside it.
 */
export async function retrieveDocs(entries: { type: MetadataDocType; fullName: string }[], org: string, onStatus?: StatusHook): Promise<MetadataDoc[]> {
  const result = await retrieveMetadata(
    "",
    entries.map((e) => `${e.type}:${e.fullName}`),
    org,
    onStatus
  );
  if (!result.success || !result.data) throw new Error(`Couldn't retrieve ${entries.map((e) => e.fullName).join(", ")}: ${result.error ?? "unknown error"}`);
  const { outputDir } = result.data;
  try {
    return entries.map(({ type, fullName }) => {
      const filePath = fs.existsSync(outputDir) ? findFile(outputDir, SUFFIX[type]) : undefined;
      if (!filePath) throw new Error(`${fullName} wasn't found in the org. It may have been renamed or deleted.`);
      const xml = fs.readFileSync(filePath, "utf-8");
      return { type, fullName, xml, root: parseXml(xml), filePath, outputDir };
    });
  } catch (e) {
    discardDir(outputDir);
    throw e;
  }
}

/** Write `root` over the retrieved file and deploy that file alone. */
export async function deployDoc(doc: MetadataDoc, root: XmlNode, org: string, onStatus?: StatusHook): Promise<void> {
  fs.writeFileSync(doc.filePath, serializeXml(root), "utf-8");
  const result = await (onStatus ? deployMetadata(doc.filePath, org, onStatus) : deployMetadata(doc.filePath, org));
  if (!result.success) throw new Error(`Couldn't deploy ${doc.fullName}: ${result.error ?? "unknown error"}`);
}

/**
 * Ask the org whether it would accept `root` without deploying it (a check-only deploy).
 * Returns the org's reasons when it would refuse, null when it would accept or the check couldn't run.
 */
export async function validateDoc(doc: MetadataDoc, root: XmlNode, org: string): Promise<string | null> {
  fs.writeFileSync(doc.filePath, serializeXml(root), "utf-8");
  const result = await deployMetadata(doc.filePath, org, undefined, true);
  return result.rejected ? (result.error ?? "the org refused it") : null;
}

export function discardDoc(doc: MetadataDoc): void {
  discardDir(doc.outputDir);
}

function discardDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // A temp folder left behind is harmless.
  }
}

/** Retrieve, run `fn`, and always remove the retrieve folder. */
export async function withDoc<T>(
  type: MetadataDocType,
  fullName: string,
  org: string,
  fn: (doc: MetadataDoc) => Promise<T>,
  onStatus?: StatusHook
): Promise<T> {
  const doc = await retrieveDoc(type, fullName, org, onStatus);
  try {
    return await fn(doc);
  } finally {
    discardDoc(doc);
  }
}
