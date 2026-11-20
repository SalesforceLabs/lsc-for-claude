/**
 * Guide Loader — loads section-chunked guide manifests and provides search.
 *
 * Each guide directory contains a _manifest.json and numbered section .md files.
 * Sections contain <!-- page:N --> markers for page-level navigation.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { matchText } from "./search-match.js";
import { join, basename } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GUIDES_PATH = join(__dirname, "..", "knowledge", "guides");

export interface ManifestSection {
  slug: string;
  title: string;
  startPage: number;
  endPage: number;
  file: string;
}

export interface GuideManifest {
  guideTitle: string;
  guideSlug: string;
  pdfFileName: string;
  totalPages: number;
  sections: ManifestSection[];
}

export interface GuideSectionSearchResult {
  guideSlug: string;
  guideTitle: string;
  sectionSlug: string;
  sectionTitle: string;
  startPage: number;
  endPage: number;
  matchPage: number;
  pdfFileName: string;
  excerpt: string;
  /** Match strength from `matchText`. */
  score: number;
}

// Cache manifests and section content
const manifestCache = new Map<string, GuideManifest>();
const sectionContentCache = new Map<string, string>(); // key: "guideSlug/sectionSlug"

/**
 * Load all guide manifests from the guides directory.
 */
export function loadGuideManifests(): GuideManifest[] {
  if (manifestCache.size > 0) {
    return Array.from(manifestCache.values());
  }

  if (!existsSync(GUIDES_PATH)) return [];

  const entries = readdirSync(GUIDES_PATH, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(GUIDES_PATH, entry.name, "_manifest.json");
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest: GuideManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      manifestCache.set(manifest.guideSlug, manifest);
    } catch {
      // Skip invalid manifests
    }
  }

  return Array.from(manifestCache.values());
}

/**
 * Get a specific section's content, with caching.
 */
export function getGuideSection(
  guideSlug: string,
  sectionSlug: string
): { content: string; manifest: GuideManifest; section: ManifestSection } | null {
  const manifests = loadGuideManifests();
  const manifest = manifests.find((m) => m.guideSlug === guideSlug);
  if (!manifest) return null;

  const section = manifest.sections.find((s) => s.slug === sectionSlug);
  if (!section) return null;

  const cacheKey = `${guideSlug}/${sectionSlug}`;
  let content = sectionContentCache.get(cacheKey);

  if (!content) {
    const filePath = join(GUIDES_PATH, guideSlug, section.file);
    if (!existsSync(filePath)) return null;
    content = readFileSync(filePath, "utf-8");
    sectionContentCache.set(cacheKey, content);
  }

  return { content, manifest, section };
}

/**
 * List sections for a guide.
 */
export function listGuideSections(guideSlug: string): ManifestSection[] | null {
  const manifests = loadGuideManifests();
  const manifest = manifests.find((m) => m.guideSlug === guideSlug);
  return manifest?.sections ?? null;
}

/**
 * Determine the page number nearest to a match offset in section content.
 * Looks for <!-- page:N --> markers before the match position.
 */
function findMatchPage(content: string, matchOffset: number, startPage: number): number {
  const pageMarkerRegex = /<!-- page:(\d+) -->/g;
  let lastPage = startPage;
  let match: RegExpExecArray | null;

  while ((match = pageMarkerRegex.exec(content)) !== null) {
    if (match.index > matchOffset) break;
    lastPage = parseInt(match[1], 10);
  }

  return lastPage;
}

/**
 * Search all guide sections for a query string.
 * Returns results with the matching page number.
 */
export function searchGuides(query: string): GuideSectionSearchResult[] {
  const manifests = loadGuideManifests();
  const results: GuideSectionSearchResult[] = [];

  for (const manifest of manifests) {
    const guideDir = join(GUIDES_PATH, manifest.guideSlug);

    for (const section of manifest.sections) {
      const cacheKey = `${manifest.guideSlug}/${section.slug}`;
      let content = sectionContentCache.get(cacheKey);

      if (!content) {
        const filePath = join(guideDir, section.file);
        if (!existsSync(filePath)) continue;
        content = readFileSync(filePath, "utf-8");
        sectionContentCache.set(cacheKey, content);
      }

      const match = matchText(content, query, section.title);
      if (!match) continue;
      const matchIdx = match.index;

      // Extract excerpt around match
      const start = Math.max(0, matchIdx - 100);
      const end = Math.min(content.length, matchIdx + Math.max(match.length, 200) + 100);
      let excerpt = content.slice(start, end);
      if (start > 0) excerpt = "..." + excerpt;
      if (end < content.length) excerpt = excerpt + "...";
      // Strip page markers from excerpt
      excerpt = excerpt.replace(/<!-- page:\d+ -->/g, "").trim();

      const matchPage = findMatchPage(content, matchIdx, section.startPage);

      results.push({
        guideSlug: manifest.guideSlug,
        guideTitle: manifest.guideTitle,
        sectionSlug: section.slug,
        sectionTitle: section.title,
        startPage: section.startPage,
        endPage: section.endPage,
        matchPage,
        pdfFileName: manifest.pdfFileName,
        excerpt,
        score: match.score,
      });
    }
  }

  return results;
}
