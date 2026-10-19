// Contract types for the LSC App Builder (see docs/design/lsc-app-builder.md). Copies of the
// server's shapes (src/studio/apps) — the renderer and Electron main only see them as JSON.

/** path: "lwc/<bundle>/<file>" */
export interface AppFile {
  bundle: string;
  path: string;
  source: string;
}
export type AppTarget = "home" | "record" | "action" | "tab";

export interface AppIssue {
  severity: "error" | "warning" | "info";
  /** Stable id, e.g. "meta.missing-urladdressable", "compile", "offline.apex". */
  rule: string;
  message: string;
  path?: string;
  line?: number;
  fix?: string;
}

/** Same shape as the server's `InlineLwcCheck` (src/studio/screens/inline-lwc.ts). */
export type InlineLwcCheck = Record<string, unknown>;

export interface AppCheckResult {
  ok: boolean;
  issues: AppIssue[];
  offline: InlineLwcCheck;
  /** Compiled IIFE for the live frame; absent when it didn't compile. */
  script?: string;
  placeholders: string[];
  mobileHeight?: number;
  objects?: { name: string; synced: boolean | null }[];
}

export interface AppObjectInfo {
  name: string;
  label: string;
  exists: boolean;
  synced: boolean | null;
  recordCount?: number;
  fields: { name: string; label: string; type: string; referenceTo?: string[]; picklist?: string[] }[];
  childRelationships?: { name: string; object: string; field: string }[];
  /** Running as a test user: what they can do with the object, fields hidden from them, and a plain-words summary. */
  access?: "none" | "read" | "edit";
  hiddenFields?: string[];
  note?: string;
}

export interface OrgApp {
  name: string;
  label: string;
  target: AppTarget | null;
  objectApiNames?: string[];
  lastModifiedDate?: string;
  lastModifiedBy?: string;
  description?: string;
}

export interface AppDeployResult {
  ok: boolean;
  deployed: string[];
  error?: string;
  warnings: string[];
  production: boolean;
}

export interface AppStep {
  id: string;
  kind: "plan" | "describe" | "sample" | "write" | "check" | "repair" | "note";
  label: string;
  status: "running" | "done" | "failed";
  detail?: string;
  startedAt: string;
  endedAt?: string;
}

export interface AppTurn {
  id: string;
  prompt: string;
  at: string;
  status: "running" | "done" | "failed" | "stopped";
  steps: AppStep[];
  reply: string;
  versionId?: string;
  error?: string;
}

export interface AppVersion {
  id: string;
  at: string;
  source: "ai" | "manual" | "org" | "starter";
  files: AppFile[];
  check: Omit<AppCheckResult, "script">;
  turnId?: string;
  note?: string;
}

export interface AppProject {
  id: string;
  /** Org username, lowercased. */
  org: string;
  /** Bundle API name, lscMobileInline_Xxx */
  name: string;
  label: string;
  target: AppTarget;
  objectApiName?: string;
  createdAt: string;
  updatedAt: string;
  turns: AppTurn[];
  /** Newest last. */
  versions: AppVersion[];
  currentVersionId: string | null;
  deployed?: { versionId: string; at: string; deployed: string[] };
  importedFrom?: string;
  /** The starter app the project began from. */
  starter?: AppStarterRef;
  /** Build for (and read data as) a Studio test user. */
  runAs?: AppRunAs;
  /** Tab apps: profiles that get the tab and the app it joins. */
  tab?: AppTabSettings;
}

/** A starter app (`studio_app_starters`): a working LSC app from the afls-ideas GitHub account, copied at a pinned commit. */
export interface AppStarter {
  id: string;
  label: string;
  description: string;
  /** "owner/repo" on GitHub. */
  repo: string;
  sha: string;
  /** The repo at that commit. */
  url: string;
  name: string;
  target: AppTarget;
  objectApiName?: string;
  /** Objects the source reads. */
  objects: string[];
  /** Follow-up prompts worth trying on it. */
  tryNext: string[];
}

/** What a project keeps of the starter it began from. */
export type AppStarterRef = Pick<AppStarter, "id" | "label" | "description" | "repo" | "sha" | "url" | "tryNext">;

export interface AppTabSettings {
  profiles: string[];
  application?: string;
}

export interface AppRunAs {
  loginId: string;
  username: string;
  userId?: string;
  profile?: string;
}

export type AppBuilderEvent =
  | { type: "turn"; turn: AppTurn }
  | { type: "step"; turnId: string; step: AppStep }
  | { type: "reply-delta"; turnId: string; text: string }
  | { type: "writing"; turnId: string; path: string; chars: number }
  | { type: "version"; version: AppVersion }
  | { type: "project"; project: AppProject };

/** What Deploy would write, from `studio_app_deploy_plan`. */
export interface AppDeployPlan {
  components: { type: string; name: string; label?: string; detail?: string; existing?: boolean }[];
  /** Names (or "Type:Name") of components already in the org that a deploy replaces. */
  existing: string[];
  production: boolean;
  warnings: string[];
}
