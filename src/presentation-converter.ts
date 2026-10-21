/**
 * Presentation → LSC Intelligent Content Converter
 *
 * Supports multiple input formats:
 *   PPTX → PDF (LibreOffice) → per-page PDF (pdf-lib) → PNG (sips)
 *          → index.html + thumbnail.jpg → ZIP (archiver)
 *   PDF  → upload directly (single ContentVersion, Salesforce splits server-side)
 *   HTML ZIP → validate structure → upload each ZIP as a page
 *
 * Prerequisites:
 *   LibreOffice only needed for PPTX (brew install --cask libreoffice)
 *   Ghostscript needed for PDF rasterization (brew install ghostscript)
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import archiver from "archiver";
import { privateTmp } from "./private-tmp.js";

// Arguments go to the program as they are, never through a shell: a file name can't run commands.
const run = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

export type PresentationFormat = "pptx" | "pdf" | "html-zip";
export type ConversionEngine = "libreoffice" | "pandoc";

export interface SlideResult {
  slideNumber: number;
  name: string;
  zipPath: string;
  thumbnailPath: string;
}

export interface ConversionResult {
  success: boolean;
  slides: SlideResult[];
  outputDir: string;
  error?: string;
  /** Diagnostic info about the HTML export output (for debugging split issues) */
  diagnostics?: string;
}

export interface PageResult {
  pageNumber: number;
  name: string;
  filePath: string;
  contentType: string;
}

export interface PreparationResult {
  success: boolean;
  format: PresentationFormat;
  pages: PageResult[];
  outputDir?: string;
  error?: string;
  /** Diagnostic info about the conversion process */
  diagnostics?: string;
}

export interface FormatDetectionResult {
  format: PresentationFormat;
  paths: string[];
}

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Detect the presentation format from input file path(s).
 *
 * - Single .pptx → "pptx"
 * - Single .pdf → "pdf"
 * - One or more .zip → "html-zip"
 * - Single directory → expand to sorted *.zip files inside → "html-zip"
 * - Mixed types → error
 */
export function detectFormat(filePaths: string[]): FormatDetectionResult {
  if (filePaths.length === 0) {
    throw new Error("No file paths provided");
  }

  // Single path that is a directory: expand to sorted ZIPs inside
  if (filePaths.length === 1) {
    const single = filePaths[0];
    if (fs.existsSync(single) && fs.statSync(single).isDirectory()) {
      const zips = fs
        .readdirSync(single)
        .filter((f) => f.toLowerCase().endsWith(".zip"))
        .sort()
        .map((f) => path.join(single, f));

      if (zips.length === 0) {
        throw new Error(`Directory contains no .zip files: ${single}`);
      }
      return { format: "html-zip", paths: zips };
    }
  }

  // Collect extensions
  const extensions = new Set(filePaths.map((p) => path.extname(p).toLowerCase()));

  if (extensions.size > 1) {
    throw new Error(
      `Mixed file types are not supported. Got: ${[...extensions].join(", ")}. ` +
        `Provide files of a single type (.pptx, .pdf, or .zip).`
    );
  }

  const ext = [...extensions][0];

  switch (ext) {
    case ".pptx":
      if (filePaths.length > 1) {
        throw new Error("Only a single .pptx file can be uploaded at a time");
      }
      return { format: "pptx", paths: filePaths };

    case ".pdf":
      if (filePaths.length > 1) {
        throw new Error("Only a single .pdf file can be uploaded at a time");
      }
      return { format: "pdf", paths: filePaths };

    case ".zip":
      return { format: "html-zip", paths: filePaths };

    default:
      throw new Error(`Unsupported file type: ${ext}. Supported types: .pptx, .pdf, .zip`);
  }
}

// ============================================================================
// HTML ZIP Validation
// ============================================================================

/**
 * Validate that a ZIP file contains the structure expected by LSC Intelligent Content:
 * at least one .html file and a thumbnail.jpg.
 */
