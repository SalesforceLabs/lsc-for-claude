import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";

const openExternal = vi.fn(async () => {});
vi.mock("electron", () => ({ shell: { openExternal: (u: string) => openExternal(u) } }));

import { isOpenableUrl, openExternalSafely } from "../../../src-electron/external-url.js";
import { appDocumentPath, documentationDir, documentationPdfPath, guideDirPath, knowledgeDir, localProtocolPath } from "../../../src-electron/app-files.js";
import { FRAME_CSP, frameDocResponse, registerFrameDoc, releaseFrameDoc } from "../../../src-electron/frame-docs.js";
import { isExternalUrl, isInlineImage, markdownUrl } from "../../../src-renderer/safe-url.js";

describe("openExternalSafely", () => {
  beforeEach(() => openExternal.mockClear());

  it("opens web and mail links", () => {
    for (const url of ["https://help.salesforce.com/x", "http://localhost:3000", "mailto:a@b.com"]) {
      expect(openExternalSafely(url)).toBe(true);
    }
    expect(openExternal).toHaveBeenCalledTimes(3);
  });

  it("refuses every other scheme", () => {
    for (const url of ["file:///etc/passwd", "smb://host/share", "javascript:alert(1)", "vscode://x", "ms-msdt:/id", "not a url", 42]) {
      expect(isOpenableUrl(url)).toBe(false);
      expect(openExternalSafely(url)).toBe(false);
    }
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("app documents", () => {
  const doc = path.join(knowledgeDir, "troubleshooting");

  it("accepts files in the knowledge base", () => {
    expect(appDocumentPath(path.join(doc, "common-issues.md"))).toBe(path.join(doc, "common-issues.md"));
  });

  it("refuses paths outside it, including traversal and the folder itself", () => {
    expect(appDocumentPath("/etc/passwd")).toBeNull();
    expect(appDocumentPath(path.join(knowledgeDir, "..", "package.json"))).toBeNull();
    expect(appDocumentPath(knowledgeDir)).toBeNull();
    expect(appDocumentPath(path.join(knowledgeDir + "-evil", "x.md"))).toBeNull();
    expect(appDocumentPath(undefined)).toBeNull();
  });

  it("takes PDFs by bare file name only", () => {
    expect(documentationPdfPath("SE LSC Mobile Setup and Configuration Guide.pdf")).toBe(path.join(documentationDir, "SE LSC Mobile Setup and Configuration Guide.pdf"));
    expect(documentationPdfPath("../secret.pdf")).toBeNull();
    expect(documentationPdfPath("sub/x.pdf")).toBeNull();
    expect(documentationPdfPath("x.txt")).toBeNull();
  });

  it("takes guide slugs only", () => {
    expect(guideDirPath("mobile-setup")).toBe(path.join(knowledgeDir, "guides", "mobile-setup"));
    expect(guideDirPath("../modules")).toBeNull();
    expect(guideDirPath("a/b")).toBeNull();
  });

  it("serves only documentation/ over lsc-local, encoded traversal included", () => {
    expect(localProtocolPath("/documentation/a.pdf")).toBe(path.join(documentationDir, "a.pdf"));
    expect(localProtocolPath("/documentation/../package.json")).toBeNull();
    expect(localProtocolPath("/documentation/%2e%2e/package.json")).toBeNull();
    expect(localProtocolPath("/knowledge/x.md")).toBeNull();
    expect(localProtocolPath("/%E0%A4%A")).toBeNull();
  });
});

describe("frame documents", () => {
  it("serves a registered document with the frame policy, and 404 once released", async () => {
    const url = registerFrameDoc("<p>hi</p>")!;
    expect(url).toMatch(/^lsc-frame:\/\/doc\/[0-9a-f-]{36}$/);
    const res = frameDocResponse(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBe(FRAME_CSP);
    expect(await res.text()).toBe("<p>hi</p>");
    releaseFrameDoc(url);
    expect(frameDocResponse(url).status).toBe(404);
  });

  it("keeps the frame off the network", () => {
    expect(FRAME_CSP).toContain("connect-src 'none'");
    expect(FRAME_CSP).toContain("form-action 'none'");
    expect(FRAME_CSP).toContain("frame-src 'none'");
  });

  it("drops the oldest documents past its cap", () => {
    const first = registerFrameDoc("first")!;
    for (let i = 0; i < 40; i++) registerFrameDoc(String(i));
    expect(frameDocResponse(first).status).toBe(404);
  });

  it("refuses anything but HTML text and unknown ids", () => {
    expect(registerFrameDoc(undefined)).toBeNull();
    expect(frameDocResponse("lsc-frame://doc/nope").status).toBe(404);
    expect(frameDocResponse("lsc-frame://other/x").status).toBe(404);
  });
});

describe("reply links", () => {
  it("keeps app, web, mail and anchor links", () => {
    for (const url of ["lsc-file:///x.md", "lsc-section://g/s", "lsc-pdf://a.pdf#2", "https://a.com", "mailto:x@y.z", "#top"]) expect(markdownUrl(url)).toBe(url);
  });

  it("drops script, data, file and custom schemes", () => {
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vscode://x", "lsc-local://file/x"]) expect(markdownUrl(url)).toBe("");
  });

  it("opens only web and mail links outside the app", () => {
    expect(isExternalUrl("https://a.com")).toBe(true);
    expect(isExternalUrl("lsc-file:///x")).toBe(false);
  });

  it("shows only images carried in the reply", () => {
    expect(isInlineImage("data:image/png;base64,AAA")).toBe(true);
    expect(isInlineImage("data:image/svg+xml;base64,AAA")).toBe(false);
    expect(isInlineImage("https://evil.example/pixel.gif?d=secret")).toBe(false);
  });
});
