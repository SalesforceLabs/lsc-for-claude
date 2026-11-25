import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getCitation } from "./citation-map.js";
import { searchGuides } from "./guide-loader.js";
import { matchText, sectionAround, type TextMatch } from "./search-match.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths to knowledge base directories
const KNOWLEDGE_BASE_PATH = join(__dirname, "..", "knowledge", "modules");
const HELP_DOCS_PATH = join(__dirname, "..", "knowledge", "help");
const EXERCISES_PATH = join(__dirname, "..", "knowledge", "exercises");
const GUIDES_PATH = join(__dirname, "..", "knowledge", "guides");
const TROUBLESHOOTING_PATH = join(__dirname, "..", "knowledge", "troubleshooting");

export interface ModuleDoc {
  slug: string;
  title: string;
  content: string;
  files: string[];
}

export interface DocFile {
  slug: string;
  title: string;
  content: string;
  source: "help" | "exercises" | "guides" | "troubleshooting";
}

export interface KnowledgeBase {
  modules: Map<string, ModuleDoc>;
  allContent: string;
}

export interface SearchResult {
  module: string;
  title: string;
  excerpt: string;
  source?: string;
  sourceFile?: string;
  /** Guide section fields — present when source === "guide-section" */
  guideSlug?: string;
  sectionSlug?: string;
  startPage?: number;
  endPage?: number;
  matchPage?: number;
  pdfFileName?: string;
  /** Match strength from `matchText`; results are sorted by it. */
  score?: number;
  /** The markdown section the match is in (cut to `SECTION_LIMIT`), for the top results. */
  section?: string;
}

/** Characters of a matching markdown section the top search results carry. */
export const SECTION_LIMIT = 4_000;

/**
 * Convert a slug to a human-readable title
 */
function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Load all markdown files from a module directory
 */
function loadModuleContent(modulePath: string): string {
  const files = readdirSync(modulePath).filter((f) => f.endsWith(".md") && f !== "_index.md");

  let content = "";
  for (const file of files) {
    const filePath = join(modulePath, file);
    const fileContent = readFileSync(filePath, "utf-8");
    const fileName = basename(file, ".md");
    content += `\n\n## ${slugToTitle(fileName)}\n\n${fileContent}`;
  }

  return content;
}

/**
 * Load the entire knowledge base
 */
export function loadKnowledgeBase(): KnowledgeBase {
  const modules = new Map<string, ModuleDoc>();
  let allContent = "# LSC Knowledge Base\n\n";

  if (!existsSync(KNOWLEDGE_BASE_PATH)) {
    console.error(`Knowledge base path not found: ${KNOWLEDGE_BASE_PATH}`);
    return { modules, allContent };
  }

  const moduleDirs = readdirSync(KNOWLEDGE_BASE_PATH, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const moduleSlug of moduleDirs) {
    const modulePath = join(KNOWLEDGE_BASE_PATH, moduleSlug);
    const title = slugToTitle(moduleSlug);

    const files = readdirSync(modulePath).filter((f) => f.endsWith(".md") && f !== "_index.md");

    const content = loadModuleContent(modulePath);

    modules.set(moduleSlug, {
      slug: moduleSlug,
      title,
      content,
      files,
    });

    allContent += `\n\n# ${title}\n${content}`;
  }

  return { modules, allContent };
}

/**
 * Get list of available modules
 */