export async function validateHtmlZip(
  zipPath: string
): Promise<{ valid: boolean; error?: string }> {
  if (!fs.existsSync(zipPath)) {
    return { valid: false, error: `File not found: ${zipPath}` };
  }

  try {
    const { stdout } = await run("unzip", ["-l", zipPath], {
      timeout: 15000,
    });

    const lines = stdout.toLowerCase();
    const hasHtml = /\s[\w/.-]*\.html\b/.test(lines);
    const hasThumbnail = /\s[\w/.-]*thumbnail\.jpg\b/.test(lines);

    if (!hasHtml) {
      return {
        valid: false,
        error: `ZIP is missing an .html file: ${path.basename(zipPath)}`,
      };
    }

    if (!hasThumbnail) {
      return {
        valid: false,
        error: `ZIP is missing thumbnail.jpg: ${path.basename(zipPath)}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to inspect ZIP: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Preparation (top-level entry point)
// ============================================================================

/**
 * Prepare a presentation for upload. Delegates to the appropriate pipeline
 * based on the detected format.
 *
 * @param filePaths - One or more file paths (already format-detected)
 * @param format - The detected format
 * @param presentationName - Name of the presentation (used for PPTX temp dir)
 */
export async function preparePresentation(
  filePaths: string[],
  format: PresentationFormat,
  presentationName: string,
  conversionEngine: ConversionEngine = "libreoffice"
): Promise<PreparationResult> {
  // Validate all files exist
  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) {
      return {
        success: false,
        format,
        pages: [],
        error: `File not found: ${fp}`,
      };
    }
  }

  switch (format) {
    case "pptx":
      return preparePptx(filePaths[0], presentationName, conversionEngine);

    case "pdf":
      return preparePdf(filePaths[0]);

    case "html-zip":
      return prepareHtmlZips(filePaths);
  }
}

/**
 * PPTX pipeline: LibreOffice → PDF → PNG → HTML → ZIP
 */
async function preparePptx(
  pptxPath: string,
  presentationName: string,
  conversionEngine: ConversionEngine = "libreoffice"
): Promise<PreparationResult> {
  const outputDir = privateTmp(`pptx-${Date.now()}`);

  const result = await convertPptxToSlides(pptxPath, outputDir, conversionEngine);

  if (!result.success) {
    return {
      success: false,
      format: "pptx",
      pages: [],
      outputDir,
      error: result.error,
      diagnostics: result.diagnostics,
    };
  }

  const pages: PageResult[] = result.slides.map((slide) => ({
    pageNumber: slide.slideNumber,
    name: slide.name,
    filePath: slide.zipPath,
    contentType: "application/zip",
  }));

  return { success: true, format: "pptx", pages, outputDir, diagnostics: result.diagnostics };
}

/**
 * Check if Ghostscript is installed
 */
export async function checkGhostscriptInstalled(): Promise<boolean> {
  try {
    await run("gs", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rasterize a PDF so every page becomes a high-resolution image.
 * LSC iPad content player requires image-based PDFs; text/vector PDFs
 * (e.g. from Google Docs) won't render correctly on the device.
 *
 * Uses Ghostscript: gs -dNOPAUSE -dBATCH -sDEVICE=pdfimage24 -r300
 */
async function rasterizePdf(
  inputPath: string,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await run("gs", ["-dNOPAUSE", "-dBATCH", "-dQUIET", "-sDEVICE=pdfimage24", "-r300", `-sOutputFile=${outputPath}`, inputPath], {
      timeout: 120000,
    });

    if (!fs.existsSync(outputPath)) {
      return { success: false, error: "Ghostscript produced no output" };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Ghostscript rasterization failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * PDF pipeline: rasterize via Ghostscript to ensure iPad compatibility,
 * then upload the image-based PDF.
 */
async function preparePdf(pdfPath: string): Promise<PreparationResult> {
  // Check if Ghostscript is available
  const gsInstalled = await checkGhostscriptInstalled();
  if (!gsInstalled) {
    // Fall back to uploading the original PDF without rasterization
    return {
      success: true,
      format: "pdf",
      pages: [
        {
          pageNumber: 1,
          name: path.basename(pdfPath, ".pdf"),
          filePath: pdfPath,
          contentType: "application/pdf",
        },
      ],
    };
  }

  // Rasterize the PDF for iPad compatibility
  const outputDir = privateTmp(`pdf-${Date.now()}`);
  const rasterizedPath = path.join(outputDir, path.basename(pdfPath));

  const result = await rasterizePdf(pdfPath, rasterizedPath);
  if (!result.success) {
    return {
      success: false,
      format: "pdf",
      pages: [],
      outputDir,
      error: result.error,
    };
  }

  return {
    success: true,
    format: "pdf",
    pages: [
      {
        pageNumber: 1,
        name: path.basename(pdfPath, ".pdf"),
        filePath: rasterizedPath,
        contentType: "application/pdf",
      },
    ],
    outputDir,
  };
}

/**
 * HTML ZIP pipeline: validate each ZIP, return PageResult[] pointing to originals.
 */
async function prepareHtmlZips(zipPaths: string[]): Promise<PreparationResult> {
  const pages: PageResult[] = [];

  for (let i = 0; i < zipPaths.length; i++) {
    const zipPath = zipPaths[i];
    const validation = await validateHtmlZip(zipPath);

    if (!validation.valid) {
      return {
        success: false,
        format: "html-zip",
        pages: [],
        error: validation.error,
      };
    }

    pages.push({
      pageNumber: i + 1,
      name: path.basename(zipPath, ".zip"),
      filePath: zipPath,
      contentType: "application/zip",
    });
  }

  return { success: true, format: "html-zip", pages };
}

// ============================================================================
// LibreOffice Check (unchanged)
// ============================================================================

/**
 * Check if LibreOffice is installed and available on PATH
 */
export async function checkLibreOfficeInstalled(): Promise<boolean> {
  const candidates = ["soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"];

  for (const cmd of candidates) {
    try {
      await run(cmd, ["--version"]);
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

/**
 * Check if Pandoc is installed and available on PATH
 */
export async function checkPandocInstalled(): Promise<boolean> {
  try {
    await run("pandoc", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// PPTX Conversion
// ============================================================================

/**
 * Resolve the soffice binary path
 */
async function getSofficePath(): Promise<string> {
  try {
    await run("soffice", ["--version"]);
    return "soffice";
  } catch {
    // fall through
  }

  const macPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  try {
    await run(macPath, ["--version"]);
    return macPath;
  } catch {
    throw new Error("LibreOffice not found. Install it with: brew install --cask libreoffice");
  }
}

/**
 * Convert a PPTX file into per-slide ZIP packages for LSC Intelligent Content.
 *
 * @param pptxPath - Absolute path to the .pptx file
 * @param outputDir - Directory to write output (created if missing)
 * @returns ConversionResult with array of slide info and ZIP paths
 */
export async function convertPptxToSlides(
  pptxPath: string,
  outputDir: string,
  conversionEngine: ConversionEngine = "libreoffice"
): Promise<ConversionResult> {
  if (!fs.existsSync(pptxPath)) {
    return { success: false, slides: [], outputDir, error: `File not found: ${pptxPath}` };
  }

  const ext = path.extname(pptxPath).toLowerCase();
  if (ext !== ".pptx") {
    return { success: false, slides: [], outputDir, error: `File must be .pptx (got ${ext})` };
  }

  if (conversionEngine === "pandoc") {
    return convertPptxViaPandocHtml5(pptxPath, outputDir);
  }

  return convertPptxViaLibreOfficeHtml(pptxPath, outputDir);
}

// ============================================================================
// LibreOffice SVG Pipeline (default)
// ============================================================================

/**
 * Convert PPTX to HTML5 slides using LibreOffice SVG export.
 *
 * Pipeline:
 *   PPTX → PDF → split per-page PDFs → SVG per slide (draw_svg_Export)
 *        → wrap each SVG in HTML → package with thumbnail into ZIP
 *
 * SVG preserves full visual fidelity: fonts (embedded), colors, shapes,
 * backgrounds, gradients, and positioning — all as scalable vector graphics.
 * SVG is natively supported in WKWebView on iPad.
 *
 * PDF is used as an intermediate for reliable per-slide splitting (pdf-lib),
 * NOT for the final content. Each per-page PDF is converted to SVG individually
 * by LibreOffice, so we get exactly one SVG per slide.
 */
async function convertPptxViaLibreOfficeHtml(
  pptxPath: string,
  outputDir: string
): Promise<ConversionResult> {
  const soffice = await getSofficePath();

  const htmlDir = path.join(outputDir, "html");
  const svgDir = path.join(outputDir, "svg");
  const zipDir = path.join(outputDir, "zip");
  const thumbDir = path.join(outputDir, "thumbnails");
  const pdfDir = path.join(outputDir, "pdf");

  for (const dir of [outputDir, htmlDir, svgDir, zipDir, thumbDir, pdfDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Step 1: PPTX → PDF via LibreOffice
  const pdfPath = path.join(pdfDir, path.basename(pptxPath, ".pptx") + ".pdf");
  try {
    await run(soffice, ["--headless", "--convert-to", "pdf", "--outdir", pdfDir, pptxPath], {
      timeout: 120000,
    });
  } catch (error) {
    return {
      success: false,
      slides: [],
      outputDir,
      error: `LibreOffice PDF conversion failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!fs.existsSync(pdfPath)) {
    return { success: false, slides: [], outputDir, error: `PDF output not found at ${pdfPath}` };
  }

  // Step 2: Split PDF into per-page files
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const slideCount = pdfDoc.getPageCount();

  if (slideCount === 0) {
    return { success: false, slides: [], outputDir, error: "PDF has no pages" };
  }

  const pagePdfPaths: string[] = [];
  for (let i = 0; i < slideCount; i++) {
    const singlePageDoc = await PDFDocument.create();
    const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
    singlePageDoc.addPage(copiedPage);
    const singlePageBytes = await singlePageDoc.save();
    const pagePdfPath = path.join(pdfDir, `slide_${i + 1}.pdf`);
    fs.writeFileSync(pagePdfPath, singlePageBytes);
    pagePdfPaths.push(pagePdfPath);
  }

  let diagnostics = `Slide count: ${slideCount}\n`;

  // Step 3: Convert each per-page PDF → SVG, wrap in HTML, generate thumbnail, package ZIP
  const slides: SlideResult[] = [];

  for (let i = 0; i < slideCount; i++) {
    const slideNum = i + 1;
    const slideName = `Slide ${slideNum}`;
    const slideDir = path.join(htmlDir, `slide_${slideNum}`);
    fs.mkdirSync(slideDir, { recursive: true });

    // Convert per-page PDF → SVG
    let svgContent: string | null = null;
    const expectedSvgPath = path.join(svgDir, `slide_${slideNum}.svg`);
    try {
      await run(soffice, ["--headless", "--convert-to", "svg", "--outdir", svgDir, pagePdfPaths[i]], { timeout: 60000 });
      // LibreOffice names the output after the input file
      const actualSvgPath = path.join(svgDir, `slide_${slideNum}.svg`);
      if (fs.existsSync(actualSvgPath)) {
        svgContent = fs.readFileSync(actualSvgPath, "utf-8");
        diagnostics += `Slide ${slideNum}: SVG OK (${svgContent.length} chars)\n`;
      }
    } catch {
      diagnostics += `Slide ${slideNum}: SVG conversion failed, falling back to PNG\n`;
    }

    // Build the slide HTML
    if (svgContent) {
      // Inline the SVG directly into the HTML for self-contained rendering
      const html = buildSvgSlideHtml(slideName, svgContent);
      fs.writeFileSync(path.join(slideDir, "index.html"), html, "utf-8");
    } else {
      // Fallback: PNG rasterization
      try {
        const pngPath = path.join(slideDir, `temp.png`);
        await run("sips", ["-s", "format", "png", pagePdfPaths[i], "--out", pngPath], {
          timeout: 30000,
        });
        const pngBuffer = fs.readFileSync(pngPath);
        const pngBase64 = pngBuffer.toString("base64");
        fs.writeFileSync(
          path.join(slideDir, "index.html"),
          buildSlideHtml(slideName, pngBase64),
          "utf-8"
        );
        fs.unlinkSync(pngPath);
      } catch (error) {
        return {
          success: false,
          slides: [],
          outputDir,
          error: `Slide ${slideNum} conversion failed: ${error instanceof Error ? error.message : String(error)}`,
          diagnostics,
        };
      }
    }

    // Generate thumbnail from per-page PDF
    const thumbPath = path.join(thumbDir, `slide_${slideNum}.jpg`);
    try {
      const tempJpg = path.join(thumbDir, `slide_${slideNum}_temp.jpg`);
      await run("sips", ["-s", "format", "jpeg", pagePdfPaths[i], "--out", tempJpg], {
        timeout: 15000,
      });
      await run("sips", ["-z", "280", "220", tempJpg, "--out", thumbPath], { timeout: 15000 });
      if (fs.existsSync(tempJpg) && tempJpg !== thumbPath) {
        fs.unlinkSync(tempJpg);
      }
    } catch (error) {
      return {
        success: false,
        slides: [],
        outputDir,
        error: `Thumbnail generation failed for slide ${slideNum}: ${error instanceof Error ? error.message : String(error)}`,
        diagnostics,
      };
    }

    // Package into ZIP
    const zipPath = path.join(zipDir, `slide_${slideNum}.zip`);
    try {
      await createSlideZipFromDir(zipPath, slideDir, thumbPath);
    } catch (error) {
      return {
        success: false,
        slides: [],
        outputDir,
        error: `ZIP creation failed for slide ${slideNum}: ${error instanceof Error ? error.message : String(error)}`,
        diagnostics,
      };
    }

    slides.push({
      slideNumber: slideNum,
      name: slideName,
      zipPath,
      thumbnailPath: thumbPath,
    });
  }

  return { success: true, slides, outputDir, diagnostics };
}

/**
 * Build a self-contained HTML page with an inline SVG slide.
 * The SVG is embedded directly (not as an <img> src) so fonts,
 * styles, and interactive elements are fully preserved.
 */
function buildSvgSlideHtml(title: string, svgContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #fff; }
  .slide-container {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
  }
  .slide-container svg {
    max-width: 100%; max-height: 100%;
  }
</style>
</head>
<body>
<div class="slide-container">
${svgContent}
</div>
</body>
</html>`;
}

// ============================================================================
// Pandoc HTML5 Pipeline (primary)
// ============================================================================

/**
 * Convert PPTX to HTML5 slides using Pandoc with html5 output.
 *
 * Pipeline:
 *   PPTX → pandoc -t html5 --embed-resources --standalone → single HTML
 *        → split by <h2> slide headers → per-slide standalone HTML
 *        → generate thumbnails (LibreOffice PDF → sips)
 *        → package each slide: 01_slide.html + 01_thumbnail.jpg → ZIP
 *
 * Pandoc produces well-structured semantic HTML5 with embedded CSS styling.
 * Each slide is delimited by <h2 id="slide-N"> headers. We split on these
 * boundaries and wrap each slide's content in a standalone HTML document
 * preserving the original <style> block.
 */
async function convertPptxViaPandocHtml5(
  pptxPath: string,
  outputDir: string
): Promise<ConversionResult> {
  const htmlDir = path.join(outputDir, "html");
  const zipDir = path.join(outputDir, "zip");
  const thumbDir = path.join(outputDir, "thumbnails");
  const pdfDir = path.join(outputDir, "pdf");

  for (const dir of [outputDir, htmlDir, zipDir, thumbDir, pdfDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Step 1: Convert PPTX → HTML5 via Pandoc
  const pandocHtmlPath = path.join(outputDir, "pandoc_output.html");
  try {
    await run("pandoc", ["-f", "pptx", "-t", "html5", "--embed-resources", "--standalone", "--slide-level=1", "-s", pptxPath, "-o", pandocHtmlPath], {
      timeout: 120000,
    });
  } catch (error) {
    return {
      success: false,
      slides: [],
      outputDir,
      error: `Pandoc HTML5 conversion failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!fs.existsSync(pandocHtmlPath)) {
    return {
      success: false,
      slides: [],
      outputDir,
      error: "Pandoc produced no output file",
    };
  }

  // Step 2: Read and split by <h2> slide headers
  const fullHtml = fs.readFileSync(pandocHtmlPath, "utf-8");
  const slideContents = splitPandocHtml5(fullHtml);

  let diagnostics = `Pandoc HTML5 output: ${fullHtml.length} bytes\n`;
  diagnostics += `Slides found: ${slideContents.length}\n`;

  if (slideContents.length === 0) {
    return {
      success: false,
      slides: [],
      outputDir,
      error:
        "No slides found in Pandoc HTML5 output. The PPTX may have no content or an unsupported structure.",
      diagnostics,
    };
  }

  // Step 3: Generate thumbnails (LibreOffice PDF → sips)
  const thumbnailPaths = await generateThumbnails(pptxPath, pdfDir, thumbDir);

  // Step 4: Package each slide
  const slides: SlideResult[] = [];

  for (let i = 0; i < slideContents.length; i++) {
    const slideNum = i + 1;
    const slideName = `Slide ${slideNum}`;

    const slideDir = path.join(htmlDir, `slide_${slideNum}`);
    fs.mkdirSync(slideDir, { recursive: true });
    fs.writeFileSync(path.join(slideDir, "index.html"), slideContents[i], "utf-8");

    const thumbPath = thumbnailPaths[i] || path.join(thumbDir, `slide_${slideNum}.jpg`);

    const zipPath = path.join(zipDir, `slide_${slideNum}.zip`);
    try {
      await createSlideZipFromDir(zipPath, slideDir, thumbPath);
    } catch (error) {
      return {
        success: false,
        slides: [],
        outputDir,
        error: `ZIP creation failed for slide ${slideNum}: ${error instanceof Error ? error.message : String(error)}`,
        diagnostics,
      };
    }

    slides.push({
      slideNumber: slideNum,
      name: slideName,
      zipPath,
      thumbnailPath: thumbPath,
    });
  }

  return { success: true, slides, outputDir, diagnostics };
}

/**
 * Split a Pandoc HTML5 document into per-slide standalone HTML files.
 *
 * Pandoc HTML5 output has slides delimited by <h2 id="slide-N"> headers.
 * We extract the <style> block from the <head>, split the <body> content
 * by these headers, and wrap each slide section in a standalone document.
 */
function splitPandocHtml5(html: string): string[] {
  // Extract the <style> block from the document
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/i);
  const styleContent = styleMatch ? styleMatch[1] : "";

  // Extract the <body> content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return [];

  const bodyContent = bodyMatch[1];

  // Split by <h2 id="slide-N"> headers
  // Each slide starts with an <h2> and runs until the next <h2> or end of body
  const h2Regex = /<h2\s[^>]*id="[^"]*"[^>]*>/gi;
  const h2Positions: number[] = [];
  let match;

  while ((match = h2Regex.exec(bodyContent)) !== null) {
    h2Positions.push(match.index);
  }

  if (h2Positions.length === 0) {
    // Fallback: try splitting by any <h2> tags
    const anyH2Regex = /<h2[^>]*>/gi;
    while ((match = anyH2Regex.exec(bodyContent)) !== null) {
      h2Positions.push(match.index);
    }
  }

  if (h2Positions.length === 0) {
    // No slide markers found — treat entire body as a single slide
    return [wrapPandocSlide(styleContent, bodyContent.trim())];
  }

  const slideHtmls: string[] = [];

  for (let i = 0; i < h2Positions.length; i++) {
    const start = h2Positions[i];
    const end = i + 1 < h2Positions.length ? h2Positions[i + 1] : bodyContent.length;
    const slideContent = bodyContent.slice(start, end).trim();

    if (slideContent.length > 0) {
      slideHtmls.push(wrapPandocSlide(styleContent, slideContent));
    }
  }

  return slideHtmls;
}

