const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lscApi", {
  // Settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),

  // Provider
  detectEnvProvider: () => ipcRenderer.invoke("provider:detect-env"),
  validateProvider: (type, credentials) =>
    ipcRenderer.invoke("provider:validate", type, credentials),

  // Engine
  startEngine: (providerType, credentials) =>
    ipcRenderer.invoke("engine:start", providerType, credentials),
  stopEngine: () => ipcRenderer.invoke("engine:stop"),

  // Chat — nonce is passed to tag stream events, convId for server-side persistence
  sendMessage: (message, nonce, convId, model) => ipcRenderer.invoke("chat:send", message, nonce, convId, model),
  abortChat: () => ipcRenderer.invoke("chat:abort"),
  clearChat: () => ipcRenderer.invoke("chat:clear"),

  // Chat events — all events include nonce + convId
  onTextDelta: (callback) => {
    const handler = (_event, data) => callback(data.text, data.nonce, data.convId);
    ipcRenderer.on("chat:text-delta", handler);
    return () => ipcRenderer.removeListener("chat:text-delta", handler);
  },
  onToolStart: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chat:tool-start", handler);
    return () => ipcRenderer.removeListener("chat:tool-start", handler);
  },
  onToolResult: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chat:tool-result", handler);
    return () => ipcRenderer.removeListener("chat:tool-result", handler);
  },
  onToolEnd: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chat:tool-end", handler);
    return () => ipcRenderer.removeListener("chat:tool-end", handler);
  },
  onComplete: (callback) => {
    const handler = (_event, data) => callback(data.nonce, data.convId);
    ipcRenderer.on("chat:complete", handler);
    return () => ipcRenderer.removeListener("chat:complete", handler);
  },
  onError: (callback) => {
    const handler = (_event, data) => callback(data.error, data.nonce, data.convId);
    ipcRenderer.on("chat:error", handler);
    return () => ipcRenderer.removeListener("chat:error", handler);
  },

  // Commands & Skills
  listCommands: () => ipcRenderer.invoke("commands:list"),
  listSkills: () => ipcRenderer.invoke("skills:list"),

  // Salesforce Org
  listSfOrgs: () => ipcRenderer.invoke("sfOrg:list"),
  setSfOrg: (org) => ipcRenderer.invoke("sfOrg:set", org),
  onSfOrgChanged: (callback) => {
    const handler = (_event, data) => callback(data.org);
    ipcRenderer.on("sfOrg:changed", handler);
    return () => ipcRenderer.removeListener("sfOrg:changed", handler);
  },
  loginSfOrg: (alias, instanceUrl) => ipcRenderer.invoke("sfOrg:login", alias, instanceUrl),
  openSfOrg: (org) => ipcRenderer.invoke("sfOrg:open", org),
  studioBrowserOpen: (guestId, url, auth) => ipcRenderer.invoke("studioBrowser:open", guestId, url, auth),

  // Studio — read-only feature maps served by the studio_* MCP tools
  studioListFeatures: () => ipcRenderer.invoke("studio:call", "studio_list_features"),
  // Results are cached per org in the main process; `refresh` bypasses the cache.
  studioFeatureMap: (featureId, refresh = false) =>
    ipcRenderer.invoke("studio:call", "studio_feature_map", { featureId }, refresh),
  studioItemDetail: (kind, id) =>
    ipcRenderer.invoke("studio:call", "studio_item_detail", { kind, id }),
  studioListProfiles: () => ipcRenderer.invoke("studio:call", "studio_list_profiles"),
  studioUserAccess: (userId) => ipcRenderer.invoke("studio:call", "studio_user_access", { userId }),
  studioAccessOptions: () => ipcRenderer.invoke("studio:call", "studio_access_options"),
  studioLwcBundle: (name) => ipcRenderer.invoke("studio:call", "studio_lwc_bundle", { name }),
  studioLwcRequest: (method, path, body) => ipcRenderer.invoke("studio:call", "studio_lwc_request", body === undefined ? { method, path } : { method, path, body }),
  studioIpadPublished: (profile, refresh = false, userId) =>
    ipcRenderer.invoke("studio:call", "studio_ipad_published", userId ? { profile, userId } : { profile }, refresh),
  // Studio fixes — previewed, then applied only after the user confirms in the UI
  studioPreviewFix: (fix) => ipcRenderer.invoke("studio:call", "studio_preview_fix", { fix }),
  studioApplyFix: (fix, expectedOrg) =>
    ipcRenderer.invoke("studio:call", "studio_apply_fix", { fix, expectedOrg }),
  studioPublishMobile: (profiles, expectedOrg) =>
    ipcRenderer.invoke("studio:call", "studio_publish_mobile", { profiles, expectedOrg }),
  studioPublishStatus: (parentId) => ipcRenderer.invoke("studio:call", "studio_publish_status", { parentId }),
  // Studio performance testing — runs are read-only background jobs polled for progress
  studioPerfUsers: (search, profile, days) => ipcRenderer.invoke("studio:call", "studio_perf_users", { search, profile, days }),
  studioPerfParsePlan: (yaml) => ipcRenderer.invoke("studio:call", "studio_perf_parse_plan", { yaml }),
  studioPerfStart: (plan) => ipcRenderer.invoke("studio:call", "studio_perf_start", { plan }),
  studioPerfStatus: (jobId) => ipcRenderer.invoke("studio:call", "studio_perf_status", { jobId }),
  studioPerfCancel: (jobId) => ipcRenderer.invoke("studio:call", "studio_perf_cancel", { jobId }),
  studioPerfActive: () => ipcRenderer.invoke("studio:call", "studio_perf_active", {}),
  studioPerfCheck: (plan) => ipcRenderer.invoke("studio:call", "studio_perf_check", { plan }),
  studioPerfReport: (result, days) =>
    ipcRenderer.invoke("studio:call", "studio_perf_report", days === undefined ? { result } : { result, days }),
  studioPerfTerritories: (input) => ipcRenderer.invoke("studio:call", "studio_perf_territories", input),
  perfListPlans: () => ipcRenderer.invoke("perf:listPlans"),
  perfSavePlan: (input) => ipcRenderer.invoke("perf:savePlan", input),
  perfDeletePlan: (id) => ipcRenderer.invoke("perf:deletePlan", id),
  perfListRuns: (planId) => ipcRenderer.invoke("perf:listRuns", planId),
  perfGetRun: (id) => ipcRenderer.invoke("perf:getRun", id),
  perfSaveRun: (input) => ipcRenderer.invoke("perf:saveRun", input),
  perfDeleteRun: (id) => ipcRenderer.invoke("perf:deleteRun", id),
  // First-sync simulation — runs as a chosen sf CLI connection; finished results are kept locally
  studioSimStart: (connection, options) => ipcRenderer.invoke("studio:call", "studio_sim_start", { connection, options }),
  studioPerfStartMobile: (plan) => ipcRenderer.invoke("studio:perfStartMobile", plan),
  studioSimStartMobile: (loginId, options) => ipcRenderer.invoke("studio:simStartMobile", loginId, options),
  mobileLoginStart: (loginUrl) => ipcRenderer.invoke("mobileLogin:start", loginUrl),
  mobileLoginList: () => ipcRenderer.invoke("mobileLogin:list"),
  mobileLoginRemove: (id) => ipcRenderer.invoke("mobileLogin:remove", id),
  studioSimStatus: (jobId) => ipcRenderer.invoke("studio:call", "studio_sim_status", { jobId }),
  studioSimCancel: (jobId) => ipcRenderer.invoke("studio:call", "studio_sim_cancel", { jobId }),
  studioSimActive: () => ipcRenderer.invoke("studio:call", "studio_sim_active", {}),
  studioSimReport: (result) => ipcRenderer.invoke("studio:call", "studio_sim_report", { result }),
  perfListSims: () => ipcRenderer.invoke("perf:listSims"),
  perfGetSim: (id) => ipcRenderer.invoke("perf:getSim", id),
  perfSaveSim: (input) => ipcRenderer.invoke("perf:saveSim", input),
  perfDeleteSim: (id) => ipcRenderer.invoke("perf:deleteSim", id),
  perfOpenFile: () => ipcRenderer.invoke("perf:openFile"),
  perfSaveFile: (defaultName, text, kind) => ipcRenderer.invoke("perf:saveFile", defaultName, text, kind),

  // Library
  listLibraryItems: () => ipcRenderer.invoke("library:list"),
  saveLibraryItem: (input) => ipcRenderer.invoke("library:save", input),
  deleteLibraryItem: (id) => ipcRenderer.invoke("library:delete", id),
  searchLibraryItems: (query) => ipcRenderer.invoke("library:search", query),

  // Conversation History
  listConversations: () => ipcRenderer.invoke("history:list"),
  createConversation: (firstMessage) =>
    ipcRenderer.invoke("history:create", firstMessage),
  deleteConversation: (id) => ipcRenderer.invoke("history:delete", id),
  renameConversation: (id, title) =>
    ipcRenderer.invoke("history:rename", id, title),
  togglePinConversation: (id) =>
    ipcRenderer.invoke("history:toggle-pin", id),
  getConversationMessages: (conversationId) =>
    ipcRenderer.invoke("history:messages", conversationId),
  addConversationMessage: (conversationId, role, text, toolCalls) =>
    ipcRenderer.invoke("history:add-message", conversationId, role, text, toolCalls),

  // File reading
  readFile: (filePath) => ipcRenderer.invoke("file:read", filePath),
  openExternal: (url) => ipcRenderer.invoke("file:open-external", url),

  // Guide section reading
  readGuideSection: (guideSlug, sectionSlug) =>
    ipcRenderer.invoke("file:read-guide-section", guideSlug, sectionSlug),
  openPdfAtPage: (pdfFileName, page) =>
    ipcRenderer.invoke("file:open-pdf-at-page", pdfFileName, page),
  openPdfWindow: (pdfFileName, page) =>
    ipcRenderer.invoke("file:open-pdf-window", pdfFileName, page),
});
