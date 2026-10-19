import { ipcMain, type BrowserWindow } from "electron";
import type { LLMProvider } from "../llm/provider.js";
import type { McpClient } from "../mcp/client.js";
import { AppBuilder, parseStudioResult, type StudioCall } from "../engine/app-builder.js";
import { sqliteAppStore, type AppStore } from "../engine/app-store.js";
import type { AppBuilderEvent, AppDeployPlan, AppDeployResult, AppObjectInfo, AppProject, AppRunAs, AppStarter, AppTabSettings, AppTarget, OrgApp } from "../engine/app-types.js";
import { INVALIDATED_BY_APP_DEPLOY } from "../engine/studio-invalidation.js";

export interface AppBuilderDeps {
  mainWindow: BrowserWindow;
  llm: () => LLMProvider | null;
  /** The model to build with (see `pickBuilderModel`). */
  model: () => string | undefined;
  readyMcpClient: () => Promise<McpClient | null>;
  /** The selected org: its username (apps are filed under it) and the target the server must be on. */
  selectedOrg: () => Promise<{ username: string; target: string } | null>;
  /** Drop the selected org's cached Studio results after a deploy. */
  invalidate: (tools: string[]) => void;
  /** A test user's credentials by login id (main process only). */
  mobileLogin?: (loginId: string) => Promise<Record<string, unknown>>;
  store?: AppStore;
}

/** The server's `tab` input: the label, plus the profiles and app the user chose. */
function tabArg(project: AppProject): Record<string, unknown> {
  return { label: project.label, profiles: project.tab?.profiles ?? [], ...(project.tab?.application ? { application: project.tab.application } : {}) };
}

