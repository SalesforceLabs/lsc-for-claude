/**
 * Metadata download, mirroring DownloadMetadataOperation: POST the download
 * action, then fetch the archive in sequential `Range` chunks and verify its
 * MD5. The duration measured here starts after the POST returns and ends once
 * the checksum matches, which is the DeviceSyncSummary.MetadataDownloadDuration
 * semantics.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { connectPath, DeviceHttpError, jsonOrThrow, type DeviceSession } from "./session.js";
import { ZipReader } from "./zip.js";

export const DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;

export interface FieldPermissionEntry {
  field: string;
  readable: boolean;
  editable?: boolean;
}

/** `userSpecificPermissions` from the download response; the device merges it into permissions.json. */
export interface UserSpecificPermissions {
  availableFields?: Record<string, string[]>;
  fieldPermissions?: FieldPermissionEntry[];
  objectPermissions?: unknown[];
}

export interface MetadataDownloadInfo {
  contentVersionId: string;
  checksum: string;
  contentSize: number;
  versionDataURL?: string;
  userSpecificPermissions: UserSpecificPermissions;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseDownloadInfo(json: unknown): MetadataDownloadInfo {
  const o = obj(json);
  const info = obj(o.metadataContentVersionInfo);
  const contentVersionId = typeof info.contentVersionId === "string" ? info.contentVersionId : "";
  const checksum = typeof info.checksum === "string" ? info.checksum : "";
  if (!contentVersionId || !checksum) {
    throw new DeviceHttpError("Metadata download response is missing metadataContentVersionInfo (contentVersionId/checksum)");
  }
  const usp = obj(o.userSpecificPermissions);
  const availableFields: Record<string, string[]> = {};
  for (const [table, fields] of Object.entries(obj(usp.availableFields))) {
    if (Array.isArray(fields)) availableFields[table] = fields.filter((f): f is string => typeof f === "string");
  }
  const fieldPermissions = (Array.isArray(usp.fieldPermissions) ? usp.fieldPermissions : []).flatMap((raw) => {
    const p = obj(raw);
    return typeof p.field === "string"
      ? [{ field: p.field, readable: p.readable === true, editable: p.editable === true }]
      : [];
  });
  return {
    contentVersionId,
    checksum: checksum.toLowerCase(),
    contentSize: typeof info.contentSize === "number" ? info.contentSize : Number(info.contentSize) || 0,
    versionDataURL: typeof info.versionDataURL === "string" && info.versionDataURL ? info.versionDataURL : undefined,
    userSpecificPermissions: {
      availableFields,
      fieldPermissions,
      objectPermissions: Array.isArray(usp.objectPermissions) ? usp.objectPermissions : [],
    },
  };
}

export async function requestMetadataDownload(
  session: DeviceSession,
  metadataRecordId: string,
  signal?: AbortSignal
): Promise<MetadataDownloadInfo> {
  const res = await session.http({
    method: "POST",
    url: connectPath(session, "life-sciences/commercial/metadata/actions/download"),
    body: JSON.stringify({ metadataRecordId }),
    signal,
  });
  return parseDownloadInfo(jsonOrThrow(res, "metadata download"));
}

/** Parse a `Content-Range: bytes a-b/total` header into its total, if present. */
export function contentRangeTotal(header: string | undefined): number | undefined {
  const m = header ? /\/(\d+)\s*$/.exec(header) : null;
  return m ? Number(m[1]) : undefined;
}

export interface ArchiveDownload {
  file: string;
  bytes: number;
  seconds: number;
  requests: number;
  md5: string;
}

/**
 * Download the archive to `dir` in sequential Range chunks, hashing as it goes.
 * Throws if the MD5 does not match `info.checksum`.
 */
export async function downloadArchive(
  session: DeviceSession,
  info: MetadataDownloadInfo,
  dir: string,
  opts: { chunkBytes?: number; signal?: AbortSignal; now?: () => number } = {}
): Promise<ArchiveDownload> {
  const now = opts.now ?? (() => performance.now());
  const chunk = Math.max(1, opts.chunkBytes ?? DEFAULT_CHUNK_BYTES);
  const url = info.versionDataURL ?? `/sfc/servlet.shepherd/version/download/${info.contentVersionId}`;
  const file = path.join(dir, "metadata.zip");
  const hash = createHash("md5");
  const fd = fs.openSync(file, "w");
  const start = now();
  let received = 0;
  let requests = 0;
  let total = info.contentSize > 0 ? info.contentSize : undefined;
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new DeviceHttpError("Cancelled during metadata download");
      const end = received + chunk - 1;
      const res = await session.http({
        method: "GET",
        url,
        headers: { Range: `bytes=${received}-${end}`, Accept: "*/*" },
        signal: opts.signal,
      });
      requests++;
      if (res.status !== 200 && res.status !== 206) {
        throw new DeviceHttpError(`Metadata archive download failed (HTTP ${res.status}) at byte ${received}`, res.status);
      }
      if (res.status === 200 && received > 0) {
        throw new DeviceHttpError("Server ignored the Range header mid-download (got HTTP 200 for a later chunk)");
      }
      total = contentRangeTotal(res.headers["content-range"]) ?? total;
      fs.writeSync(fd, res.body);
      hash.update(res.body);
      received += res.body.length;
      if (res.status === 200) break; // whole body returned in one response
      if (res.body.length === 0) break;
      if (total !== undefined && received >= total) break;
      if (total === undefined && res.body.length < chunk) break;
    }
  } finally {
    fs.closeSync(fd);
  }
  const md5 = hash.digest("hex");
  const seconds = (now() - start) / 1000;
  if (md5 !== info.checksum) {
    throw new DeviceHttpError(`Metadata archive MD5 mismatch: expected ${info.checksum}, got ${md5}`);
  }
  return { file, bytes: received, seconds, requests, md5 };
}

export interface MetadataFiles {
  db: Record<string, unknown>;
  dbPs: Record<string, unknown>;
  sobjects: Record<string, unknown>;
  config: Record<string, unknown>;
  permissions: Record<string, unknown>;
}

function asRecord(v: unknown): Record<string, unknown> {
  return obj(v);
}

/** Read the JSON files the schema builder needs from the archive. */
export function readMetadataFiles(zipFile: string): MetadataFiles {
  const zip = ZipReader.open(zipFile);
  try {
    return {
      db: asRecord(zip.readJson("db.json")),
      dbPs: asRecord(zip.readJson("db_ps.json")),
      sobjects: asRecord(zip.readJson("sobjects.json")),
      config: asRecord(zip.readJson("config.json")),
      permissions: asRecord(zip.readJson("permissions.json")),
    };
  } finally {
    zip.close();
  }
}

export interface MetadataResult {
  info: MetadataDownloadInfo;
  files: MetadataFiles;
  bytes: number;
  /** Network time from after the POST until the MD5 verified. */
  seconds: number;
  requests: number;
}

/** POST + chunked download + MD5 + unzip/parse, cleaning up the temp directory. */
export async function downloadMetadata(
  session: DeviceSession,
  metadataRecordId: string,
  opts: { chunkBytes?: number; signal?: AbortSignal; now?: () => number } = {}
): Promise<MetadataResult> {
  const info = await requestMetadataDownload(session, metadataRecordId, opts.signal);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsc-sim-md-"));
  try {
    const dl = await downloadArchive(session, info, dir, opts);
    const files = readMetadataFiles(dl.file);
    return { info, files, bytes: dl.bytes, seconds: dl.seconds, requests: dl.requests + 1 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