export function getModuleList(): { slug: string; title: string; fileCount: number }[] {
  if (!existsSync(KNOWLEDGE_BASE_PATH)) {
    return [];
  }

  const moduleDirs = readdirSync(KNOWLEDGE_BASE_PATH, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  return moduleDirs.map((slug) => {
    const modulePath = join(KNOWLEDGE_BASE_PATH, slug);
    const files = readdirSync(modulePath).filter((f) => f.endsWith(".md") && f !== "_index.md");
    return {
      slug,
      title: slugToTitle(slug),
      fileCount: files.length,
    };
  });
}

/**
 * Get content for a specific module
 */
export function getModuleContent(moduleSlug: string): string | null {
  const modulePath = join(KNOWLEDGE_BASE_PATH, moduleSlug);

  if (!existsSync(modulePath)) {
    return null;
  }

  const title = slugToTitle(moduleSlug);
  const content = loadModuleContent(modulePath);

  return `# ${title}\n\n${content}`;
}

/**
 * Search knowledge base for a term (searches all sources)
 */
export function searchKnowledge(query: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Search modules
  if (existsSync(KNOWLEDGE_BASE_PATH)) {
    const moduleDirs = readdirSync(KNOWLEDGE_BASE_PATH, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const moduleSlug of moduleDirs) {
      const modulePath = join(KNOWLEDGE_BASE_PATH, moduleSlug);
      const files = readdirSync(modulePath).filter((f) => f.endsWith(".md") && f !== "_index.md");

      for (const file of files) {
        const filePath = join(modulePath, file);
        const content = readFileSync(filePath, "utf-8");
        const title = slugToTitle(basename(file, ".md"));
        const match = matchText(content, query, title);
        if (match) {
          results.push({
            module: moduleSlug,
            title,
            excerpt: extractExcerpt(content, match),
            section: sectionAround(content, match.index, SECTION_LIMIT),
            source: "modules",
            sourceFile: basename(file, ".md"),
            score: match.score,
          });
        }
      }
    }
  }

  // Search help docs
  searchDirectory(HELP_DOCS_PATH, query, "help", results);

  // Search exercises
  searchDirectory(EXERCISES_PATH, query, "exercises", results);

  // Search standalone guide files (only files are read, so section directories like admin-guide/ are skipped)
  searchDirectory(GUIDES_PATH, query, "guides", results);

  // Search guide sections (section-chunked PDFs)
  const guideResults = searchGuides(query);
  for (const gr of guideResults) {
    results.push({
      module: gr.guideSlug,
      title: gr.sectionTitle,
      excerpt: gr.excerpt,
      source: "guide-section",
      sourceFile: gr.sectionSlug,
      guideSlug: gr.guideSlug,
      sectionSlug: gr.sectionSlug,
      startPage: gr.startPage,
      endPage: gr.endPage,
      matchPage: gr.matchPage,
      pdfFileName: gr.pdfFileName,
      score: gr.score,
    });
  }

  // Search troubleshooting
  searchDirectory(TROUBLESHOOTING_PATH, query, "troubleshooting", results);

  // Sort by relevance: the exact phrase, then more of the query's words (title words count
  // extra), then official guide sections over other matches.
  results.sort((a, b) => {
    const byScore = (b.score ?? 0) - (a.score ?? 0);
    if (Math.abs(byScore) >= 1) return byScore;
    const aGuide = a.source === "guide-section" ? 1 : 0;
    const bGuide = b.source === "guide-section" ? 1 : 0;
    return bGuide - aGuide;
  });

  return results;
}

/**
 * Helper to extract excerpt around a match
 */
function extractExcerpt(content: string, match: TextMatch): string {
  const start = Math.max(0, match.index - 100);
  const end = Math.min(content.length, match.index + Math.max(match.length, 200) + 100);
  let excerpt = content.slice(start, end);

  if (start > 0) excerpt = "..." + excerpt;
  if (end < content.length) excerpt = excerpt + "...";

  return excerpt;
}

/**
 * Helper to search a directory of markdown files
 */
function searchDirectory(
  dirPath: string,
  query: string,
  source: string,
  results: SearchResult[]
): void {
  if (!existsSync(dirPath)) return;

  const files = readdirSync(dirPath, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".md"))
    .map((f) => f.name);

  for (const file of files) {
    const filePath = join(dirPath, file);
    const content = readFileSync(filePath, "utf-8");
    const title = slugToTitle(basename(file, ".md"));
    const match = matchText(content, query, title);
    if (match) {
      results.push({
        module: source,
        title,
        excerpt: extractExcerpt(content, match),
        section: sectionAround(content, match.index, SECTION_LIMIT),
        source,
        sourceFile: basename(file, ".md"),
        score: match.score,
      });
    }
  }
}

// ============================================================================
// HELP DOCUMENTATION FUNCTIONS
// ============================================================================

/**
 * Get list of help documentation files
 */
export function getHelpDocList(): { slug: string; title: string }[] {
  if (!existsSync(HELP_DOCS_PATH)) {
    return [];
  }

  const files = readdirSync(HELP_DOCS_PATH).filter((f) => f.endsWith(".md"));

  return files.map((file) => ({
    slug: basename(file, ".md"),
    title: slugToTitle(basename(file, ".md")),
  }));
}

/**
 * Get content of a specific help document
 */
export function getHelpDocContent(slug: string): string | null {
  const filePath = join(HELP_DOCS_PATH, `${slug}.md`);

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, "utf-8");
}

// ============================================================================
// EXERCISES FUNCTIONS
// ============================================================================

/**
 * Get list of exercise files
 */
export function getExerciseList(): { slug: string; title: string }[] {
  if (!existsSync(EXERCISES_PATH)) {
    return [];
  }

  const files = readdirSync(EXERCISES_PATH).filter((f) => f.endsWith(".md"));

  return files.map((file) => ({
    slug: basename(file, ".md"),
    title: slugToTitle(basename(file, ".md")),
  }));
}

/**
 * Get content of a specific exercise
 */
export function getExerciseContent(slug: string): string | null {
  const filePath = join(EXERCISES_PATH, `${slug}.md`);

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, "utf-8");
}

