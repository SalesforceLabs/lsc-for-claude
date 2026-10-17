interface LibraryItem {
  id: string;
  title: string;
  content: string;
  contentType: "response" | "code" | "diagram" | "table";
  svg?: string;
  sourceConversationId?: string;
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
  displayName?: string;
  orgId?: string;
  instanceUrl: string;
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
}

interface LscApi {
  // Settings
  getSettings(): Promise<{
    providerType: string;
    apiKey?: string;
    baseUrl?: string;
    authToken?: string;
    gatewayUrl?: string;
    gatewayToken?: string;
    model?: string;
    theme?: string;
    sfTargetOrg?: string;
  }>;
  saveSettings(settings: Record<string, unknown>): Promise<{ ok: boolean }>;

  // Provider
  detectEnvProvider(): Promise<{
    detected: boolean;
    providerType?: string;
    credentials?: Record<string, unknown>;
    label?: string;
  }>;
  validateProvider(
    type: string,
    credentials: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }>;

  // Studio — `data` is the parsed JSON from the studio_* MCP tool (may itself carry `error`)
  studioListFeatures(): Promise<StudioResponse>;
  studioFeatureMap(featureId: string, refresh?: boolean): Promise<StudioResponse>;
  studioItemDetail(kind: string, id: string): Promise<StudioResponse>;
  studioListProfiles(): Promise<StudioResponse>;
  studioUserAccess(userId: string): Promise<StudioResponse>;
  studioAccessOptions(): Promise<StudioResponse>;
  studioIpadPublished(profile: string, refresh?: boolean, userId?: string): Promise<StudioResponse>;
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
  studioSimStartMobile(loginId: string, options?: unknown): Promise<StudioResponse>;
  /** Log in through the LSC mobile app's connected app in a Salesforce login window. */
  mobileLoginStart(loginUrl: string): Promise<{ login?: MobileLoginInfo; error?: string }>;
  mobileLoginList(): Promise<{ logins: MobileLoginInfo[] }>;
  mobileLoginRemove(id: string): Promise<{ ok: boolean }>;
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
  listLibraryItems(): Promise<LibraryItem[]>;
  saveLibraryItem(input: {
    title: string;
    content: string;
    contentType: LibraryItem["contentType"];
    svg?: string;
    sourceConversationId?: string;
    tags?: string[];
  }): Promise<LibraryItem>;
  deleteLibraryItem(id: string): Promise<{ ok: boolean }>;
  searchLibraryItems(query: string): Promise<LibraryItem[]>;

  // Salesforce Org
  listSfOrgs(): Promise<{
    orgs: Array<{ alias?: string; username: string; orgId: string; instanceUrl: string; isDefault?: boolean }>;
    error?: string;
  }>;
  setSfOrg(org: string): Promise<{ ok: boolean }>;
  /** Called with the new org whenever Settings switches it; returns an unsubscribe function. */
  onSfOrgChanged(callback: (org: string) => void): () => void;
  loginSfOrg(alias?: string, instanceUrl?: string): Promise<{ ok: boolean; error?: string }>;

  // Engine
  startEngine(
    providerType: string,
    credentials: Record<string, unknown>
  ): Promise<{
    ok: boolean;
    toolCount?: number;
    tools?: Array<{ name: string; description: string }>;
    error?: string;
  }>;
  stopEngine(): Promise<{ ok: boolean }>;

  // Chat
  sendMessage(message: string | unknown[], nonce: number, convId: string, model?: string): Promise<{ ok: boolean; error?: string }>;
  abortChat(): Promise<{ ok: boolean }>;
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
  listConversations(): Promise<
    Array<{ id: string; title: string; pinned: boolean; createdAt: string; updatedAt: string }>
  >;
  createConversation(
    firstMessage: string
  ): Promise<{ id: string; title: string; pinned: boolean; createdAt: string; updatedAt: string }>;
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
