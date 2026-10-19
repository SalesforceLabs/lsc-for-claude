/**
 * Metadata API retrieve and deploy over SOAP for the few types Studio edits,
 * using the sf CLI's own login (direct.ts) instead of spawning
 * `sf project retrieve|deploy start`. Each spawn costs seconds of CLI start-up
 * and polling on top of the org's own work; this polls every 200 ms–1 s.
 *
 * Files are read and written in the CLI's source format so callers can't tell
 * the paths apart: a layout, Lightning page, profile or app is the Metadata API
 * file with `-meta.xml` added (byte-identical), and a compact layout or list view
 * is its element of the object file, as `objects/<Object>/<dir>/<name>.<suffix>-meta.xml`.
 * Anything else — other types, other files in a deploy folder — returns `null`
 * and the caller uses the CLI.
 */

import * as fs from "fs";
import * as path from "path";
import { deflateRawSync } from "zlib";
import { XMLParser } from "fast-xml-parser";
import { directApiVersion, directEnabled, directMetadataSoap, type CredentialFetcher, type DirectOutcome } from "./direct.js";
import { ZipReader } from "../perf/device/zip.js";
import { childText, escapeXml, parseXml, serializeXml, type XmlNode } from "../studio/metadata/xml.js";

/** Types stored as one file each: Metadata API folder and file suffix. */
const FILE_TYPES: Record<string, { dir: string; suffix: string }> = {
  Layout: { dir: "layouts", suffix: "layout" },
  FlexiPage: { dir: "flexipages", suffix: "flexipage" },
  Profile: { dir: "profiles", suffix: "profile" },
  CustomApplication: { dir: "applications", suffix: "app" },
};

/** Types stored inside their object's file: the element there, and the source-format folder and suffix. */
const CHILD_TYPES: Record<string, { tag: string; dir: string; suffix: string }> = {
  CompactLayout: { tag: "compactLayouts", dir: "compactLayouts", suffix: "compactLayout" },
  ListView: { tag: "listViews", dir: "listViews", suffix: "listView" },
};

const MD_NS = "http://soap.sforce.com/2006/04/metadata";
const DEFAULT_TIMEOUT_MS = 300_000;

const soap = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "componentFailures" || name === "messages",
});

interface Member {
  type: string;
  /** Omitted for every component of the type. */
  fullName?: string;
}

/** `Type:Name` / `Type` specs as `sf project retrieve start --metadata` takes them; null if any isn't supported here. */
export function parseMetadataSpecs(specs: string[]): Member[] | null {
  const members: Member[] = [];
  for (const spec of specs) {
    const i = spec.indexOf(":");
    const type = i < 0 ? spec : spec.slice(0, i);
    const fullName = i < 0 ? undefined : spec.slice(i + 1);
    if (!FILE_TYPES[type] && !CHILD_TYPES[type]) return null;
    if (fullName === "" || fullName?.includes("*")) return null;
    if (CHILD_TYPES[type] && (!fullName || !fullName.includes("."))) return null;
    members.push({ type, fullName });
  }
  return members.length ? members : null;
}

