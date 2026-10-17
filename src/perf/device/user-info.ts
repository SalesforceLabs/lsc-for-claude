/**
 * Step 1 of a device sync: the mobile user-info call. Mirrors the iOS app
 * (SalesForceUserInfoService.getMobileUserInfo / UserInformationOperation).
 * The call is a GET; it returns settings, the user's metadata record and
 * territories. The only identifier the app adds is `userDeviceId`, which this
 * client omits unless the caller supplies one.
 */

import { connectPath, jsonOrThrow, type DeviceSession } from "./session.js";

const NS = "IndustriesLsCommercialOCE.";

export const ACCESS_CHECK_ENHANCED_SYNC = `${NS}orgHasMobileEnhancedSyncEnabled`;
export const ACCESS_CHECK_LSC_OCE = `${NS}orgHasLifeSciencesCommercialOCE`;
export const ACCESS_CHECK_SERVER_HANDLES_CONTENT_IN_LIST = `${NS}orgHasEnhancedSyncServerHandlesContentInList`;

/** The identifier list the iOS app sends (Core/AccessCheckService/AccessChecks.swift allChecks). */
export const ACCESS_CHECKS: readonly string[] = [
  `${NS}orgHasLSRecordTypeMappingEnabled`,
  "Cpq.orgHasRevenueAdjustment",
  `${NS}orgHasLSRecordTypeActionOverrideEnabled`,
  `${NS}orgHasLSDataCaptureFlow`,
  `${NS}orgHasLSDraftOrder`,
  `${NS}orgHasLSStoreCheck`,
  `${NS}orgHasCaptureOnlySamplesAndMarketingItems`,
  `${NS}orgHasFieldEventsEstimatedExpAllocAccess`,
  `${NS}orgHasContentLibEnhancements`,
  `${NS}orgHasInContentTracking`,
  `${NS}orgHasMobileOfflineGraphqlEnabled`,
  `${NS}orgHasFieldEventsMngEventParticipantTypeRecTypeMappingAccess`,
  `${NS}orgHasEvtPtcpTypeRoleSelectionEnabled`,
  `${NS}orgHasCaptureConsent`,
  `${NS}orgHasOptOutModalSetting`,
  `${NS}orgHasAccountSearchRelevanceSortingEnabled`,
  `${NS}orgHasEnablementCoachingBaseAug262Access`,
  `${NS}orgHasConfigurableTOTBaseAug262Access`,
  "IndustriesPricing.orgHasWaterfallEnabled",
  "IndustriesPricing.orgHasWaterfallPersistenceEnabled",
  "IndustriesPricing.isRunTimeOrAdminOrDesignTimeUser",
  ACCESS_CHECK_ENHANCED_SYNC,
  ACCESS_CHECK_LSC_OCE,
  `${NS}orgHasMobileIdleSyncEnabled`,
  `${NS}orgHasEmailFragmentTracking`,
  `${NS}orgHasAgentforceMobileCustomLwc`,
  `${NS}orgHasAgentforceMobileCustomTypes`,
  `${NS}orgHasVisitAgentEESEnabled`,
  `${NS}orgHasFieldEventsMngEventTypeRecTypeMappingAccess`,
  `${NS}orgHasMobileTransactionDependencyOnInsert`,
  `${NS}orgHasFieldEventsGroupVisitsAccess`,
  `${NS}orgHasCalendarEnableStaticResourceImage`,
  `${NS}orgHasVisitEngagementVisitors`,
  `${NS}orgHasVisitEngagementFiles`,
  ACCESS_CHECK_SERVER_HANDLES_CONTENT_IN_LIST,
  `${NS}orgHasShowFullShippingAddressInSignaturePage`,
  `${NS}userCanRequestConsentForHcpOnDevice`,
  "IndustriesMarketingResourceManagement.orgHasLscEventManagementAccess",
  `${NS}orgHasInstantPricingEnabled`,
  "Cpq.orgHasInstantPricingDefault",
  "IndustriesLsCommercial.userCanRunPricingOnMobile",
  `${NS}orgHasManageDelivery`,
];

export interface MetadataEntity {
  id: string;
  name: string;
  appVersionName?: string;
  appVersionNumber?: string;
  status?: string;
  updateDueDate?: string;
}

export interface Territory {
  id?: string;
  name: string;
  developerName?: string;
  level?: number;
  children: Territory[];
}

