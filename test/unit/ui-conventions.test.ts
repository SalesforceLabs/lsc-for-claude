import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

/**
 * The renderer's UI conventions, enforced — see .claude/skills/roz-ui/SKILL.md.
 * The simulated iPad draws LSC Mobile's own look and is exempt.
 */

const ROOT = path.join(__dirname, "..", "..", "src-renderer");

/** Files that draw the simulated iPad (LSC Mobile's look, not Roz's). */
const IPAD = [
  /\/Ipad[A-Z]\w*\.tsx$/,
  /\/ipad[\w-]*\.(css|ts)$/,
  /\/screens\//,
  /\/assets\//,
  /\/(action-sheets|chrome|fabs|list-controls|record|report-viewer)\.css$/,
  /\/(DashboardCards|ReportViewer|LiveInlineLwc)\.tsx$/,
];

/** App files allowed to draw their own <svg>: data charts, not icons. */
const CHART_SVG = ["components/studio/SyncOverview.tsx", "components/studio/RunReport.tsx"];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const appFiles = walk(ROOT)
  .filter((f) => /\.(css|tsx)$/.test(f))
  .filter((f) => !IPAD.some((re) => re.test(f.split(path.sep).join("/"))));
const css = appFiles.filter((f) => f.endsWith(".css"));
const tsx = appFiles.filter((f) => f.endsWith(".tsx"));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** Every line in `files` matching `re`, as "file:line  text", after dropping comments. */
function offenders(files: string[], re: RegExp, skip: (line: string, file: string) => boolean = () => false): string[] {
  return files.flatMap((f) =>
    fs
      .readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
      .split("\n")
      .flatMap((line, i) => (re.test(line) && !skip(line, rel(f)) ? [`${rel(f)}:${i + 1}  ${line.trim()}`] : []))
  );
}

describe("UI conventions", () => {
  it("finds the app's files (and leaves the iPad out)", () => {
    expect(css.map(rel)).toContain("styles.css");
    expect(tsx.map(rel)).toContain("components/studio/StudioView.tsx");
    expect(appFiles.map(rel)).not.toContain("components/studio/ipad.css");
  });

  it("has no accent stripes — tone comes from an icon, pill or tint", () => {
    expect(offenders(css, /border-(left|right|top|bottom)(-width)?\s*:\s*([2-9]|\d\d)px/)).toEqual([]);
    expect(offenders(css, /box-shadow:[^;]*inset\s+(-?[2-9]px\s+0|0\s+-?[2-9]px)\s+0\s+0?\s*[^;]/)).toEqual([]);
    expect(offenders(tsx, /border(Left|Right|Top|Bottom)\s*:\s*["'`]?[2-9]px/)).toEqual([]);
  });

  it("draws icons with Lucide, not hand-made SVGs", () => {
    expect(offenders(tsx, /<svg\b/, (_l, f) => f.startsWith("components/ui/") || CHART_SVG.includes(f))).toEqual([]);
    expect(offenders(tsx, /from\s+["'](react-icons|@heroicons|@radix-ui\/react-icons|@tabler|@phosphor)/)).toEqual([]);
  });

  it("doesn't use characters as icons", () => {
    // A JSX text node or string literal that is just a glyph: <button>×</button>, {"✓"}.
    const glyph = /(>|["'`])\s*[✓✔✗✘✕×▾▴▸◂▶◀↻⟳⚠★☆●○]\s*(<|["'`])/;
    expect(offenders(tsx, glyph)).toEqual([]);
  });

  it("takes colours from the tokens", () => {
    // Hex is for defining tokens (--name: #…); white on accent is the one literal allowed.
    expect(offenders(css, /#[0-9a-fA-F]{3,8}\b/, (l) => /^\s*--[\w-]+\s*:/.test(l) || !/#(?!fff\b|ffffff\b)[0-9a-fA-F]{3,8}\b/i.test(l))).toEqual([]);
  });

  it("takes translucent colours from the tokens too, so both palettes reach them", () => {
    expect(offenders(css, /\b(rgba?|hsla?)\(/, (l) => /^\s*--[\w-]+\s*:/.test(l))).toEqual([]);
  });

  it("gives the light palette a value for every colour token", () => {
    const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
    const light = styles.slice(styles.indexOf("@media (prefers-color-scheme: light)"));
    const names = (block: string) => [...block.matchAll(/^\s*(--[\w-]+)\s*:\s*(#|rgba?\()/gm)].map((m) => m[1]);
    // Brand hues and the scrim over images are the same in both.
    const shared = /^--(glow-|scrim-on-image$)/;
    const dark = names(styles.slice(0, styles.indexOf("\n}\n"))).filter((n) => !shared.test(n));
    expect(dark.length).toBeGreaterThan(30);
    expect(dark.filter((n) => !names(light).includes(n))).toEqual([]);
  });

  it("sizes text on the type scale", () => {
    expect(offenders(css, /font-size:\s*[0-9.]+px/)).toEqual([]);
  });

  it("has one spinner", () => {
    expect(offenders(css, /@keyframes\s+[\w-]*spin/, (_l, f) => f === "components/ui/ui.css")).toEqual([]);
    expect(offenders(tsx, /className=["'{][^"'}]*\b[\w-]*spinner\b/, (_l, f) => f.startsWith("components/ui/"))).toEqual([]);
  });
});
