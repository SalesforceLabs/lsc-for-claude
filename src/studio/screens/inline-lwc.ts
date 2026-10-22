/**
 * Offline check for org-defined inline LWCs (lscMobileInline_*). On the iPad
 * they run in the Lightning Mobile Runtime, whose network shunt
 * (lifesciences-ios NetworkShunt/NetworkRequestParser) answers a fixed set of
 * UI API, GraphQL and Life Sciences requests from the device database; any
 * other request goes to the network when online and fails offline with "API
 * call is unsupported offline". Read from the bundle source only.
 */

export interface InlineLwcIssue {
  /** `online`: needs network on the iPad. `gated`: offline only when the org has offline GraphQL (orgHasMobileOfflineGraphqlEnabled). */
  severity: "online" | "gated";
  kind: "apex" | "adapter" | "graphql" | "network" | "component";
  /** What it uses: `ContactController.getContacts`, `getRelatedListRecords`, `lightning-map`, `fetch`. */
  detail: string;
  /** The `c/` bundle it's in, when not the inline component itself. */
  bundle?: string;
}

export interface InlineLwcCheck {
  issues: InlineLwcIssue[];
  /** Bundles read: the component and the `c/` components it uses. */
  bundles: string[];
}

export interface LwcFile {
  bundle: string;
  path: string;
  source: string;
}

/**
 * LDS modules whose endpoints have no shunt handler. Answered by the shunt:
 * uiRecordApi (records, records/batch, record-ui, record-defaults),
 * uiObjectInfoApi (object-info, picklist-values) and uiLayoutApi (layout).
 */
const ONLINE_MODULES = new Set([
  "lightning/uiRelatedListApi",
  "lightning/uiListsApi",
  "lightning/uiListApi",
  "lightning/uiActionsApi",
  "lightning/uiAppsApi",
  "lightning/empApi",
]);

/** The GraphQL handler is registered only behind the 262 gate. */
const GRAPHQL_MODULES = new Set(["lightning/uiGraphQLApi", "lightning/graphql"]);

/** Base components that load from the network themselves. */
const ONLINE_COMPONENTS = ["lightning-map", "lightning-file-upload"];

/** Most `c/` bundles followed from one inline component. */
const MAX_BUNDLES = 20;

function stripJsComments(js: string): string {
  return js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** `{ a, b as c }` / `x` / `x, { a }` → the imported names (`a`, `b`, `x`). */
function importedNames(clause: string): string[] {
  const out: string[] = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  for (const part of (braces?.[1] ?? "").split(",")) {
    const name = part.trim().split(/\s+as\s+/)[0];
    if (name) out.push(name);
  }
  const def = clause
    .replace(/\{[^}]*\}/, "")
    .replace(/\*\s+as\s+\w+/, "")
    .replace(/,/g, "")
    .trim();
  if (def) out.push(def);
  return out;
}

/** `c-my-card_x` → `myCard_x` (LWC kebab-case tag to bundle name). */
function bundleOfTag(tag: string): string {
  return tag.replace(/^c-/, "").replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Imports and `<c-*>` tags of one bundle's files: what it uses and the `c/` bundles it pulls in. */
export function scanBundle(files: { path: string; source: string }[]): {
  issues: InlineLwcIssue[];
  children: string[];
} {
  const issues: InlineLwcIssue[] = [];
  const children = new Set<string>();
  const add = (issue: InlineLwcIssue) => {
    if (!issues.some((i) => i.kind === issue.kind && i.detail === issue.detail)) issues.push(issue);
  };
  for (const f of files) {
    if (f.path.endsWith(".js") || f.path.endsWith(".ts")) {
      const js = stripJsComments(f.source);
      for (const m of js.matchAll(/\bimport\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
        const [, clause, mod] = m;
        if (mod.startsWith("@salesforce/apex/"))
          add({ severity: "online", kind: "apex", detail: mod.slice("@salesforce/apex/".length) });
        else if (
          mod === "@salesforce/apexContinuation" ||
          mod.startsWith("@salesforce/apexContinuation/")
        )
          add({ severity: "online", kind: "apex", detail: "Continuation" });
        else if (ONLINE_MODULES.has(mod))
          for (const n of importedNames(clause))
            add({ severity: "online", kind: "adapter", detail: n });
        else if (GRAPHQL_MODULES.has(mod) && importedNames(clause).includes("graphql"))
          add({ severity: "gated", kind: "graphql", detail: "graphql" });
        else if (mod.startsWith("c/")) children.add(mod.slice(2));
      }
      if (/(^|[^\w.$])fetch\s*\(/.test(js))
        add({ severity: "online", kind: "network", detail: "fetch" });
      if (/\bnew\s+XMLHttpRequest\b/.test(js))
        add({ severity: "online", kind: "network", detail: "XMLHttpRequest" });
    } else if (f.path.endsWith(".html")) {
      const html = f.source.replace(/<!--[\s\S]*?-->/g, "");
      for (const tag of ONLINE_COMPONENTS)
        if (new RegExp(`<${tag}[\\s>/]`).test(html))
          add({ severity: "online", kind: "component", detail: tag });
      for (const m of html.matchAll(/<(c-[a-z0-9_-]+)[\s>/]/g)) children.add(bundleOfTag(m[1]));
    }
  }
  return { issues, children: [...children] };
}

/**
 * Checks an inline component and the `c/` bundles it uses. `load` returns a
 * set of bundles' files (bundles it can't read are skipped).
 */
export async function checkInlineLwc(
  name: string,
  load: (bundles: string[]) => Promise<LwcFile[]>,
  first?: LwcFile[]
): Promise<InlineLwcCheck> {
  const seen = new Set<string>([name]);
  const read = new Set<string>();
  const issues: InlineLwcIssue[] = [];
  let files = first ?? (await load([name]));
  for (;;) {
    const next: string[] = [];
    const byBundle = new Map<string, LwcFile[]>();
    for (const f of files) byBundle.set(f.bundle, [...(byBundle.get(f.bundle) ?? []), f]);
    for (const [bundle, bundleFiles] of byBundle) {
      read.add(bundle);
      const scan = scanBundle(bundleFiles);
      for (const i of scan.issues) {
        const issue = bundle === name ? i : { ...i, bundle };
        if (!issues.some((x) => x.kind === issue.kind && x.detail === issue.detail))
          issues.push(issue);
      }
      for (const c of scan.children) {
        if (!seen.has(c) && seen.size < MAX_BUNDLES) {
          seen.add(c);
          next.push(c);
        }
      }
    }
    if (!next.length) break;
    files = await load(next);
  }
  return { issues, bundles: [...read] };
}