export interface UserInfo {
  apiVersion?: string;
  isOrgInMaintenance: boolean;
  syncSettings: Record<string, unknown>;
  accessChecks: Record<string, boolean>;
  metadataEntities: MetadataEntity[];
  /** Permission set API names assigned to the user. */
  permissionSets: string[];
  territories: Territory[];
  user: { id: string; name?: string; profileId?: string; profileName?: string; isForcedFullSync: boolean };
  mobileAppVersion?: unknown;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function parseTerritory(raw: unknown): Territory | undefined {
  const o = obj(raw);
  const name = str(o.name);
  if (!name) return undefined;
  const children = Array.isArray(o.children)
    ? o.children.map(parseTerritory).filter((t): t is Territory => t !== undefined)
    : [];
  return {
    id: str(o.id),
    name,
    developerName: str(o.developerName),
    level: typeof o.level === "number" ? o.level : undefined,
    children,
  };
}

/** Tolerant parse of the user-info response (every field optional on the wire). */
export function parseUserInfo(json: unknown): UserInfo {
  const o = obj(json);
  const accessChecks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(obj(o.accessCheckResults))) accessChecks[k] = v === true;

  const metadataEntities = (Array.isArray(o.metadataEntities) ? o.metadataEntities : []).flatMap((raw) => {
    const e = obj(raw);
    const id = str(e.id);
    const name = str(e.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        appVersionName: str(e.appVersionName),
        appVersionNumber: str(e.appVersionNumber),
        status: str(e.status),
        updateDueDate: str(e.updateDueDate),
      },
    ];
  });

  const permissionSets = (Array.isArray(o.permissionSets) ? o.permissionSets : [])
    .map((p) => (typeof p === "string" ? p : str(obj(p).name)))
    .filter((n): n is string => !!n);

  const territories = (Array.isArray(o.territoryHierarchy) ? o.territoryHierarchy : [])
    .map(parseTerritory)
    .filter((t): t is Territory => t !== undefined);

  const user = obj(o.user);
  const profile = obj(user.profile);
  return {
    apiVersion: str(o.apiVersion),
    isOrgInMaintenance: o.isOrgInMaintenance === true,
    syncSettings: obj(o.syncSettings),
    accessChecks,
    metadataEntities,
    permissionSets,
    territories,
    user: {
      id: str(user.id) ?? "",
      name: str(user.name),
      profileId: str(user.profileId) ?? str(profile.id),
      profileName: str(profile.name),
      isForcedFullSync: user.isForcedFullSync === true,
    },
    mobileAppVersion: o.mobileAppVersion,
  };
}

/** Same percent-encoding the app uses: urlQueryAllowed minus & = + , with "," as the joiner. */
export function encodeAccessChecks(checks: readonly string[]): string {
  return checks
    .map((c) => encodeURIComponent(c).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`))
    .join(",");
}

export function userInfoPath(session: Pick<DeviceSession, "apiVersion">, opts: { userDeviceId?: string } = {}): string {
  const params = ["configOnly=false", "mdName="];
  if (opts.userDeviceId) params.push(`userDeviceId=${encodeURIComponent(opts.userDeviceId)}`);
  params.push(`accessChecks=${encodeAccessChecks(ACCESS_CHECKS)}`);
  return connectPath(session, `life-sciences/commercial/mobile/user-info?${params.join("&")}`);
}

export async function fetchUserInfo(
  session: DeviceSession,
  opts: { userDeviceId?: string; signal?: AbortSignal } = {}
): Promise<UserInfo> {
  const res = await session.http({ method: "GET", url: userInfoPath(session, opts), signal: opts.signal });
  return parseUserInfo(jsonOrThrow(res, "user-info"));
}

export type SyncFlow = "enhanced" | "legacy";

/** Enhanced (Connect) flow: the sync setting AND one of the two org access checks. */
export function resolveFlow(info: Pick<UserInfo, "syncSettings" | "accessChecks">): SyncFlow {
  const enabled = info.syncSettings.enhancedSyncUsingConnectAPI === true;
  const gated = info.accessChecks[ACCESS_CHECK_ENHANCED_SYNC] === true || info.accessChecks[ACCESS_CHECK_LSC_OCE] === true;
  return enabled && gated ? "enhanced" : "legacy";
}

/** Depth-first flatten of the territory tree. */
export function flattenTerritories(territories: Territory[]): Territory[] {
  return territories.flatMap((t) => [t, ...flattenTerritories(t.children)]);
}

/**
 * Pick the territory a fresh device would sync under. The app lets the user
 * choose; by default the first leaf territory (depth-first) is used, falling
 * back to the first node. A name, id or developerName override is honored.
 */
export function selectTerritory(territories: Territory[], wanted?: string): Territory | undefined {
  const all = flattenTerritories(territories);
  if (wanted) {
    const w = wanted.toLowerCase();
    return all.find((t) => t.id?.toLowerCase() === w || t.name.toLowerCase() === w || t.developerName?.toLowerCase() === w);
  }
  return all.find((t) => t.children.length === 0) ?? all[0];
}