function manifest(members: Member[], version: string): string {
  const byType = new Map<string, string[]>();
  for (const m of members) byType.set(m.type, [...(byType.get(m.type) ?? []), m.fullName ?? "*"]);
  const types = [...byType]
    .map(([name, list]) => `<types>${list.map((n) => `<members>${escapeXml(n)}</members>`).join("")}<name>${name}</name></types>`)
    .join("");
  return `${types}<version>${version}</version>`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = [200, 200, 300, 300, 500, 500, 750];
const pollDelay = (n: number) => POLL_MS[n] ?? 1000;

type Result = Record<string, unknown>;

/** The `<result>` of a SOAP response, or an error outcome. */
function resultOf(envelope: string, op: string): DirectOutcome<Result> {
  try {
    const parsed = soap.parse(envelope) as Result;
    const body = (parsed.Envelope as Result | undefined)?.Body as Result | undefined;
    const result = (body?.[`${op}Response`] as Result | undefined)?.result as Result | undefined;
    if (result) return { ok: true, data: result };
  } catch {
    // fall through
  }
  return { ok: false, error: `Salesforce returned an unreadable ${op} response` };
}

/** What a polled retrieve or deploy says about itself, for callers that show progress. */
export interface MetadataStatus {
  operation: "retrieve" | "deploy";
  /** Salesforce's own status ("Pending", "InProgress", "Succeeded", ...); absent before the first poll. */
  status?: string;
  /** Salesforce's `stateDetail` while a deploy runs ("Processing Type: Layout"). */
  stateDetail?: string;
  /** Deploy components processed so far, and in all. */
  componentsDone?: number;
  componentsTotal?: number;
}
export type StatusHook = (status: MetadataStatus) => void;

const numOf = (v: unknown): number | undefined => (v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

/** Start an async operation and poll its status until done. */
async function runAsync(
  org: string,
  fetcher: CredentialFetcher,
  start: string,
  check: (id: string) => string,
  startOp: string,
  checkOp: string,
  timeoutMs: number,
  onStatus?: StatusHook
): Promise<DirectOutcome<Result> | null> {
  const began = Date.now();
  const started = await directMetadataSoap(org, start, fetcher);
  if (!started || !started.ok) return started;
  const first = resultOf(started.data, startOp);
  if (!first.ok) return first;
  const id = String(first.data.id ?? "");
  if (!id) return { ok: false, error: `Salesforce didn't start the ${startOp}` };
  for (let n = 0; ; n++) {
    if (Date.now() - began > timeoutMs) return { ok: false, timedOut: true, error: `The ${startOp} didn't finish in ${Math.round(timeoutMs / 1000)}s` };
    await sleep(pollDelay(n));
    const res = await directMetadataSoap(org, check(id), fetcher);
    // Started but lost: say so rather than let the CLI run it a second time.
    if (!res) return { ok: false, error: `Lost the connection to Salesforce while waiting for the ${startOp} to finish` };
    if (!res.ok) return res;
    const status = resultOf(res.data, checkOp);
    if (!status.ok) return status;
    try {
      onStatus?.({
        operation: startOp === "deploy" ? "deploy" : "retrieve",
        status: status.data.status === undefined ? undefined : String(status.data.status),
        stateDetail: status.data.stateDetail ? String(status.data.stateDetail) : undefined,
        componentsDone: numOf(status.data.numberComponentsDeployed),
        componentsTotal: numOf(status.data.numberComponentsTotal),
      });
    } catch {
      // Progress is advisory; a failing hook never fails the operation.
    }
    if (status.data.done === "true") return status;
  }
}

function mkdirWrite(file: string, data: Buffer | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

/** Write a retrieved zip's components into `outputDir` in source format. */
function unpack(zip: Buffer, outputDir: string): void {
  const tmp = path.join(outputDir, ".retrieve.zip");
  fs.writeFileSync(tmp, zip);
  const reader = ZipReader.open(tmp);
  try {
    for (const entry of reader.entries) {
      const name = entry.name.replace(/^unpackaged\//, "");
      if (name.endsWith("/") || name === "package.xml") continue;
      const objectFile = /^objects\/([^/]+)\.object$/.exec(name);
      if (objectFile) {
        const root = parseXml(reader.read(entry).toString("utf-8"));
        for (const [type, child] of Object.entries(CHILD_TYPES)) {
          for (const node of root.children.filter((c) => c.tag === child.tag)) {
            const fullName = childText(node, "fullName");
            if (!fullName) continue;
            const file: XmlNode = { tag: type, attrs: { xmlns: MD_NS }, children: node.children };
            mkdirWrite(path.join(outputDir, "objects", objectFile[1], child.dir, `${fullName}.${child.suffix}-meta.xml`), serializeXml(file));
          }
        }
        continue;
      }
      // One-file types keep the Metadata API's bytes; only the suffix changes.
      mkdirWrite(path.join(outputDir, `${name}-meta.xml`), reader.read(entry));
    }
  } finally {
    reader.close();
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Retrieve components into `outputDir` as `sf project retrieve start --output-dir` would.
 * `null` = not something this path does, or the transport is unusable: use the CLI.
 * A component the org doesn't have is left out, as with the CLI.
 */
export async function directRetrieve(
  specs: string[],
  org: string,
  outputDir: string,
  fetcher: CredentialFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStatus?: StatusHook
): Promise<DirectOutcome<void> | null> {
  const members = parseMetadataSpecs(specs);
  if (!members || !directEnabled(org)) return null;
  const version = await directApiVersion(org, fetcher);
  const start = `<retrieve><retrieveRequest><apiVersion>${version}</apiVersion><singlePackage>true</singlePackage><unpackaged>${manifest(members, version)}</unpackaged></retrieveRequest></retrieve>`;
  const check = (id: string) => `<checkRetrieveStatus><asyncProcessId>${id}</asyncProcessId><includeZip>true</includeZip></checkRetrieveStatus>`;
  const res = await runAsync(org, fetcher, start, check, "retrieve", "checkRetrieveStatus", timeoutMs, onStatus);
  if (!res || !res.ok) return res;
  if (res.data.status !== "Succeeded") {
    return { ok: false, error: String(res.data.errorMessage ?? `Retrieve ${String(res.data.status ?? "failed")}`) };
  }
  const zip = typeof res.data.zipFile === "string" ? Buffer.from(res.data.zipFile, "base64") : null;
  if (!zip) return { ok: false, error: "Salesforce returned no files" };
  try {
    unpack(zip, outputDir);
  } catch (e) {
    return { ok: false, error: `Couldn't read the retrieved files: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, data: undefined };
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** A source-format file's Metadata API component, or null if this path doesn't handle it. */
function componentOf(file: string): { type: string; fullName: string; zipName?: string; object?: string } | null {
  const base = path.basename(file);
  for (const [type, t] of Object.entries(FILE_TYPES)) {
    const suffix = `.${t.suffix}-meta.xml`;
    if (base.endsWith(suffix)) {
      const name = base.slice(0, -suffix.length);
      let fullName = name;
      try {
        fullName = decodeURIComponent(name);
      } catch {
        // not encoded
      }
      return { type, fullName, zipName: `${t.dir}/${name}.${t.suffix}` };
    }
  }
  for (const [type, t] of Object.entries(CHILD_TYPES)) {
    const suffix = `.${t.suffix}-meta.xml`;
    const parts = file.split(path.sep);
    if (base.endsWith(suffix) && parts.at(-2) === t.dir && parts.at(-4) === "objects") {
      const object = parts.at(-3)!;
      return { type, fullName: `${object}.${base.slice(0, -suffix.length)}`, object };
    }
  }
  return null;
}

// --- zip writing (deflate + CRC-32; no dependency) ---------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipFiles(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf-8");
    const body = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cen = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cen.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cen, end]);
}

/** The zip a deploy of these source-format files sends, or null if one isn't handled here. */
export function buildDeployZip(sourcePath: string, version: string): { zip: Buffer; members: Member[] } | null {
  if (!fs.existsSync(sourcePath)) return null;
  const files = fs.statSync(sourcePath).isDirectory() ? walk(sourcePath) : [sourcePath];
  if (!files.length) return null;
  const entries: { name: string; data: Buffer }[] = [];
  const members: Member[] = [];
  const objects = new Map<string, XmlNode[]>();
  for (const file of files) {
    const c = componentOf(file);
    if (!c) return null;
    members.push({ type: c.type, fullName: c.fullName });
    if (c.zipName) {
      entries.push({ name: c.zipName, data: fs.readFileSync(file) });
      continue;
    }
    const child = CHILD_TYPES[c.type];
    const root = parseXml(fs.readFileSync(file, "utf-8"));
    const children = [...root.children];
    if (!children.some((n) => n.tag === "fullName")) children.unshift({ tag: "fullName", text: escapeXml(c.fullName.slice(c.object!.length + 1)), children: [] });
    objects.set(c.object!, [...(objects.get(c.object!) ?? []), { tag: child.tag, children }]);
  }
  for (const [object, children] of objects) {
    entries.push({ name: `objects/${object}.object`, data: Buffer.from(serializeXml({ tag: "CustomObject", attrs: { xmlns: MD_NS }, children }), "utf-8") });
  }
  const pkg = `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="${MD_NS}">${manifest(members, version)}</Package>\n`;
  entries.push({ name: "package.xml", data: Buffer.from(pkg, "utf-8") });
  return { zip: zipFiles(entries), members };
}

function deployError(result: Result): string {
  const details = result.details as Result | undefined;
  const failures = ((details?.componentFailures as Result[] | undefined) ?? [])
    .map((f) => {
      const problem = String(f.problem ?? "");
      const where = f.fullName ? `${String(f.fullName)}: ` : "";
      return problem ? `${where}${problem}` : "";
    })
    .filter(Boolean);
  if (failures.length) return failures.join("; ");
  if (result.errorMessage) return String(result.errorMessage);
  return `Deploy ${String(result.status ?? "failed")}`;
}

/**
 * Deploy source-format files (one file or a folder of them) as
 * `sf project deploy start --source-dir` would, rolling back on any error.
 * `null` = not something this path does, or the transport is unusable: use the CLI.
 */
export async function directDeploy(
  sourcePath: string,
  org: string,
  fetcher: CredentialFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStatus?: StatusHook
): Promise<DirectOutcome<void> | null> {
  if (!directEnabled(org)) return null;
  const version = await directApiVersion(org, fetcher);
  let built: ReturnType<typeof buildDeployZip>;
  try {
    built = buildDeployZip(sourcePath, version);
  } catch {
    return null;
  }
  if (!built) return null;
  const start = `<deploy><ZipFile>${built.zip.toString("base64")}</ZipFile><DeployOptions><rollbackOnError>true</rollbackOnError><singlePackage>true</singlePackage></DeployOptions></deploy>`;
  const check = (id: string) => `<checkDeployStatus><asyncProcessId>${id}</asyncProcessId><includeDetails>true</includeDetails></checkDeployStatus>`;
  const res = await runAsync(org, fetcher, start, check, "deploy", "checkDeployStatus", timeoutMs, onStatus);
  if (!res || !res.ok) return res;
  if (res.data.success !== "true" || res.data.status !== "Succeeded") return { ok: false, error: deployError(res.data) };
  return { ok: true, data: undefined };
}
