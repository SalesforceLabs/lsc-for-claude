import type { LlmConnection, LlmConnectionKind, LlmConnectionTest } from "./connection";
import type { AppTheme } from "./theme";
import type { OrgRef, OrgRole, SfOrg } from "./orgs";

/** A chat session; `org` is the org it works in, null for sessions from before orgs were recorded. */
export interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  org: OrgRef | null;
}

/** Sessions and Library items are scoped to the selected org (plus those tied to none), or `all`. */
export type OrgScope = "org" | "all";

export interface LibraryItem {
  id: string;
  title: string;
  content: string;
  contentType: "response" | "code" | "diagram" | "table";
  svg?: string;
  sourceConversationId?: string;
  sourceConversationTitle?: string;
  /** The org the item came from; null if it isn't known. */
  org: OrgRef | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PerfPlanRecord {
  id: string;
  org: string;
  name: string;
  plan: unknown;
  updatedAt: string;
}

export interface PerfRunRecord {
  id: string;
  org: string;
  planId: string;
  planName: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  /** A RunSummary (see components/studio/perf-history.ts); null for runs saved before summaries. */
  summary?: unknown;
  result?: unknown;
}

/** A login made through the LSC mobile app's connected app; the token never reaches the renderer. */
export interface MobileLoginInfo {
  id: string;
  username: string;
  /** The user's Id, so the iPad preview can pick the login for the rep it shows. */
  userId?: string;
  displayName?: string;
  orgId?: string;
  instanceUrl: string;
  /** `expired`: Salesforce turned the refresh token down — sign in again. */
  status: "signedIn" | "expired";
  /** Kept across restarts (in the keychain); false when it ends when Roz quits. */
  remembered: boolean;
}

export interface PerfSimRecord {
  id: string;
  /** Instance URL of the org the simulation ran against. */
  org: string;
  connection: string;
  status: "done" | "cancelled";
  startedAt: string;
  finishedAt: string;
  /** A SimSummary (see components/studio/sim-types.ts). */
  summary: unknown;
  result?: unknown;
}

interface StudioResponse {
  data?: unknown & { error?: string };
  error?: string;
  /** When the answer was read from the org (ISO) — earlier than now when it came from the cache. */
  cachedAt?: string;
}

interface LscApi {
  // Settings
  getSettings(): Promise<{
    connection?: LlmConnection;
    model?: string;
    theme?: AppTheme;
    sfTargetOrg?: string;
    mobileClientId?: string;
    appIcon?: string;
  }>;
  saveSettings(settings: Record<string, unknown>): Promise<{ ok: boolean }>;
  /** Shows an appearance without saving it (Settings' live preview). */
  previewTheme(theme: AppTheme): Promise<void>;

  // Connections
  /** What's available without asking: Claude Code's gateway host, env API keys, kinds with a saved key. */
  detectProvider(): Promise<{
    claudeCode?: string;
    env: { anthropic: boolean; openai: boolean };
    savedSecrets: LlmConnectionKind[];
  }>;
  /** List models and send one tiny message; `secret` overrides the saved key for this test. */
  testProvider(connection: LlmConnection, secret?: string): Promise<LlmConnectionTest>;

  // Studio — `data` is the parsed JSON from the studio_* MCP tool (may itself carry `error`)
  studioListFeatures(): Promise<StudioResponse>;
  studioFeatureMap(featureId: string, refresh?: boolean): Promise<StudioResponse>;
  studioReadiness(featureId: string, refresh?: boolean): Promise<StudioResponse>;
  studioSetupOverview(refresh?: boolean): Promise<StudioResponse>;
  studioUserTrace(userId: string, featureId?: string): Promise<StudioResponse>;
  studioDrift(
    input: { action: "list"; days?: number } | { action: "save"; label?: string } | { action: "diff"; id: string } | { action: "delete"; id: string }
  ): Promise<StudioResponse>;
  studioItemDetail(kind: string, id: string): Promise<StudioResponse>;
  studioListProfiles(): Promise<StudioResponse>;
  studioUserAccess(userId: string): Promise<StudioResponse>;
  studioAccessOptions(search?: string): Promise<StudioResponse>;
  studioLwcBundle(name: string): Promise<StudioResponse>;
  studioLwcRequest(method: "GET" | "POST", path: string, body?: unknown): Promise<StudioResponse>;
  /** As the previewed rep's mobile login instead of the sf CLI connection. */
  studioLwcRequestAs(loginId: string, method: "GET" | "POST", path: string, body?: unknown): Promise<StudioResponse>;
  studioIpadPublished(profile: string, refresh?: boolean, userId?: string): Promise<StudioResponse>;
  studioIpadPublishedUsers(profile: string, search: string): Promise<StudioResponse>;
  studioIpadPublishedProgress(profile: string): Promise<StudioResponse>;
  studioPreviewFix(fix: unknown): Promise<StudioResponse>;
  studioApplyFix(fix: unknown, expectedOrg: string): Promise<StudioResponse>;
  studioPublishMobile(profiles: string[], expectedOrg: string): Promise<StudioResponse>;
  studioPublishStatus(parentId: string): Promise<StudioResponse>;
  studioPerfUsers(search?: string, profile?: string, days?: number): Promise<StudioResponse>;
  studioPerfParsePlan(yaml: string): Promise<StudioResponse>;
  studioPerfStart(plan: unknown): Promise<StudioResponse>;
  studioPerfStatus(jobId: string): Promise<StudioResponse>;
  studioPerfCancel(jobId: string): Promise<StudioResponse>;
  studioPerfActive(): Promise<StudioResponse>;
  studioPerfCheck(plan: unknown): Promise<StudioResponse>;
  studioPerfReport(result: unknown, days?: number): Promise<StudioResponse>;
  studioPerfTerritories(input: { users: string[]; select?: { profile: string; count?: number } }): Promise<StudioResponse>;
  studioConnectedOrg(): Promise<StudioResponse>;
  studioSyncOverview(days?: number, refresh?: boolean): Promise<StudioResponse>;
  studioSyncUser(userId: string, days?: number, refresh?: boolean): Promise<StudioResponse>;
  studioSyncImpact(changes: unknown[], profiles?: string[]): Promise<StudioResponse>;
  studioSignoffReport(input: { assessment: unknown; simulations?: unknown[]; baseline?: unknown; days?: number }): Promise<StudioResponse>;