/**
 * Wrap a single slide's content in a standalone HTML5 document
 * with the original Pandoc stylesheet preserved.
 */
function wrapPandocSlide(styleContent: string, slideContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${styleContent}
/* Single-slide overrides */
body {
  margin: 0 auto;
  padding: 2em;
  max-width: 100%;
}
</style>
</head>
<body>
${slideContent}
</body>
</html>`;
}

// ============================================================================
// Shared Thumbnail Generation
// ============================================================================

/**
 * Generate per-slide thumbnails from a PPTX file.
 * Uses: PPTX → PDF (LibreOffice) → split per-page (pdf-lib) → JPG (sips)
 *
 * @returns Array of thumbnail paths indexed by slide number (0-based)
 */
async function generateThumbnails(
  pptxPath: string,
  pdfDir: string,
  thumbDir: string
): Promise<string[]> {
  const soffice = await getSofficePath();

  // Convert PPTX → PDF
  const pdfPath = path.join(pdfDir, path.basename(pptxPath, ".pptx") + ".pdf");
  try {
    await run(soffice, ["--headless", "--convert-to", "pdf", "--outdir", pdfDir, pptxPath], {
      timeout: 120000,
    });
  } catch {
    return []; // Thumbnails are non-critical; return empty
  }

  if (!fs.existsSync(pdfPath)) {
    return [];
  }

  // Split PDF into per-page files
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pageCount = pdfDoc.getPageCount();

  const thumbnailPaths: string[] = [];

  for (let i = 0; i < pageCount; i++) {
    const singlePageDoc = await PDFDocument.create();
    const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
    singlePageDoc.addPage(copiedPage);
    const singlePageBytes = await singlePageDoc.save();
    const pagePdfPath = path.join(pdfDir, `slide_${i + 1}.pdf`);
    fs.writeFileSync(pagePdfPath, singlePageBytes);

    const thumbPath = path.join(thumbDir, `slide_${i + 1}.jpg`);
    try {
      const tempJpg = path.join(thumbDir, `slide_${i + 1}_temp.jpg`);
      await run("sips", ["-s", "format", "jpeg", pagePdfPath, "--out", tempJpg], {
        timeout: 15000,
      });
      await run("sips", ["-z", "280", "220", tempJpg, "--out", thumbPath], { timeout: 15000 });
      if (fs.existsSync(tempJpg) && tempJpg !== thumbPath) {
        fs.unlinkSync(tempJpg);
      }
      thumbnailPaths.push(thumbPath);
    } catch {
      thumbnailPaths.push(""); // Placeholder for failed thumbnail
    }
  }

  return thumbnailPaths;
}

// ============================================================================
// Helpers
// ============================================================================

function buildSlideHtml(title: string, pngBase64: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #fff; }
  .slide-container {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
  }
  .slide-container img {
    max-width: 100%; max-height: 100%;
    object-fit: contain;
  }
</style>
</head>
<body>
<div class="slide-container">
  <img src="data:image/png;base64,${pngBase64}" alt="${escapeHtml(title)}">
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createSlideZip(zipPath: string, htmlPath: string, thumbnailPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    archive.on("error", (err: Error) => reject(err));

    archive.pipe(output);
    archive.file(htmlPath, { name: "01_slide.html" });
    archive.file(thumbnailPath, { name: "01_thumbnail.jpg" });
    archive.finalize();
  });
}

/**
 * Create a ZIP from a directory of slide assets plus a thumbnail.
 * Archives the entire slideDir contents (index.html + any referenced assets)
 * and adds the thumbnail at the root level.
 */
function createSlideZipFromDir(
  zipPath: string,
  slideDir: string,
  thumbnailPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    archive.on("error", (err: Error) => reject(err));

    archive.pipe(output);

    // Rename index.html → 01_slide.html for LSC compatibility,
    // add all other assets at the root of the ZIP
    const files = fs.readdirSync(slideDir);
    for (const file of files) {
      const filePath = path.join(slideDir, file);
      if (fs.statSync(filePath).isFile()) {
        const archiveName = file === "index.html" ? "01_slide.html" : file;
        archive.file(filePath, { name: archiveName });
      }
    }

    // Add thumbnail
    if (fs.existsSync(thumbnailPath)) {
      archive.file(thumbnailPath, { name: "01_thumbnail.jpg" });
    }

    archive.finalize();
  });
}
