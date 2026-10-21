/**
 * Static checks over an LSC App's files — the rules Salesforce documents for
 * inline LWCs on the iPad plus the LWC mistakes that most often break a compile.
 * Pure: no org, no compiler. Every issue carries a `fix` the builder model can act on.
 */

import { XMLParser } from "fast-xml-parser";
import {
  APP_PREFIX,
  QUICK_ACTION_PREFIX,
  type AppFile,
  type AppInput,
  type AppIssue,
} from "./types.js";

export interface LintResult {
  issues: AppIssue[];
  /** mobileHeight default from the parent's meta file. */
  mobileHeight?: number;
}

export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 200 * 1024;
const LARGE_FILE_BYTES = 60 * 1024;

const HOME_TARGETS = ["lightning__HomePage", "lightning__UrlAddressable"];
const RECORD_TARGETS = ["lightning__RecordPage", "lightning__RecordAction"];
const ACTION_TARGETS = ["lightning__RecordAction"];
const TAB_TARGETS = ["lightning__AppPage"];

/** Meta targets a parent must declare, the target that carries mobileHeight (none for a quick action), and every target a kind may use. */
const TARGET_SPEC = {
  home: { required: HOME_TARGETS, page: "lightning__HomePage" },
  record: { required: RECORD_TARGETS, page: "lightning__RecordPage" },
  action: { required: ACTION_TARGETS, page: null },
  tab: { required: TAB_TARGETS, page: "lightning__AppPage" },
} as const;
const PAGE_TARGETS = [
  "lightning__HomePage",
  "lightning__RecordPage",
  "lightning__RecordAction",
  "lightning__AppPage",
];
const KIND_LABEL = {
  home: "Home page",
  record: "record page",
  action: "quick action",
  tab: "navigation tab",
} as const;

/** Line (1-based) of `index` in `source`. */
export function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Same text with `//` and block comments blanked (newlines kept, so lines still match). */
export function blankJsComments(js: string): string {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (_m, p: string) => p);
}

function blankHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
type Node = Record<string, unknown>;

interface ParsedMeta {
  ok: boolean;
  error?: string;
  apiVersion?: string;
  isExposed?: boolean;
  masterLabel?: string;
  targets: string[];
  configs: {
    targets: string[];
    properties: { name: string; type: string; default?: string }[];
    actionType?: string;
  }[];
}

export function parseMeta(xml: string): ParsedMeta {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
  });
  let doc: Node;
  try {
    doc = parser.parse(xml, true) as Node;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      targets: [],
      configs: [],
    };
  }
  const bundle = doc.LightningComponentBundle as Node | undefined;
  if (!bundle || typeof bundle !== "object")
    return {
      ok: false,
      error: "The root element must be <LightningComponentBundle>.",
      targets: [],
      configs: [],
    };
  const targets = asArray(
    (bundle.targets as Node | undefined)?.target as string | string[] | undefined
  ).map((t) => String(t).trim());
  const configs = asArray(
    (bundle.targetConfigs as Node | undefined)?.targetConfig as Node | Node[] | undefined
  ).map((c) => ({
    targets: String(c["@_targets"] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    properties: asArray(c.property as Node | Node[] | undefined).map((p) => ({
      name: String(p["@_name"] ?? ""),
      type: String(p["@_type"] ?? ""),
      ...(p["@_default"] !== undefined ? { default: String(p["@_default"]) } : {}),
    })),
    ...(c.actionType !== undefined ? { actionType: String(c.actionType) } : {}),
  }));
  return {
    ok: true,
    apiVersion: bundle.apiVersion === undefined ? undefined : String(bundle.apiVersion),
    isExposed:
      bundle.isExposed === undefined ? undefined : String(bundle.isExposed).trim() === "true",
    masterLabel: bundle.masterLabel === undefined ? undefined : String(bundle.masterLabel),
    targets,
    configs,
  };
}

