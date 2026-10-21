import { realpathSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

/**
 * The app's own documents, which the renderer may ask to read or open: the knowledge base (cited in
 * replies as lsc-file:// links) and the PDFs in documentation/. Paths reach the main process from the
 * renderer, and links in replies are model output, so every path is resolved here and refused unless
 * it lands inside one of these folders.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const knowledgeDir = path.join(appRoot, "knowledge");
export const documentationDir = path.join(appRoot, "documentation");

/** Real path (symlinks followed) when it exists, else the resolved path. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `file` resolves to somewhere inside `dir` (not `dir` itself). */
export function isInside(file: string, dir: string): boolean {
  const rel = path.relative(real(dir), real(file));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** The path when it's a file in the knowledge base or documentation/, else null. */
export function appDocumentPath(file: unknown): string | null {
  if (typeof file !== "string" || !file) return null;
  const resolved = path.resolve(file);
  return isInside(resolved, knowledgeDir) || isInside(resolved, documentationDir) ? resolved : null;
}

/** One PDF in documentation/ by its file name (no folders), else null. */
export function documentationPdfPath(name: unknown): string | null {
  if (typeof name !== "string" || !/^[\w][\w .()'-]*\.pdf$/i.test(name)) return null;
  const file = path.join(documentationDir, name);
  return isInside(file, documentationDir) ? file : null;
}

/** A guide's folder in knowledge/guides by its slug, else null. */
export function guideDirPath(slug: unknown): string | null {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;
  return path.join(knowledgeDir, "guides", slug);
}

/** A file under the app folder for the lsc-local: protocol (only documentation/ is served), else null. */
export function localProtocolPath(urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  const file = path.resolve(appRoot, "." + path.posix.normalize("/" + decoded));
  return isInside(file, documentationDir) ? file : null;
}

/**
 * Whether `file` is a ZIP in the engine's metadata cache download folder,
 * `<tmp>/lsc-<user>/lsc-studio-cache-zips/<version>/<file>.zip` (src/private-tmp.ts picks the `lsc-` folder),
 * with links followed so it can't point elsewhere.
 */
export function isEngineZipPath(file: unknown, tmp: string = os.tmpdir()): boolean {
  if (typeof file !== "string" || !file.endsWith(".zip")) return false;
  const rel = path.relative(real(tmp), path.join(real(path.dirname(file)), path.basename(file)));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  return parts.length === 4 && parts[0].startsWith("lsc-") && parts[1] === "lsc-studio-cache-zips";
}
