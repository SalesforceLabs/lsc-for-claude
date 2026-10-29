const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lscApi", {
  // Settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  previewTheme: (theme) => ipcRenderer.invoke("theme:preview", theme),

  // App updates (src-electron/updater.ts)
  updateGet: () => ipcRenderer.invoke("update:get"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateInstall: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on("update:state", handler);
    return () => ipcRenderer.removeListener("update:state", handler);
  },

  // Connections — secrets go to the main process (keychain) and never come back
  detectProvider: () => ipcRenderer.invoke("provider:detect"),
  testProvider: (connection, secret) => ipcRenderer.invoke("provider:test", connection, secret),

  // Engine
  startEngine: (connection, secret) => ipcRenderer.invoke("engine:start", connection, secret),
  stopEngine: () => ipcRenderer.invoke("engine:stop"),
  onEngineTools: (callback) => {
    const handler = (_event, data) => callback(data.toolCount);
    ipcRenderer.on("engine:tools", handler);
    return () => ipcRenderer.removeListener("engine:tools", handler);
  },

  // Chat — nonce is passed to tag stream events, convId for server-side persistence
  sendMessage: (message, nonce, convId, model) => ipcRenderer.invoke("chat:send", message, nonce, convId, model),
  abortChat: (convId) => ipcRenderer.invoke("chat:abort", convId),
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
  onToolRun: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chat:tool-run", handler);
    return () => ipcRenderer.removeListener("chat:tool-run", handler);
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
  // A chat write queued for review in Studio's tray instead of run
  onTrayQueue: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("tray:queue", handler);
    return () => ipcRenderer.removeListener("tray:queue", handler);
  },
  // A chat write with no Studio change waits for the user to allow or deny it
  onApprovalRequest: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chat:approval-request", handler);
    return () => ipcRenderer.removeListener("chat:approval-request", handler);
  },
  onApprovalSettled: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chat:approval-settled", handler);
    return () => ipcRenderer.removeListener("chat:approval-settled", handler);
  },
  respondApproval: (requestId, allow) => ipcRenderer.invoke("chat:approval-respond", requestId, allow),
  listApprovals: () => ipcRenderer.invoke("chat:approval-list"),
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
  listSfOrgs: (options) => ipcRenderer.invoke("sfOrg:list", options),
  onSfOrgRoles: (cb) => {
    const handler = (_event, roles) => cb(roles);
    ipcRenderer.on("sfOrg:roles", handler);
    return () => ipcRenderer.removeListener("sfOrg:roles", handler);
  },
  setSfOrg: (org) => ipcRenderer.invoke("sfOrg:set", org),
  onSfOrgListed: (callback) => {
    const handler = (_event, list) => callback(list);
    ipcRenderer.on("sfOrg:listed", handler);
    return () => ipcRenderer.removeListener("sfOrg:listed", handler);
  },
  onSfOrgChanged: (callback) => {
    const handler = (_event, data) => callback(data.org);
    ipcRenderer.on("sfOrg:changed", handler);
    return () => ipcRenderer.removeListener("sfOrg:changed", handler);
  },
  loginSfOrg: (alias, instanceUrl) => ipcRenderer.invoke("sfOrg:login", alias, instanceUrl),
  onSfOrgLoginDone: (callback) => {
    const handler = (_event, result) => callback(result);
    ipcRenderer.on("sfOrg:loginDone", handler);
    return () => ipcRenderer.removeListener("sfOrg:loginDone", handler);
  },
  openSfOrg: (org, path) => ipcRenderer.invoke("sfOrg:open", org, path),
  studioBrowserOpen: (guestId, url, auth) => ipcRenderer.invoke("studioBrowser:open", guestId, url, auth),

  // --- custom scripts: assist ---
  studioScriptAssist: (requestId, request) => ipcRenderer.invoke("studio:scriptAssist", requestId, request),
  studioScriptAssistAbort: (requestId) => ipcRenderer.invoke("studio:scriptAssistAbort", requestId),
  onScriptAssistEvent: (callback) => {
    const channels = ["delta", "tool", "done", "error"];
    const handlers = channels.map((kind) => {
      const handler = (_event, data) => callback({ kind, ...data });
      ipcRenderer.on(`studio:scriptAssist-${kind}`, handler);
      return [kind, handler];
    });
    return () => handlers.forEach(([kind, handler]) => ipcRenderer.removeListener(`studio:scriptAssist-${kind}`, handler));
  },

  // Studio — read-only feature maps served by the studio_* MCP tools
  studioListFeatures: () => ipcRenderer.invoke("studio:call", "studio_list_features"),
  // Results are cached per org in the main process; `refresh` bypasses the cache.
  studioFeatureMap: (featureId, refresh = false) =>
    ipcRenderer.invoke("studio:call", "studio_feature_map", { featureId }, refresh),
  studioReadiness: (featureId, refresh = false, profile) =>
    ipcRenderer.invoke("studio:call", "studio_readiness", profile ? { featureId, profile } : { featureId }, refresh),
  studioSetupOverview: (refresh = false, profile) =>
    ipcRenderer.invoke("studio:call", "studio_setup_overview", profile ? { profile } : {}, refresh),
  studioScope: () => ipcRenderer.invoke("studio:call", "studio_scope"),
  studioUserTrace: (userId, featureId) =>
    ipcRenderer.invoke("studio:call", "studio_user_trace", featureId ? { userId, featureId } : { userId }),
  studioDrift: (input) => ipcRenderer.invoke("studio:call", "studio_drift", input),
  studioDiagnose: (text, checkOrg = true) => ipcRenderer.invoke("studio:call", "studio_diagnose", { text, checkOrg }),
  studioItemDetail: (kind, id) =>
    ipcRenderer.invoke("studio:call", "studio_item_detail", { kind, id }),
  studioMetadataDoc: (type, fullName) => ipcRenderer.invoke("studio:call", "studio_metadata_doc", { type, fullName }),
  studioAppNav: (profile, tabs) => ipcRenderer.invoke("studio:call", "studio_app_nav", { profile, tabs }),
  studioPageReach: (fullName) => ipcRenderer.invoke("studio:call", "studio_page_reach", { fullName }),
  studioComponentCatalog: (pageType, sobject) => ipcRenderer.invoke("studio:call", "studio_component_catalog", { pageType, sobject }),
  studioComponentProps: (component, pageType) => ipcRenderer.invoke("studio:call", "studio_component_props", { component, pageType }),
  studioSetupLinks: (refs) => ipcRenderer.invoke("studio:call", "studio_setup_links", { refs }),
  studioListProfiles: () => ipcRenderer.invoke("studio:call", "studio_list_profiles"),
  studioAppTabOptions: () => ipcRenderer.invoke("studio:call", "studio_app_tab_options"),
  studioUserAccess: (userId) => ipcRenderer.invoke("studio:call", "studio_user_access", { userId }),
  studioAccessOptions: (search) => ipcRenderer.invoke("studio:call", "studio_access_options", search ? { search } : {}),
  studioLwcBundle: (name) => ipcRenderer.invoke("studio:call", "studio_lwc_bundle", { name }),
  studioLwcRequest: (method, path, body) => ipcRenderer.invoke("studio:call", "studio_lwc_request", body === undefined ? { method, path } : { method, path, body }),
  studioLwcRequestAs: (loginId, method, path, body) =>
    ipcRenderer.invoke("studio:lwcRequestAs", loginId, body === undefined ? { method, path } : { method, path, body }),
  studioIpadPublished: (profile, refresh = false, userId) =>
    ipcRenderer.invoke("studio:call", "studio_ipad_published", userId ? { profile, userId } : { profile }, refresh),
  studioIpadPublishedUsers: (profile, search) => ipcRenderer.invoke("studio:call", "studio_ipad_published_users", { profile, search }),
  studioUnpublished: (profile, known, refresh = false) =>
    ipcRenderer.invoke("studio:call", "studio_unpublished", known ? { profile, known } : { profile }, refresh),
  studioIpadReports: (userId) => ipcRenderer.invoke("studio:call", "studio_ipad_reports", { userId }),
  studioReportData: (reportId, userId) => ipcRenderer.invoke("studio:call", "studio_report_data", userId ? { reportId, userId } : { reportId }),
  studioIpadPublishedProgress: (profile) => ipcRenderer.invoke("studio:call", "studio_ipad_published_progress", { profile }),
  // --- custom scripts: editor ---
  // The library is cached in the main process; `refresh` bypasses the cache. A single script is never cached.
  studioCustomScripts: (refresh = false) => ipcRenderer.invoke("studio:call", "studio_custom_scripts", {}, refresh),
  studioCustomScript: (id) => ipcRenderer.invoke("studio:call", "studio_custom_script", { id }),
  // --- custom scripts: runner ---
  // Read-only: records to test against, and a simulated run of the editor's code against one of them. Never cached.
  studioScriptTestRecords: (args) => ipcRenderer.invoke("studio:call", "studio_script_test_records", args, false),
  studioScriptTest: (args) => ipcRenderer.invoke("studio:call", "studio_script_test", args, false),
  // Studio fixes — previewed, then applied only after the user confirms in the UI
  studioPreviewFix: (fix, progress) => ipcRenderer.invoke("studio:call", "studio_preview_fix", { fix, ...(progress ? { progress } : {}) }),
  studioApplyFix: (fix, expectedOrg, progress) =>
    ipcRenderer.invoke("studio:call", "studio_apply_fix", { fix, expectedOrg, ...(progress ? { progress } : {}) }),
  // Which step each change of a running preview or apply is on (no org calls, never cached)
  studioFeatureMapProgress: (featureId, readiness = false) => ipcRenderer.invoke("studio:call", "studio_feature_map_progress", { featureId, readiness }),
  studioFixProgress: (id) => ipcRenderer.invoke("studio:call", "studio_fix_progress", { id }),
  studioPublishMobile: (profiles, expectedOrg) =>
    ipcRenderer.invoke("studio:call", "studio_publish_mobile", { profiles, expectedOrg }),
  studioPublishStatus: (parentId) => ipcRenderer.invoke("studio:call", "studio_publish_status", { parentId }),
  // Metadata cache page (read-only; ZIPs are downloaded by the engine and saved through a dialog)
  studioMetadataCache: () => ipcRenderer.invoke("studio:call", "studio_metadata_cache", {}),
  studioMetadataCacheLog: (recordId) => ipcRenderer.invoke("studio:call", "studio_metadata_cache_log", { recordId }),
  studioMetadataCacheContents: (recordId) => ipcRenderer.invoke("studio:call", "studio_metadata_cache_contents", { recordId }),
  studioMetadataCacheFile: (recordId, path) => ipcRenderer.invoke("studio:call", "studio_metadata_cache_file", { recordId, path }),
  studioSaveMetadataCache: (recordId) => ipcRenderer.invoke("studio:saveMetadataCache", recordId),
  // Object sync page (read-only; its changes go through the tray)
  studioObjectSync: () => ipcRenderer.invoke("studio:call", "studio_object_sync", {}),
  studioObjectSyncCheck: (developerNames) => ipcRenderer.invoke("studio:call", "studio_object_sync_check", { developerNames }),
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
  // Sync health — org-wide overview, one user's drill-down, what-if impact, sign-off report
  studioConnectedOrg: () => ipcRenderer.invoke("studio:call", "studio_connected_org", {}),
  // Cached for an hour in the main process; `refresh` bypasses the cache.
  studioSyncOverview: (days, refresh = false) =>
    ipcRenderer.invoke("studio:call", "studio_sync_overview", days === undefined ? {} : { days }, refresh),
  studioSyncUser: (userId, days, refresh = false) =>
    ipcRenderer.invoke("studio:call", "studio_sync_user", days === undefined ? { userId } : { userId, days }, refresh),
  // How far a running studioSyncUser has got (no org calls, never cached)
  studioSyncUserProgress: (userId) => ipcRenderer.invoke("studio:call", "studio_sync_user_progress", { userId }),
  studioSyncImpact: (changes, profiles) =>
    ipcRenderer.invoke("studio:call", "studio_sync_impact", profiles === undefined ? { changes } : { changes, profiles }),
  studioSignoffReport: (input) => ipcRenderer.invoke("studio:call", "studio_signoff_report", input),
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
  mobileLoginCheck: () => ipcRenderer.invoke("mobileLogin:check"),
  mobileLoginRenew: (id) => ipcRenderer.invoke("mobileLogin:renew", id),
  onMobileLoginsChanged: (cb) => {
    const handler = (_event, logins) => cb(logins);
    ipcRenderer.on("mobileLogin:changed", handler);
    return () => ipcRenderer.removeListener("mobileLogin:changed", handler);
  },
  studioSimStatus: (jobId) => ipcRenderer.invoke("studio:call", "studio_sim_status", { jobId }),
  studioSimCancel: (jobId) => ipcRenderer.invoke("studio:call", "studio_sim_cancel", { jobId }),
  studioSimActive: () => ipcRenderer.invoke("studio:call", "studio_sim_active", {}),
  studioSimReport: (result) => ipcRenderer.invoke("studio:call", "studio_sim_report", { result }),
  perfListSims: () => ipcRenderer.invoke("perf:listSims"),
  perfGetSim: (id) => ipcRenderer.invoke("perf:getSim", id),
  perfSaveSim: (input) => ipcRenderer.invoke("perf:saveSim", input),
  perfDeleteSim: (id) => ipcRenderer.invoke("perf:deleteSim", id),
  perfOpenFile: () => ipcRenderer.invoke("perf:openFile"),
  sourceControlGet: () => ipcRenderer.invoke("sourceControl:get"),
  sourceControlSet: (deployed) => ipcRenderer.invoke("sourceControl:set", deployed),
  apiVersionGet: () => ipcRenderer.invoke("apiVersion:get"),
  apiVersionSet: (version) => ipcRenderer.invoke("apiVersion:set", version),
  studioExportSource: (changes, items) => ipcRenderer.invoke("studio:exportSource", changes, items),
  perfSaveFile: (defaultName, text, kind) => ipcRenderer.invoke("perf:saveFile", defaultName, text, kind),

  // LSC App Builder — projects per org, turns run in the main process and stream events
  appList: () => ipcRenderer.invoke("appBuilder:list"),
  appGet: (id) => ipcRenderer.invoke("appBuilder:get", id),
  appCreate: (input) => ipcRenderer.invoke("appBuilder:create", input),
  appSend: (id, prompt) => ipcRenderer.invoke("appBuilder:send", id, prompt),
  appStop: (id) => ipcRenderer.invoke("appBuilder:stop", id),
  appDelete: (id) => ipcRenderer.invoke("appBuilder:delete", id),
  appSetRunAs: (id, runAs) => ipcRenderer.invoke("appBuilder:setRunAs", id, runAs),
  appSetTabSettings: (id, tab) => ipcRenderer.invoke("appBuilder:setTabSettings", id, tab),
  appDeployPlan: (id) => ipcRenderer.invoke("appBuilder:deployPlan", id),
  appRename: (id, label) => ipcRenderer.invoke("appBuilder:rename", id, label),
  appRestore: (id, versionId) => ipcRenderer.invoke("appBuilder:restore", id, versionId),
  appEditFile: (id, path, source) => ipcRenderer.invoke("appBuilder:editFile", id, path, source),
  appPreview: (id, versionId) => ipcRenderer.invoke("appBuilder:preview", id, versionId),
  appDeploy: (id) => ipcRenderer.invoke("appBuilder:deploy", id),
  appImport: (name) => ipcRenderer.invoke("appBuilder:import", name),
  appOrgApps: () => ipcRenderer.invoke("appBuilder:orgApps"),
  appStarters: () => ipcRenderer.invoke("appBuilder:starters"),
  appFromStarter: (id, runAs) => ipcRenderer.invoke("appBuilder:fromStarter", id, runAs),
  appDescribe: (objects, projectId) => ipcRenderer.invoke("appBuilder:describe", objects, projectId),
  onAppEvent: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("appBuilder:event", handler);
    return () => ipcRenderer.removeListener("appBuilder:event", handler);
  },

  // Library
  listLibraryItems: (scope) => ipcRenderer.invoke("library:list", scope),
  saveLibraryItem: (input) => ipcRenderer.invoke("library:save", input),
  deleteLibraryItem: (id) => ipcRenderer.invoke("library:delete", id),
  searchLibraryItems: (query, scope) => ipcRenderer.invoke("library:search", query, scope),

  // Conversation History
  listConversations: (scope) => ipcRenderer.invoke("history:list", scope),
  searchConversations: (query, scope) => ipcRenderer.invoke("history:search", query, scope),
  getConversation: (id) => ipcRenderer.invoke("history:get", id),
  moveConversationsToOrg: (ids) => ipcRenderer.invoke("history:move-to-org", ids),
  deleteConversations: (ids) => ipcRenderer.invoke("history:delete-many", ids),
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

  // Live LWC preview documents, served as lsc-frame:// with their own CSP
  registerFrame: (html) => ipcRenderer.invoke("frame:register", html),
  releaseFrame: (url) => ipcRenderer.invoke("frame:release", url),

  // Guide section reading
  readGuideSection: (guideSlug, sectionSlug) =>
    ipcRenderer.invoke("file:read-guide-section", guideSlug, sectionSlug),
  openPdfAtPage: (pdfFileName, page) =>
    ipcRenderer.invoke("file:open-pdf-at-page", pdfFileName, page),
  openPdfWindow: (pdfFileName, page) =>
    ipcRenderer.invoke("file:open-pdf-window", pdfFileName, page),
});
