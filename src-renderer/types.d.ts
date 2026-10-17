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
