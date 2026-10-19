/**
 * Contracts for the LSC App builder (Studio → Build → LSC apps): the files of an
 * app, what Studio's checks report about them, and what the org holds.
 */

import type { InlineLwcCheck, LwcFile } from "../screens/inline-lwc.js";

/** One file of a bundle. `path` is `lwc/<bundle>/<file>`. Same shape as `LwcFile`. */
export type AppFile = LwcFile;
/**
 * home = Home page component; record = record page tab (+ hidden quick action); action = LWC quick action
 * in the record's action menu; tab = a custom iPad navigation tab (App page + CustomTab).
 */
export type AppTarget = "home" | "record" | "action" | "tab";

/** Where a `tab` app is shown. Without `application` / `profiles` only the bundle, App page and tab are deployed. */
export interface AppTabOptions {
  /** The tab's label (defaults to the component's masterLabel). */
  label?: string;
  /** API name of the CustomApplication whose tab list gets the tab (the iPad's cache reads the profile's app), e.g. lsc4ce__lifeSciencesCommercial. */
  application?: string;
  /** Profiles that see the tab (tabVisibility DefaultOn). */
  profiles?: string[];
}

export interface AppInput {
  /** The parent bundle's API name, `lscMobileInline_Xxx`. */
  name: string;
  target: AppTarget;
  /** The object (record and action targets). */
  objectApiName?: string;
  files: AppFile[];
  /** Tab target only. */
  tab?: AppTabOptions;
}

export interface AppIssue {
  severity: "error" | "warning" | "info";
  /** Stable id, e.g. "meta.missing-urladdressable", "compile", "offline.apex". */
  rule: string;
  message: string;
  path?: string;
  line?: number;
  /** What to do, for the model's repair round. */
  fix?: string;
}

export interface AppCheckResult {
  /** No "error" issues and it compiled. */
  ok: boolean;
  issues: AppIssue[];
  offline: InlineLwcCheck;
  /** Compiled IIFE for the live frame (same as studio_lwc_bundle's script); absent when it didn't compile. */
  script?: string;
  placeholders: string[];
  /** mobileHeight default read from the meta file. */
  mobileHeight?: number;
  /** Objects the source reads, and whether DB Schema syncs them to the iPad (null = couldn't check / no org). */
  objects?: { name: string; synced: boolean | null }[];
}

export interface AppObjectInfo {
  name: string;
  label: string;
  exists: boolean;
  /** An active DB Schema record exists for it (null = couldn't check). */
  synced: boolean | null;
  /** What the run-as user can do with the object (absent when not running as a user). */
  access?: "none" | "read" | "edit";
  /** Fields the org has that the run-as user can't read (field-level security), at most 30. */
  hiddenFields?: string[];
  /** Plain-words access summary when running as a user, e.g. "Carmen can't read RecommendedAction.Score__c". */
  note?: string;
  recordCount?: number;
  fields: { name: string; label: string; type: string; referenceTo?: string[]; picklist?: string[]; /** For a lookup: the name GraphQL / getRecord use to reach the parent (`Account` for `AccountId`). */ relationshipName?: string }[];
  childRelationships?: { name: string; object: string; field: string }[];
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
  /** "LightningComponentBundle:lscMobileInline_X", "QuickAction:Account.lscMobileInline_X" */
  deployed: string[];
  error?: string;
  warnings: string[];
  production: boolean;
}

export const APP_PREFIX = "lscMobileInline_";
/** Prefix of a quick action app (offline prefetch); an action app must NOT carry APP_PREFIX. */
export const QUICK_ACTION_PREFIX = "lscMobileQuickAction_";