  // Studio performance testing — plans and run history, stored per org by the main process
  perfListPlans(): Promise<PerfPlanRecord[]>;
  perfSavePlan(input: { id?: string; name: string; plan: unknown }): Promise<PerfPlanRecord>;
  perfDeletePlan(id: string): Promise<{ ok: boolean }>;
  perfListRuns(planId: string): Promise<PerfRunRecord[]>;
  perfGetRun(id: string): Promise<PerfRunRecord | null>;
  perfSaveRun(input: Omit<PerfRunRecord, "id" | "org"> & { org?: string; result: unknown }): Promise<PerfRunRecord>;
  perfDeleteRun(id: string): Promise<{ ok: boolean }>;
  studioSimStart(connection: string, options?: unknown): Promise<StudioResponse>;
  /** Start a simulation as a mobile login; the token stays in the main process. */
  /** Like studioPerfStart, also handing the engine the held mobile logins so their users get exact table lists. */
  studioPerfStartMobile(plan: unknown): Promise<StudioResponse>;
  studioSimStartMobile(loginId: string, options?: unknown): Promise<StudioResponse>;
  /** Log in through the LSC mobile app's connected app in a Salesforce login window. */
  mobileLoginStart(loginUrl: string): Promise<{ login?: MobileLoginInfo; error?: string }>;
  mobileLoginList(): Promise<{ logins: MobileLoginInfo[] }>;
  mobileLoginRemove(id: string): Promise<{ ok: boolean }>;
  mobileLoginCheck(): Promise<{ logins: MobileLoginInfo[] }>;
  mobileLoginRenew(id: string): Promise<{ login?: MobileLoginInfo; error?: string }>;
  onMobileLoginsChanged(callback: (logins: MobileLoginInfo[]) => void): () => void;
  studioSimStatus(jobId: string): Promise<StudioResponse>;
  studioSimCancel(jobId: string): Promise<StudioResponse>;
  studioSimActive(): Promise<StudioResponse>;
  studioSimReport(result: unknown): Promise<StudioResponse>;
  // First-sync simulation history, across every org and connection
  perfListSims(): Promise<PerfSimRecord[]>;
  perfGetSim(id: string): Promise<PerfSimRecord | null>;
  perfSaveSim(input: Omit<PerfSimRecord, "id"> & { result: unknown }): Promise<PerfSimRecord>;
  perfDeleteSim(id: string): Promise<{ ok: boolean }>;
  perfOpenFile(): Promise<{ canceled: boolean; text?: string }>;
  perfSaveFile(defaultName: string, text: string, kind: "yaml" | "json" | "md"): Promise<{ canceled: boolean; path?: string }>;

  // Library
  listLibraryItems(scope?: OrgScope): Promise<LibraryItem[]>;
  saveLibraryItem(input: {
    title: string;
    content: string;
    contentType: LibraryItem["contentType"];
    svg?: string;
    sourceConversationId?: string;
    tags?: string[];
  }): Promise<LibraryItem>;
  deleteLibraryItem(id: string): Promise<{ ok: boolean }>;
  searchLibraryItems(query: string, scope?: OrgScope): Promise<LibraryItem[]>;