// ============================================================================
// GUIDES FUNCTIONS
// ============================================================================

/**
 * Get list of guide files
 */
export function getGuideList(): { slug: string; title: string }[] {
  if (!existsSync(GUIDES_PATH)) {
    return [];
  }

  const files = readdirSync(GUIDES_PATH, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".md"))
    .map((f) => f.name);

  return files.map((file) => ({
    slug: basename(file, ".md"),
    title: slugToTitle(basename(file, ".md")),
  }));
}

/**
 * Get content of a specific guide
 */
export function getGuideContent(slug: string): string | null {
  const filePath = join(GUIDES_PATH, `${slug}.md`);

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, "utf-8");
}

// ============================================================================
// TROUBLESHOOTING FUNCTIONS
// ============================================================================

/**
 * Get list of troubleshooting files
 */
export function getTroubleshootingList(): { slug: string; title: string }[] {
  if (!existsSync(TROUBLESHOOTING_PATH)) {
    return [];
  }

  const files = readdirSync(TROUBLESHOOTING_PATH).filter((f) => f.endsWith(".md"));

  return files.map((file) => ({
    slug: basename(file, ".md"),
    title: slugToTitle(basename(file, ".md")),
  }));
}

/**
 * Get content of a specific troubleshooting document
 */
export function getTroubleshootingContent(slug: string): string | null {
  const filePath = join(TROUBLESHOOTING_PATH, `${slug}.md`);

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, "utf-8");
}

/**
 * Get the common issues document (convenience function)
 */
export function getCommonIssues(): string | null {
  return getTroubleshootingContent("common-issues");
}

/**
 * Resolve the local file path for a knowledge document.
 */
function resolveFilePath(sourceFile: string, moduleName?: string): string {
  if (moduleName) {
    return join(KNOWLEDGE_BASE_PATH, moduleName, `${sourceFile}.md`);
  }
  // Check each non-module directory
  for (const dir of [HELP_DOCS_PATH, GUIDES_PATH, EXERCISES_PATH, TROUBLESHOOTING_PATH]) {
    const candidate = join(dir, `${sourceFile}.md`);
    if (existsSync(candidate)) return candidate;
  }
  return join(KNOWLEDGE_BASE_PATH, `${sourceFile}.md`);
}

/**
 * Format a citation block for a knowledge base response.
 *
 * Returns a fenced citation block that Claude should preserve verbatim.
 * Includes both source label and a link (URL or local file path).
 *
 * @param sourceFile - slug of the originating file (e.g. "account-management")
 * @param moduleName - optional module/directory name for PM Enablement context
 * @returns a formatted citation block
 */
/**
 * Format a citation block for a guide section search result.
 *
 * Produces two links:
 * - lsc-section:// — opens the section in the DocViewerPanel
 * - lsc-pdf:// — opens the actual PDF file
 */
export function formatGuideSectionCitation(result: SearchResult): string {
  const { guideSlug, sectionSlug, matchPage, startPage, endPage, pdfFileName } = result;
  if (!guideSlug || !sectionSlug) return "";

  const guideLabel = guideSlug === "admin-guide" ? "Administer LSC" : "LSC Developer Guide";

  const pageInfo = matchPage ? ` (page ${matchPage})` : "";
  const sectionUrl = `lsc-section://${guideSlug}/${sectionSlug}?page=${matchPage || startPage}&highlight=${encodeURIComponent(result.title)}`;
  const pdfUrl = pdfFileName ? `lsc-pdf://${pdfFileName}?page=${matchPage || startPage}` : "";

  let block = `\n\n> **Source:** ${guideLabel} — ${result.title}${pageInfo}`;
  block += `\n>\n> **Section:** [${result.title}, pages ${startPage}-${endPage}](${sectionUrl})`;
  if (pdfUrl) {
    block += `\n>\n> **PDF:** [Open in PDF viewer](${pdfUrl})`;
  }
  return block;
}

export function formatCitation(sourceFile: string, moduleName?: string): string {
  const info = getCitation(sourceFile, moduleName);
  const filePath = resolveFilePath(sourceFile, moduleName);

  const fileLink = `[${basename(filePath)}](lsc-file://${filePath})`;

  if (!info) {
    const label = slugToTitle(sourceFile);
    const category = moduleName ? "PM Enablement" : "Documentation";
    const prefix = moduleName
      ? `${category} — ${slugToTitle(moduleName)} > ${label}`
      : `${category} — ${label}`;
    return `\n\n> **Source:** ${prefix}\n>\n> **File:** ${fileLink}`;
  }

  let block = `\n\n> **Source:** ${info.category} — ${info.label}`;
  if (info.url) {
    block += `\n>\n> **Link:** [${info.url}](${info.url})`;
  }
  block += `\n>\n> **File:** ${fileLink}`;
  return block;
}
