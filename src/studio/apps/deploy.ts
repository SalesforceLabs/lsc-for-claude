/**
 * Deploys an LSC App: every bundle (the app and its nested components) and, for
 * a record page app, the LightningWebComponent quick action that opens it on
 * the iPad. Refuses an app whose lint has errors. Written as a source tree in
 * the session's temp SFDX project and deployed with the same path as every other
 * Studio metadata write.
 */

import * as fs from "fs";
import * as path from "path";
import { deployMetadata, ensureTmpSfdxProject, retrieveMetadata } from "../../salesforce/cli.js";
import { isProductionOrg } from "../metadata/live.js";
import { lintApp, parseMeta } from "./lint.js";
import type { AppDeployResult, AppInput, AppTabOptions } from "./types.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The quick action a record page app needs on its object. Verified against the demo org's own
 * `Account.lscMobileInline_accessStatus`: `lightningWebComponent` is the bare bundle name (no `c:`),
 * the action's name equals the component's, and it's a ScreenAction.
 */
export function quickActionXml(name: string, label: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<QuickAction xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionSubtype>ScreenAction</actionSubtype>
    <label>${esc(label)}</label>
    <lightningWebComponent>${esc(name)}</lightningWebComponent>
    <optionsCreateFeedItem>false</optionsCreateFeedItem>
    <type>LightningWebComponent</type>
</QuickAction>
`;
}

/** The App page (One Region) that holds a tab app — same shape as the org's own flexipage tabs (e.g. MT_Briefing). */
export function appPageXml(name: string, label: string, mobileHeight: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexiPage xmlns="http://soap.sforce.com/2006/04/metadata">
    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>mobileHeight</name>
                    <value>${mobileHeight}</value>
                </componentInstanceProperties>
                <componentName>${esc(name)}</componentName>
                <identifier>${esc(name)}</identifier>
            </componentInstance>
        </itemInstances>
        <name>main</name>
        <type>Region</type>
    </flexiPageRegions>
    <masterLabel>${esc(label)}</masterLabel>
    <template>
        <name>flexipage:defaultAppHomeTemplate</name>
    </template>
    <type>AppPage</type>
</FlexiPage>
`;
}

/** The custom tab pointing at the App page. */
export function customTabXml(flexiPage: string, label: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CustomTab xmlns="http://soap.sforce.com/2006/04/metadata">
    <flexiPage>${esc(flexiPage)}</flexiPage>
    <label>${esc(label)}</label>
    <motif>Custom10: Moon</motif>
</CustomTab>
`;
}

/** A profile carrying only a tab visibility — deploying it changes nothing else on the profile. */
export function profileTabXml(tab: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <tabVisibilities>
        <tab>${esc(tab)}</tab>
        <visibility>DefaultOn</visibility>
    </tabVisibilities>
</Profile>
`;
}

/** The app's XML with `<tabs>tab</tabs>` after its last tab (unchanged when it is already there). */
export function addTabToAppXml(xml: string, tab: string): string {
  if (new RegExp(`<tabs>\\s*${tab}\\s*</tabs>`).test(xml)) return xml;
  const last = xml.lastIndexOf("</tabs>");
  if (last >= 0) {
    const at = last + "</tabs>".length;
    return `${xml.slice(0, at)}\n    <tabs>${tab}</tabs>${xml.slice(at)}`;
  }
  const close = xml.lastIndexOf("</CustomApplication>");
  if (close < 0) throw new Error("The app's metadata isn't a CustomApplication.");
  return `${xml.slice(0, close)}    <tabs>${tab}</tabs>\n${xml.slice(close)}`;
}

function tabOptions(input: AppInput): Required<Pick<AppTabOptions, "label">> & AppTabOptions {
  const meta = input.files.find((f) => f.path === `lwc/${input.name}/${input.name}.js-meta.xml`);
  const label = input.tab?.label?.trim() || (meta && parseMeta(meta.source).masterLabel) || input.name.replace(/^lscMobileInline_/, "");
  return { ...input.tab, label };
}

export interface AppTree {
  /** Relative file path → content. */
  files: Record<string, string>;
  deployed: string[];
}