  // Salesforce Org
  /** `recheckRoles` checks again which connections are LSC admins (otherwise once a day). */
  listSfOrgs(options?: { recheckRoles?: boolean }): Promise<{ orgs: SfOrg[]; error?: string }>;
  /** Roles by lowercased username, sent as background checks finish. */
  onSfOrgRoles(callback: (roles: Record<string, OrgRole>) => void): () => void;
  /** Select the org for Studio, Library and new sessions; returns the key it was stored as. */
  setSfOrg(org: string): Promise<{ ok: boolean; org: string }>;
  /** Called with the new org whenever Settings or the status bar switches it; returns an unsubscribe function. */
  onSfOrgChanged(callback: (org: string) => void): () => void;
  loginSfOrg(alias?: string, instanceUrl?: string): Promise<{ ok: boolean; error?: string }>;
  /** Open the org in the default browser through its sf CLI connection. */
  openSfOrg(org: string): Promise<{ ok: boolean; error?: string }>;
  /** Load `url` into a Studio preview <webview> in `auth`'s partition, signed in as that user when it's a page of their org. */
  studioBrowserOpen(
    guestId: number,
    url: string,
    auth: { loginId: string } | { cli: true } | { public: true }
  ): Promise<{ signedInAs?: string; note?: string; error?: string }>;

  // Engine
  /** Connect; a given `secret` is saved to the keychain on success. */
  startEngine(
    connection: LlmConnection,
    secret?: string
  ): Promise<{
    ok: boolean;
    providerType?: LlmConnectionKind;
    apiStyle?: "anthropic" | "openai";
    label?: string;
    defaultModel?: string;
    toolCount?: number;
    tools?: Array<{ name: string; description: string }>;
    /** Model ids the provider serves, when it lists them (gateways). */
    models?: string[];
    error?: string;
  }>;
  stopEngine(): Promise<{ ok: boolean }>;

  // Chat
  sendMessage(message: string | unknown[], nonce: number, convId: string, model?: string): Promise<{ ok: boolean; error?: string }>;
  abortChat(convId: string): Promise<{ ok: boolean }>;
  clearChat(): Promise<{ ok: boolean }>;

  // Chat events — all include nonce + convId to identify which stream they belong to
  onTextDelta(callback: (text: string, nonce: number, convId: string) => void): () => void;
  onToolStart(callback: (data: { id: string; name: string; nonce: number; convId: string }) => void): () => void;
  onToolResult(
    callback: (data: { id: string; result: string; isError: boolean; nonce: number; convId: string }) => void
  ): () => void;
  onToolEnd(callback: (data: { id: string; nonce: number; convId: string }) => void): () => void;
  onComplete(callback: (nonce: number, convId: string) => void): () => void;
  onError(callback: (error: string, nonce: number, convId: string) => void): () => void;

  // Commands & Skills
  listCommands(): Promise<Array<{ name: string; description: string }>>;
  listSkills(): Promise<Array<{ name: string; description: string }>>;

  // Conversation History
  listConversations(scope?: OrgScope): Promise<Conversation[]>;
  searchConversations(query: string, scope?: OrgScope): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  /** Ties sessions that have no org yet to the selected org. */
  moveConversationsToOrg(ids: string[]): Promise<{ ok: boolean; moved: number; error?: string }>;
  deleteConversations(ids: string[]): Promise<{ ok: boolean }>;
  /** Creates a session in the org selected now. */
  createConversation(firstMessage: string): Promise<Conversation>;
  togglePinConversation(id: string): Promise<{ ok: boolean }>;
  deleteConversation(id: string): Promise<{ ok: boolean }>;
  renameConversation(id: string, title: string): Promise<{ ok: boolean }>;
  getConversationMessages(
    conversationId: string
  ): Promise<
    Array<{
      id: string;
      conversationId: string;
      role: "user" | "assistant";
      text: string;
      toolCalls?: string;
      createdAt: string;
    }>
  >;
  // File reading
  readFile(filePath: string): Promise<{ ok: boolean; content?: string; path?: string; error?: string }>;
  openExternal(url: string): Promise<{ ok: boolean }>;

  // Guide section reading
  readGuideSection(guideSlug: string, sectionSlug: string): Promise<{
    ok: boolean;
    content?: string;
    guideTitle?: string;
    guideSlug?: string;
    pdfFileName?: string;
    pdfUrl?: string;
    pdfPath?: string;
    sectionTitle?: string;
    sectionSlug?: string;
    startPage?: number;
    endPage?: number;
    error?: string;
  }>;
  openPdfAtPage(pdfFileName: string, page: number): Promise<{ ok: boolean; error?: string }>;
  openPdfWindow(pdfFileName: string, page: number): Promise<{ ok: boolean; error?: string }>;

  addConversationMessage(
    conversationId: string,
    role: "user" | "assistant",
    text: string,
    toolCalls?: unknown[]
  ): Promise<{ id: string }>;
}

declare global {
  interface Window {
    lscApi: LscApi;
  }
}

export {};