/** `c/foo` imports and `<c-foo-bar>` tags of a bundle's files, as bundle names. */
function childRefs(files: AppFile[]): Map<string, { path: string; line: number }> {
  const out = new Map<string, { path: string; line: number }>();
  for (const f of files) {
    if (f.path.endsWith(".js")) {
      const js = blankJsComments(f.source);
      for (const m of js.matchAll(/\bfrom\s+["']c\/(\w+)["']/g))
        if (!out.has(m[1])) out.set(m[1], { path: f.path, line: lineAt(js, m.index ?? 0) });
    } else if (f.path.endsWith(".html")) {
      const html = blankHtmlComments(f.source);
      for (const m of html.matchAll(/<(c-[a-z0-9_-]+)[\s>/]/g)) {
        const bundle = m[1]
          .replace(/^c-/, "")
          .replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
        if (!out.has(bundle)) out.set(bundle, { path: f.path, line: lineAt(html, m.index ?? 0) });
      }
    }
  }
  return out;
}

/** The queries in `gql\`…\`` templates, with where each starts. */
export function gqlTemplates(source: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  for (const m of source.matchAll(/\bgql\s*`([\s\S]*?)`/g))
    out.push({ text: m[1], index: (m.index ?? 0) + m[0].indexOf("`") + 1 });
  return out;
}

function pushMetaIssues(
  input: AppInput,
  meta: ParsedMeta,
  path: string,
  parent: boolean,
  issues: AppIssue[]
): number | undefined {
  const add = (i: AppIssue) => issues.push({ path, ...i });
  if (!meta.ok) {
    add({
      severity: "error",
      rule: "meta.invalid-xml",
      message: `The meta file isn't valid: ${meta.error}`,
      fix: "Rewrite the .js-meta.xml from the template in the guide.",
    });
    return undefined;
  }
  if (!meta.apiVersion || !/^\d+(\.\d+)?$/.test(meta.apiVersion)) {
    add({
      severity: "error",
      rule: "meta.api-version",
      message: "The meta file needs an <apiVersion> such as 66.0.",
      fix: "Add <apiVersion>66.0</apiVersion>.",
    });
  }
  if (!parent) {
    if (meta.targets.length && meta.isExposed)
      add({
        severity: "info",
        rule: "meta.child-exposed",
        message: "A nested component doesn't need to be exposed.",
        fix: "Set <isExposed>false</isExposed> and drop its <targets>.",
      });
    return undefined;
  }
  if (meta.isExposed !== true)
    add({
      severity: "error",
      rule: "meta.not-exposed",
      message: "isExposed must be true or the component can't be placed on a page.",
      fix: "Set <isExposed>true</isExposed>.",
    });
  if (!meta.masterLabel)
    add({
      severity: "info",
      rule: "meta.label",
      message: "No <masterLabel>; the name shows as the component's label in Setup.",
      fix: "Add a <masterLabel> with a readable name.",
    });
  const spec = TARGET_SPEC[input.target];
  for (const t of spec.required) {
    if (!meta.targets.includes(t)) {
      add({
        severity: "error",
        rule:
          t === "lightning__UrlAddressable"
            ? "meta.missing-urladdressable"
            : `meta.missing-${t.replace("lightning__", "").toLowerCase()}`,
        message:
          input.target === "home"
            ? `A Home page app needs the ${t} target${t === "lightning__UrlAddressable" ? " as well as lightning__HomePage; without it the component doesn't render on mobile" : ""}.`
            : input.target === "action"
              ? "A quick action app needs the lightning__RecordAction target."
              : input.target === "tab"
                ? "A navigation tab app needs the lightning__AppPage target (the tab shows an App page that holds the component)."
                : `A record page app needs the ${t} target (with lightning__RecordPage and lightning__RecordAction together it works as a record page tab on the iPad).`,
        fix: `Add <target>${t}</target> inside <targets>.`,
      });
    }
  }
  let height: number | undefined;
  if (spec.page) {
    const pageTarget = spec.page;
    const config = meta.configs.find((c) => c.targets.includes(pageTarget));
    const prop = config?.properties.find((p) => p.name === "mobileHeight");
    if (!prop) {
      add({
        severity: "error",
        rule: "meta.mobile-height",
        message: `The ${pageTarget} targetConfig must declare an Integer property named mobileHeight; without it the org rejects the component on the page.`,
        fix: `Add <targetConfig targets="${pageTarget}"><property name="mobileHeight" type="Integer" default="480" label="Mobile Height" description="Height in pixels for mobile display" /></targetConfig>.`,
      });
    } else {
      if (!/^integer$/i.test(prop.type))
        add({
          severity: "error",
          rule: "meta.mobile-height-type",
          message: `mobileHeight must be type="Integer" (it is "${prop.type}").`,
          fix: 'Set type="Integer" on the mobileHeight property.',
        });
      const n = Number(prop.default);
      if (prop.default === undefined || !Number.isFinite(n) || n <= 0) {
        add({
          severity: "warning",
          rule: "meta.mobile-height-default",
          message:
            "mobileHeight has no numeric default; the component gets an arbitrary height on the iPad.",
          fix: 'Add default="480" (or the height you designed for) to the property.',
        });
      } else height = Math.round(n);
    }
  } else if (meta.configs.some((c) => c.properties.some((p) => p.name === "mobileHeight"))) {
    add({
      severity: "warning",
      rule: "meta.action-mobile-height",
      message:
        "A quick action opens in a full-height sheet; mobileHeight only applies to inline components.",
      fix: "Remove the mobileHeight property (and `@api mobileHeight`).",
    });
  }
  if (input.target === "record" || input.target === "action") {
    const action = meta.configs.find((c) => c.targets.includes("lightning__RecordAction"));
    if (!action || action.actionType !== "ScreenAction") {
      add({
        severity: input.target === "action" ? "error" : "warning",
        rule: input.target === "action" ? "meta.action-type" : "meta.record-action-type",
        message:
          input.target === "action"
            ? "A quick action's lightning__RecordAction targetConfig must set <actionType>ScreenAction</actionType>; without it the action doesn't open a screen."
            : "A record page app is opened by a quick action; its lightning__RecordAction targetConfig should set <actionType>ScreenAction</actionType>.",
        fix: '<targetConfig targets="lightning__RecordAction"><actionType>ScreenAction</actionType></targetConfig>',
      });
    }
  }
  if (
    input.target === "tab" &&
    !meta.targets.includes("lightning__UrlAddressable") &&
    !meta.targets.includes("lightning__Tab")
  ) {
    add({
      severity: "info",
      rule: "meta.tab-urladdressable",
      message:
        "Real nav-tab apps in LSC orgs also expose lightning__Tab and lightning__UrlAddressable.",
      fix: "Add <target>lightning__UrlAddressable</target> (and lightning__Tab) to <targets>.",
    });
  }
  const allowed = new Set<string>(spec.required);
  if (input.target === "tab")
    ["lightning__Tab", "lightning__UrlAddressable", "lightning__HomePage"].forEach((t) =>
      allowed.add(t)
    );
  if (input.target === "record") allowed.add("lightning__RecordPage");
  const extra = meta.targets.filter((t) => PAGE_TARGETS.includes(t) && !allowed.has(t));
  if (extra.length)
    add({
      severity: "info",
      rule: "meta.extra-targets",
      message: `The meta file also exposes ${extra.join(", ")}, which a ${KIND_LABEL[input.target]} app doesn't use.`,
      fix: "Remove targets the app isn't built for.",
    });
  return height;
}

export function lintApp(input: AppInput): LintResult {
  const issues: AppIssue[] = [];
  const { name, target, files } = input;
  const add = (i: AppIssue) => issues.push(i);

  if (target === "action") {
    if (name.startsWith(APP_PREFIX)) {
      add({
        severity: "error",
        rule: "name.action-prefix",
        message: `A quick action app must not start with ${APP_PREFIX}: the iPad hides prefixed quick actions from the action menu (it treats them as inline components).`,
        fix: `Rename the bundle to ${QUICK_ACTION_PREFIX}<Name>.`,
      });
    } else if (!name.startsWith(QUICK_ACTION_PREFIX)) {
      add({
        severity: "warning",
        rule: "name.action-offline",
        message: `Name the quick action ${QUICK_ACTION_PREFIX}<Name>: the iPad only prefetches an LWC quick action for offline use when its name contains ${QUICK_ACTION_PREFIX}.`,
        fix: `Rename the bundle to ${QUICK_ACTION_PREFIX}<Name>.`,
      });
    }
  } else if (!name.startsWith(APP_PREFIX) || name.length === APP_PREFIX.length) {
    add({
      severity: "error",
      rule: "name.prefix",
      message: `The app's API name must start with ${APP_PREFIX} (got "${name}"); other names don't appear as LSC apps on the iPad.`,
      fix: `Rename the bundle to ${APP_PREFIX}<Name>.`,
    });
  }
  if (!/^[a-z][A-Za-z0-9_]*$/.test(name) || /__|_$/.test(name)) {
    add({
      severity: "error",
      rule: "name.invalid",
      message: `"${name}" isn't a valid component name: start with a lowercase letter, use letters, digits and single underscores, don't end with an underscore.`,
      fix: `Use a name like ${APP_PREFIX}NextActions.`,
    });
  }
  if (
    (target === "record" || target === "action") &&
    !(input.objectApiName && /^\w+$/.test(input.objectApiName))
  ) {
    add({
      severity: "error",
      rule: "target.object",
      message:
        target === "action"
          ? "A quick action app needs the API name of the object the action belongs to."
          : "A record page app needs the API name of the object whose record page it goes on.",
      fix: "Set objectApiName (for example Account).",
    });
  }
  if (files.length > MAX_FILES)
    add({
      severity: "error",
      rule: "files.too-many",
      message: `${files.length} files is too many (limit ${MAX_FILES}).`,
      fix: "Merge small components.",
    });

  const byBundle = new Map<string, AppFile[]>();
  const seenPaths = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    const okPath =
      parts.length === 3 &&
      parts[0] === "lwc" &&
      parts[1] === f.bundle &&
      /^[\w.-]+$/.test(parts[2]);
    if (!okPath) {
      add({
        severity: "error",
        rule: "files.path",
        path: f.path,
        message: `"${f.path}" doesn't match lwc/${f.bundle}/<file>.`,
        fix: `Use paths of the form lwc/${f.bundle || "<bundle>"}/<file>.`,
      });
      continue;
    }
    if (seenPaths.has(f.path))
      add({
        severity: "error",
        rule: "files.duplicate",
        path: f.path,
        message: `${f.path} appears twice.`,
        fix: "Send each file once.",
      });
    seenPaths.add(f.path);
    if (!/\.(js|html|css|js-meta\.xml|svg)$/.test(parts[2]))
      add({
        severity: "warning",
        rule: "files.extension",
        path: f.path,
        message: `${parts[2]} isn't a file type an LWC bundle takes (js, html, css, js-meta.xml, svg).`,
        fix: "Remove it or move its content into the .js file.",
      });
    if (Buffer.byteLength(f.source) > MAX_FILE_BYTES)
      add({
        severity: "error",
        rule: "files.too-large",
        path: f.path,
        message: `${f.path} is larger than ${MAX_FILE_BYTES / 1024} KB.`,
        fix: "Split it into nested components.",
      });
    else if (Buffer.byteLength(f.source) > LARGE_FILE_BYTES)
      add({
        severity: "info",
        rule: "files.large",
        path: f.path,
        message: `${f.path} is large (${Math.round(Buffer.byteLength(f.source) / 1024)} KB), which slows the iPad's first render.`,
        fix: "Split it into nested components.",
      });
    byBundle.set(f.bundle, [...(byBundle.get(f.bundle) ?? []), f]);
  }

  if (!byBundle.has(name)) {
    add({
      severity: "error",
      rule: "files.missing-parent",
      message: `No files for the parent bundle ${name}.`,
      fix: `Write lwc/${name}/${name}.js, .html and .js-meta.xml.`,
    });
  }

  let mobileHeight: number | undefined;
  for (const [bundle, bundleFiles] of byBundle) {
    const parent = bundle === name;
    const base = `lwc/${bundle}/${bundle}`;
    const has = (ext: string) => bundleFiles.find((f) => f.path === `${base}${ext}`);
    // A nested JS-only bundle that exports functions (no template, no component class) is an LWC service module.
    const js = has(".js");
    const service =
      !parent &&
      !!js &&
      !has(".html") &&
      !/export\s+default\s+class\b/.test(blankJsComments(js.source));
    for (const ext of service ? [".js"] : [".js", ".html"]) {
      if (!has(ext))
        add({
          severity: "error",
          rule: `files.missing-${ext.slice(1)}`,
          message: `${bundle} has no ${bundle}${ext}.`,
          path: `${base}${ext}`,
          fix: `Add lwc/${bundle}/${bundle}${ext}.`,
        });
    }
    if (!parent && bundle.startsWith(APP_PREFIX))
      add({
        severity: "warning",
        rule: "child.prefixed",
        message: `${bundle} is nested but carries the ${APP_PREFIX} prefix, so it would also be offered as an app on its own.`,
        fix: "Name nested components without the prefix, e.g. nextActionCard.",
      });
    const metaFile = has(".js-meta.xml");
    if (!metaFile) {
      add({
        severity: "error",
        rule: "meta.missing",
        path: `${base}.js-meta.xml`,
        message: `${bundle} has no ${bundle}.js-meta.xml; the bundle can't be deployed without it.`,
        fix: `Add lwc/${bundle}/${bundle}.js-meta.xml (see the guide's templates).`,
      });
    } else {
      const h = pushMetaIssues(input, parseMeta(metaFile.source), metaFile.path, parent, issues);
      if (parent) mobileHeight = h;
    }
    for (const other of bundleFiles) {
      const m = /^lwc\/[^/]+\/([^/]+)\.(js|html|css)$/.exec(other.path);
      if (m && m[1] !== bundle)
        add({
          severity: "error",
          rule: "files.naming",
          path: other.path,
          message: `${other.path} must be named ${bundle}.${m[2]}; the file name has to match the bundle.`,
          fix: `Rename it to lwc/${bundle}/${bundle}.${m[2]}.`,
        });
    }
    for (const f of bundleFiles) {
      if (f.path.endsWith(".js")) lintJs(input, f, parent, service, (i) => issues.push(i));
      else if (f.path.endsWith(".html")) lintHtml(f, (i) => issues.push(i));
    }
  }

  // Nested components: each reference must be one of the bundles provided.
  const bundles = new Set(byBundle.keys());
  const reported = new Set<string>();
  for (const [bundle, bundleFiles] of byBundle) {
    for (const [child, at] of childRefs(bundleFiles)) {
      if (bundles.has(child) || reported.has(`${bundle}:${child}`)) continue;
      reported.add(`${bundle}:${child}`);
      add({
        severity: "error",
        rule: "child.unresolved",
        path: at.path,
        line: at.line,
        message: `${bundle} uses c/${child}, but no bundle named ${child} was provided.`,
        fix: `Write lwc/${child}/${child}.js, .html and .js-meta.xml, or remove the reference.`,
      });
    }
  }
  return { issues, mobileHeight };
}

function lintJs(
  input: AppInput,
  f: AppFile,
  parent: boolean,
  service: boolean,
  add: (i: AppIssue) => void
): void {
  const js = blankJsComments(f.source);
  const at = (re: RegExp) => {
    const m = re.exec(js);
    return m ? lineAt(js, m.index) : undefined;
  };
  if (!service && !/export\s+default\s+class\b/.test(js)) {
    add({
      severity: "error",
      rule: "js.default-export",
      path: f.path,
      message: "The .js file must `export default class … extends LightningElement`.",
      fix: "Declare `export default class Name extends LightningElement { … }`.",
    });
  }
  if (/\bimport\b[^;]*from\s+["']lwc["']/.test(js) && !/\bLightningElement\b/.test(js)) {
    add({
      severity: "error",
      rule: "js.lightning-element",
      path: f.path,
      message: "LightningElement isn't imported from 'lwc'.",
      fix: "import { LightningElement, api, wire } from 'lwc';",
    });
  }
  if (parent && (input.target === "record" || input.target === "action")) {
    if (!/@api\s+recordId\b/.test(js))
      add({
        severity: "error",
        rule: "js.record-id",
        path: f.path,
        message: `A ${input.target === "action" ? "quick action" : "record page"} app must expose \`@api recordId\` — the iPad passes the record's Id through it.`,
        fix: "Add `@api recordId;` (and `@api objectApiName;`) to the class.",
      });
    else if (!/@api\s+objectApiName\b/.test(js))
      add({
        severity: "info",
        rule: "js.object-api-name",
        path: f.path,
        message: "The class doesn't expose `@api objectApiName`; the page passes it too.",
        fix: "Add `@api objectApiName;`.",
      });
  }
  if (parent && input.target === "action") {
    if (!/\bCloseActionScreenEvent\b/.test(js))
      add({
        severity: "warning",
        rule: "js.close-action",
        path: f.path,
        message:
          "The action never closes itself; the rep can only dismiss the sheet by swiping it away.",
        fix: "import { CloseActionScreenEvent } from 'lightning/actions'; then call this.dispatchEvent(new CloseActionScreenEvent()) when done.",
      });
    if (
      /@api\s+recordId\b/.test(js) &&
      /\bconnectedCallback\s*\(\s*\)\s*\{[^}]*this\.recordId\b/.test(js) &&
      !/set\s+recordId\b/.test(js)
    ) {
      add({
        severity: "info",
        rule: "js.record-id-timing",
        path: f.path,
        message:
          "recordId is set after the action is constructed; reading it in connectedCallback can see undefined.",
        fix: "Use a `@api set recordId(v)` setter, or a wire with `$recordId`.",
      });
    }
  }
  if (
    parent &&
    /name="mobileHeight"/.test(
      input.files.find((m) => m.path === `lwc/${input.name}/${input.name}.js-meta.xml`)?.source ??
        ""
    ) &&
    !/@api\s+mobileHeight\b/.test(js)
  ) {
    add({
      severity: "error",
      rule: "js.mobile-height-api",
      path: f.path,
      message:
        "The meta file declares the mobileHeight property but the class doesn't, so the org rejects the deploy (the 'mobileHeight' property doesn't exist on the component).",
      fix: "Add `@api mobileHeight = 560;` to the class (the same number as the default in the meta file).",
    });
  }
  if (/\blightning\/graphql\b/.test(js)) {
    add({
      severity: "warning",
      rule: "js.lightning-graphql",
      path: f.path,
      line: at(/lightning\/graphql\b/),
      message: "'lightning/graphql' isn't the module the LSC iPad answers offline.",
      fix: "Import { gql, graphql } from 'lightning/uiGraphQLApi' instead.",
    });
  }
  if (/\bgql\s*`/.test(js) && !/import\s*\{[^}]*\bgql\b[^}]*\}\s*from/.test(js)) {
    add({
      severity: "error",
      rule: "graphql.gql-import",
      path: f.path,
      line: at(/\bgql\s*`/),
      message: "`gql` is used but not imported.",
      fix: "import { gql, graphql } from 'lightning/uiGraphQLApi';",
    });
  }
  for (const q of gqlTemplates(js)) {
    const line = lineAt(js, q.index);
    if (/\$\{/.test(q.text))
      add({
        severity: "error",
        rule: "graphql.dynamic",
        path: f.path,
        line,
        message:
          "Interpolating values into a gql template (${…}) isn't supported; the query has to be static.",
        fix: "Declare `query Name($x: String) { … }` and pass values through `variables`.",
      });
    if (/\bmutation\b/.test(q.text))
      add({
        severity: "error",
        rule: "graphql.mutation",
        path: f.path,
        line,
        message: "GraphQL mutations aren't available offline on the iPad.",
        fix: "Use createRecord / updateRecord / deleteRecord from lightning/uiRecordApi for writes.",
      });
    if (/\b(aggregate|groupBy)\b/.test(q.text))
      add({
        severity: "error",
        rule: "graphql.aggregate",
        path: f.path,
        line,
        message:
          "Aggregate queries (aggregate / groupBy) aren't supported by the iPad's offline GraphQL.",
        fix: "Query the records and count or group them in JavaScript.",
      });
  }
  const unsafe: [RegExp, string, string, string][] = [
    [
      /\.innerHTML\s*=|\binsertAdjacentHTML\s*\(/,
      "js.inner-html",
      "innerHTML is blocked by Lightning Web Security and is an injection risk.",
      'Render with the template; use lwc:dom="manual" only for static nodes.',
    ],
    [
      /\beval\s*\(|\bnew\s+Function\s*\(/,
      "js.eval",
      "eval / new Function aren't allowed.",
      "Remove dynamic code evaluation.",
    ],
    [
      /\bwindow\.open\s*\(/,
      "js.window-open",
      "window.open doesn't work in the iPad's component container.",
      "Show the content inside the component, or use NavigationMixin for in-app navigation.",
    ],
    [
      /\bdocument\.write\s*\(/,
      "js.document-write",
      "document.write isn't allowed.",
      "Render through the template.",
    ],
    [
      /\blocalStorage\b|\bsessionStorage\b/,
      "js.storage",
      "localStorage and sessionStorage aren't available to the iPad component.",
      "Keep state in class fields.",
    ],
  ];
  for (const [re, rule, message, fix] of unsafe)
    if (re.test(js)) add({ severity: "warning", rule, path: f.path, line: at(re), message, fix });
  if (/@salesforce\/apex\//.test(js)) {
    add({
      severity: "warning",
      rule: "js.apex",
      path: f.path,
      line: at(/@salesforce\/apex\//),
      message: "Apex calls need the network on the iPad (they fail offline).",
      fix: "Read the data with a GraphQL wire or getRecord instead.",
    });
  }
  if (/\blightning\/modal\w*/.test(js)) {
    add({
      severity: "warning",
      rule: "js.modal",
      path: f.path,
      line: at(/lightning\/modal/),
      message: "Modals and overlays are limited inside an iPad component.",
      fix: "Show the details in place (an expandable row or a detail panel inside the component).",
    });
  }
  if (
    /\b(setTimeout|setInterval)\s*\(/.test(js) &&
    !/\b(clearTimeout|clearInterval)\s*\(/.test(js)
  ) {
    add({
      severity: "info",
      rule: "js.timer-cleanup",
      path: f.path,
      line: at(/\b(setTimeout|setInterval)\s*\(/),
      message:
        "A timer is started and never cleared; it keeps running after the component is removed.",
      fix: "Clear it in disconnectedCallback().",
    });
  }
  if (/\bconsole\.(log|debug)\s*\(/.test(js))
    add({
      severity: "info",
      rule: "js.console",
      path: f.path,
      line: at(/\bconsole\.(log|debug)\s*\(/),
      message: "console output is left in the code.",
      fix: "Remove debug logging before deploying.",
    });
}

function lintHtml(f: AppFile, add: (i: AppIssue) => void): void {
  const html = blankHtmlComments(f.source);
  const first = /<\s*([a-zA-Z][\w-]*)/.exec(html);
  if (!first || first[1] !== "template") {
    add({
      severity: "error",
      rule: "html.root",
      path: f.path,
      line: first ? lineAt(html, first.index) : 1,
      message: "The template's root element must be <template>.",
      fix: "Wrap everything in <template> … </template>.",
    });
  }
  if (/<script[\s>]/i.test(html))
    add({
      severity: "error",
      rule: "html.script",
      path: f.path,
      line: lineAt(html, html.search(/<script[\s>]/i)),
      message: "<script> isn't allowed in an LWC template.",
      fix: "Move the code into the .js file.",
    });
  if (/<style[\s>]/i.test(html))
    add({
      severity: "error",
      rule: "html.style-tag",
      path: f.path,
      line: lineAt(html, html.search(/<style[\s>]/i)),
      message: "<style> isn't allowed in an LWC template.",
      fix: "Move the CSS into the bundle's .css file.",
    });
  for (const m of html.matchAll(/\s(if:true|if:false)=/g)) {
    add({
      severity: "info",
      rule: "html.legacy-if",
      path: f.path,
      line: lineAt(html, m.index ?? 0),
      message: `${m[1]} is the legacy conditional.`,
      fix: "Use lwc:if={…} / lwc:elseif / lwc:else.",
    });
    break;
  }
  for (const m of html.matchAll(/\{([^{}]*)\}/g)) {
    const inner = m[1].trim();
    if (!inner || /^[\w$]+(\.[\w$]+)*$/.test(inner)) continue;
    add({
      severity: "warning",
      rule: "html.expression",
      path: f.path,
      line: lineAt(html, m.index ?? 0),
      message: `Templates take only a property or a dotted path inside { } — "{${inner.length > 40 ? inner.slice(0, 40) + "…" : inner}}" is an expression.`,
      fix: "Compute the value in a getter in the .js file and bind the getter.",
    });
    break;
  }
  const keyless = /<template\b[^>]*\bfor:each=[^>]*>\s*<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  for (const m of html.matchAll(keyless)) {
    if (!/\bkey=/.test(m[2]))
      add({
        severity: "error",
        rule: "html.missing-key",
        path: f.path,
        line: lineAt(html, m.index ?? 0),
        message:
          "The first element inside a for:each template needs a key={…} (a unique, stable value such as the record Id).",
        fix: "Add key={item.id} to the element directly inside the for:each template.",
      });
  }
  if (/<lightning-datatable[\s>]/.test(html))
    add({
      severity: "info",
      rule: "html.datatable",
      path: f.path,
      line: lineAt(html, html.search(/<lightning-datatable/)),
      message: "lightning-datatable is dense and hard to use on a touch screen.",
      fix: "Prefer a card or row list with 44px tap targets.",
    });
}