/** What gets written for an app, as relative paths under the source root (pure; used by deploy and tests). */
export function buildAppTree(input: AppInput): AppTree {
  const files: Record<string, string> = {};
  const bundles = new Set<string>();
  for (const f of input.files) {
    files[f.path] = f.source.endsWith("\n") ? f.source : f.source + "\n";
    bundles.add(f.bundle);
  }
  const deployed = [...bundles].sort((a, b) => (a === input.name ? -1 : b === input.name ? 1 : a.localeCompare(b))).map((b) => `LightningComponentBundle:${b}`);
  if ((input.target === "record" || input.target === "action") && input.objectApiName) {
    const meta = input.files.find((f) => f.path === `lwc/${input.name}/${input.name}.js-meta.xml`);
    const label = (meta && parseMeta(meta.source).masterLabel) || input.name.replace(/^lscMobileInline_/, "");
    files[`quickActions/${input.objectApiName}.${input.name}.quickAction-meta.xml`] = quickActionXml(input.name, label);
    deployed.push(`QuickAction:${input.objectApiName}.${input.name}`);
  }
  if (input.target === "tab") {
    const meta = input.files.find((f) => f.path === `lwc/${input.name}/${input.name}.js-meta.xml`);
    const height = (meta && lintApp(input).mobileHeight) || 560;
    const { label } = tabOptions(input);
    files[`flexipages/${input.name}.flexipage-meta.xml`] = appPageXml(input.name, (meta && parseMeta(meta.source).masterLabel) || label, height);
    files[`tabs/${input.name}.tab-meta.xml`] = customTabXml(input.name, label);
    deployed.push(`FlexiPage:${input.name}`, `CustomTab:${input.name}`);
    for (const profile of input.tab?.profiles ?? []) {
      files[`profiles/${profile}.profile-meta.xml`] = profileTabXml(input.name);
      deployed.push(`Profile:${profile}`);
    }
  }
  return { files, deployed };
}

/** The retrieved CustomApplication file's text, whatever folder the retrieve put it in. */
async function readApp(application: string, org: string): Promise<{ xml?: string; error?: string }> {
  const result = await retrieveMetadata("", `CustomApplication:${application}`, org);
  if (!result.success || !result.data) return { error: result.error ?? "The retrieve failed." };
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".app-meta.xml")) found.push(p);
    }
  };
  try {
    walk(result.data.outputDir);
    return found[0] ? { xml: fs.readFileSync(found[0], "utf-8") } : { error: `The org has no app named ${application}.` };
  } finally {
    fs.rmSync(result.data.outputDir, { recursive: true, force: true });
  }
}

export async function deployApp(input: AppInput, org: string): Promise<AppDeployResult> {
  const production = await isProductionOrg(org);
  const lint = lintApp(input);
  const errors = lint.issues.filter((i) => i.severity === "error");
  const warnings = lint.issues.filter((i) => i.severity === "warning").map((i) => i.message);
  if (errors.length) {
    return { ok: false, deployed: [], error: `Not deployed: ${errors.length} error${errors.length === 1 ? "" : "s"} to fix first — ${errors.slice(0, 3).map((e) => e.message).join(" ")}`, warnings, production };
  }
  const tree = buildAppTree(input);
  if (input.target === "tab") {
    if (input.tab?.application) {
      if (!/^[\w]+$/.test(input.tab.application)) return { ok: false, deployed: [], error: `"${input.tab.application}" isn't an app API name.`, warnings, production };
      const app = await readApp(input.tab.application, org);
      if (!app.xml) return { ok: false, deployed: [], error: `Not deployed: couldn't read the app ${input.tab.application} to add the tab — ${app.error}`, warnings, production };
      tree.files[`applications/${input.tab.application}.app-meta.xml`] = addTabToAppXml(app.xml, input.name);
      tree.deployed.push(`CustomApplication:${input.tab.application}`);
    }
    if (!input.tab?.profiles?.length) warnings.push("No profile was given, so the tab isn't visible to anyone yet (tabs are Hidden by default and the iPad skips tabs a profile hides). Make it Default On for the profiles that should see it, then Publish to iPad.");
  }
  const root = path.join(ensureTmpSfdxProject(), "force-app", `app-deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    for (const [rel, content] of Object.entries(tree.files)) {
      const file = path.join(root, rel);
      if (!file.startsWith(root + path.sep)) throw new Error(`Unsafe path: ${rel}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf-8");
    }
    const result = await deployMetadata(root, org);
    if (!result.success) return { ok: false, deployed: [], error: result.error ?? "The deploy failed.", warnings, production };
    return { ok: true, deployed: tree.deployed, warnings, production };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