export function createAppBuilder(deps: AppBuilderDeps): { builder: AppBuilder; call: StudioCall } {
  const call: StudioCall = async (tool, args, timeoutMs = 120_000) => {
    const client = await deps.readyMcpClient();
    if (!client) throw new Error("Engine not started");
    return parseStudioResult(await client.callTool(tool, args, { timeoutMs }));
  };
  const send = (projectId: string, event: AppBuilderEvent) => {
    if (!deps.mainWindow.isDestroyed()) deps.mainWindow.webContents.send("appBuilder:event", { projectId, event });
  };
  const store = deps.store ?? sqliteAppStore;
  // Builds still "running" belong to a previous run of the app.
  store.recoverInterrupted();
  const builder = new AppBuilder({ llm: deps.llm, model: deps.model, call, store, emit: send, mobileLogin: deps.mobileLogin });
  return { builder, call };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function registerAppBuilderHandlers(deps: AppBuilderDeps): void {
  const { builder, call } = createAppBuilder(deps);
  const org = async () => (await deps.selectedOrg())?.username.toLowerCase() ?? "";

  ipcMain.handle("appBuilder:list", async () => {
    const o = await org();
    return o ? builder.list(o) : [];
  });
  ipcMain.handle("appBuilder:get", (_e, id: string) => builder.get(id));
  ipcMain.handle("appBuilder:create", async (_e, input: { prompt: string; target: AppTarget; objectApiName?: string; runAs?: AppRunAs }) => {
    const o = await org();
    if (!o) return { error: "Select an org first." };
    return builder.create(o, input);
  });
  ipcMain.handle("appBuilder:send", (_e, id: string, prompt: string) => builder.send(id, prompt));
  ipcMain.handle("appBuilder:stop", (_e, id: string) => builder.stop(id));
  ipcMain.handle("appBuilder:delete", (_e, id: string) => builder.delete(id));
  ipcMain.handle("appBuilder:setRunAs", (_e, id: string, runAs: AppRunAs | null) => builder.setRunAs(id, runAs));
  ipcMain.handle("appBuilder:rename", (_e, id: string, label: string) => builder.rename(id, label));
  ipcMain.handle("appBuilder:restore", (_e, id: string, versionId: string) => builder.restore(id, versionId));
  ipcMain.handle("appBuilder:editFile", (_e, id: string, path: string, source: string) => builder.editFile(id, path, source));
  ipcMain.handle("appBuilder:preview", (_e, id: string, versionId?: string) => builder.preview(id, versionId));
  ipcMain.handle("appBuilder:import", async (_e, name: string) => {
    const o = await org();
    if (!o) return { error: "Select an org first." };
    return builder.import(o, name);
  });

  ipcMain.handle("appBuilder:fromStarter", async (_e, id: string, runAs?: AppRunAs) => {
    const o = await org();
    if (!o) return { error: "Select an org first." };
    return builder.fromStarter(o, id, runAs);
  });

  ipcMain.handle("appBuilder:starters", async (): Promise<{ starters?: AppStarter[]; error?: string }> => {
    try {
      const data = (await call("studio_app_starters", {}, 60_000)) as { starters?: AppStarter[] };
      return { starters: data.starters ?? [] };
    } catch (error) {
      return { error: errorText(error) };
    }
  });

  ipcMain.handle("appBuilder:orgApps", async (): Promise<{ apps?: OrgApp[]; error?: string }> => {
    try {
      const data = (await call("studio_app_list", {}, 120_000)) as { apps?: OrgApp[] };
      return { apps: data.apps ?? [] };
    } catch (error) {
      return { error: errorText(error) };
    }
  });

  ipcMain.handle("appBuilder:describe", async (_e, objects: string[], projectId?: string): Promise<{ objects?: AppObjectInfo[]; error?: string }> => {
    try {
      const project = projectId ? builder.get(projectId) : undefined;
      const runAs = project ? await builder.runAsArgs(project) : {};
      const data = (await call("studio_app_describe", { objects, ...runAs }, 120_000)) as { objects?: AppObjectInfo[] };
      return { objects: data.objects ?? [] };
    } catch (error) {
      return { error: errorText(error) };
    }
  });

  ipcMain.handle("appBuilder:setTabSettings", (_e, id: string, tab: AppTabSettings | null) => builder.setTabSettings(id, tab));

  ipcMain.handle("appBuilder:deployPlan", async (_e, id: string): Promise<{ plan?: AppDeployPlan; error?: string }> => {
    const project = builder.get(id);
    const version = project && builder.currentVersion(project);
    if (!project || !version) return { error: "There's nothing to deploy yet." };
    try {
      const args: Record<string, unknown> = { name: project.name, target: project.target, files: version.files };
      if (project.objectApiName) args.objectApiName = project.objectApiName;
      if (project.target === "tab") args.tab = tabArg(project);
      return { plan: (await call("studio_app_deploy_plan", args, 120_000)) as AppDeployPlan };
    } catch (error) {
      const text = errorText(error);
      return { error: /unknown tool|not found|no such tool/i.test(text) ? "Deploy plan not available" : text };
    }
  });

  ipcMain.handle("appBuilder:deploy", async (_e, id: string): Promise<{ result?: AppDeployResult; error?: string }> => {
    const project = builder.get(id);
    const version = project && builder.currentVersion(project);
    if (!project || !version) return { error: "There's nothing to deploy yet." };
    if (builder.isRunning(id)) return { error: "Wait for Roz to finish this turn first." };
    const selected = await deps.selectedOrg();
    if (!selected) return { error: "Select an org first." };
    // A deploy that errored or timed out may still have landed, so Studio's cache is dropped either way.
    try {
      const args: Record<string, unknown> = {
        name: project.name,
        target: project.target,
        files: version.files,
        expectedOrg: selected.target,
      };
      if (project.objectApiName) args.objectApiName = project.objectApiName;
      if (project.target === "tab") args.tab = tabArg(project);
      const result = (await call("studio_app_deploy", args, 10 * 60_000)) as AppDeployResult;
      if (result.ok) builder.markDeployed(id, result.deployed);
      return { result };
    } catch (error) {
      return { error: errorText(error) };
    } finally {
      deps.invalidate(INVALIDATED_BY_APP_DEPLOY);
    }
  });
}
