import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("util")>();
  const mockExecAsync = vi.fn();
  return {
    ...actual,
    promisify: vi.fn(() => mockExecAsync),
    __mockExecAsync: mockExecAsync,
  };
});

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

const { existsSync, statSync, readdirSync } = await import("fs");
const mockExistsSync = vi.mocked(existsSync);
const mockStatSync = vi.mocked(statSync);
const mockReaddirSync = vi.mocked(readdirSync);

// Get the mockExecAsync from our mock
const utilModule = await import("util");
const mockExecAsync = (utilModule as any).__mockExecAsync;

const {
  detectFormat,
  validateHtmlZip,
  preparePresentation,
  checkLibreOfficeInstalled,
  checkGhostscriptInstalled,
  checkPandocInstalled,
} = await import("../../src/presentation-converter.js");

describe("presentation-converter.ts", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(statSync).mockReset();
    vi.mocked(readdirSync).mockReset();
    mockExecAsync.mockReset();
  });

  // ==========================================================================
  // detectFormat
  // ==========================================================================
  describe("detectFormat()", () => {
    it("detects PPTX format", () => {
      const result = detectFormat(["/path/to/slides.pptx"]);
      expect(result.format).toBe("pptx");
      expect(result.paths).toEqual(["/path/to/slides.pptx"]);
    });

    it("detects PDF format", () => {
      const result = detectFormat(["/path/to/doc.pdf"]);
      expect(result.format).toBe("pdf");
      expect(result.paths).toEqual(["/path/to/doc.pdf"]);
    });

    it("detects HTML-ZIP format for single zip", () => {
      const result = detectFormat(["/path/to/slide.zip"]);
      expect(result.format).toBe("html-zip");
    });

    it("detects HTML-ZIP format for multiple zips", () => {
      const result = detectFormat(["/path/a.zip", "/path/b.zip"]);
      expect(result.format).toBe("html-zip");
      expect(result.paths.length).toBe(2);
    });

    it("throws for empty input", () => {
      expect(() => detectFormat([])).toThrow("No file paths");
    });

    it("throws for multiple PPTX files", () => {
      expect(() =>
        detectFormat(["/a.pptx", "/b.pptx"])
      ).toThrow("single .pptx");
    });

    it("throws for mixed file types", () => {
      expect(() =>
        detectFormat(["/a.pptx", "/b.pdf"])
      ).toThrow("Mixed file types");
    });

    it("throws for unknown extension", () => {
      expect(() => detectFormat(["/a.docx"])).toThrow("Unsupported file type");
    });

    it("expands directory to sorted zip files", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockReaddirSync.mockReturnValue(["c.zip", "a.zip", "b.zip"] as any);

      const result = detectFormat(["/slides-dir"]);
      expect(result.format).toBe("html-zip");
      expect(result.paths).toEqual([
        "/slides-dir/a.zip",
        "/slides-dir/b.zip",
        "/slides-dir/c.zip",
      ]);
    });

    it("throws for directory with no zips", () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);
      mockReaddirSync.mockReturnValue(["readme.txt"] as any);

      expect(() => detectFormat(["/empty-dir"])).toThrow("no .zip files");
    });
  });

  // ==========================================================================
  // checkLibreOfficeInstalled / checkGhostscriptInstalled / checkPandocInstalled
  // ==========================================================================
  describe("checkLibreOfficeInstalled()", () => {
    it("returns true when soffice is available", async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: "LibreOffice 7.6" });
      const result = await checkLibreOfficeInstalled();
      expect(result).toBe(true);
    });

    it("returns false when neither candidate exists", async () => {
      mockExecAsync.mockRejectedValue(new Error("not found"));
      const result = await checkLibreOfficeInstalled();
      expect(result).toBe(false);
    });
  });

  describe("checkGhostscriptInstalled()", () => {
    it("returns true when gs is available", async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: "10.0.0" });
      const result = await checkGhostscriptInstalled();
      expect(result).toBe(true);
    });

    it("returns false when gs is not found", async () => {
      mockExecAsync.mockRejectedValueOnce(new Error("not found"));
      const result = await checkGhostscriptInstalled();
      expect(result).toBe(false);
    });
  });

  describe("checkPandocInstalled()", () => {
    it("returns true when pandoc is available", async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: "pandoc 3.1" });
      const result = await checkPandocInstalled();
      expect(result).toBe(true);
    });

    it("returns false when pandoc is not found", async () => {
      mockExecAsync.mockRejectedValueOnce(new Error("not found"));
      const result = await checkPandocInstalled();
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // validateHtmlZip
  // ==========================================================================
  describe("validateHtmlZip()", () => {
    it("passes the file name as an argument, never through a shell", async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecAsync.mockResolvedValueOnce({ stdout: "  100  index.html\n  5000  thumbnail.jpg\n" });
      const name = '/path/x"; touch /tmp/pwned; ".zip';
      await validateHtmlZip(name);
      expect(mockExecAsync).toHaveBeenCalledWith("unzip", ["-l", name], expect.anything());
    });

    it("returns valid for correct ZIP structure", async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecAsync.mockResolvedValueOnce({
        stdout:
          "  Archive:  slide1.zip\n  Length      Name\n  100  index.html\n  5000  thumbnail.jpg\n",
      });

      const result = await validateHtmlZip("/path/slide1.zip");
      expect(result.valid).toBe(true);
    });

    it("returns invalid when .html missing", async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecAsync.mockResolvedValueOnce({
        stdout:
          "  Archive:  slide1.zip\n  Length      Name\n  5000  thumbnail.jpg\n",
      });

      const result = await validateHtmlZip("/path/slide1.zip");
      expect(result.valid).toBe(false);
      expect(result.error).toContain(".html");
    });

    it("returns invalid when thumbnail.jpg missing", async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecAsync.mockResolvedValueOnce({
        stdout:
          "  Archive:  slide1.zip\n  Length      Name\n  100  index.html\n",
      });

      const result = await validateHtmlZip("/path/slide1.zip");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("thumbnail.jpg");
    });

    it("returns invalid when file not found", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await validateHtmlZip("/path/missing.zip");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  // ==========================================================================
  // preparePresentation
  // ==========================================================================
  describe("preparePresentation()", () => {
    it("returns error when file does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await preparePresentation(
        ["/missing.pdf"],
        "pdf",
        "Test Presentation"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });
});
