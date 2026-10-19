import type { AppBuilderEvent, AppCheckResult, AppDeployPlan, AppDeployResult, AppRunAs, AppTabSettings, AppObjectInfo, AppProject, AppStarter, AppTarget, AppVersion, OrgApp } from "./types";

/** The builder's part of `window.lscApi` (preload.cjs; shapes in docs/design/lsc-app-builder.md). */
export interface BuilderApi {
  appList(): Promise<AppProject[]>;
  appGet(id: string): Promise<AppProject | null>;
  appCreate(input: { prompt: string; target: AppTarget; objectApiName?: string; runAs?: AppRunAs }): Promise<{ project?: AppProject; error?: string }>;
  appSend(id: string, prompt: string): Promise<{ ok: boolean; error?: string }>;
  appSetRunAs(id: string, runAs: AppRunAs | null): Promise<void>;
  /** Absent until the backend has the deploy plan. */
  appDeployPlan?(id: string): Promise<{ plan?: AppDeployPlan; error?: string }>;
  appSetTabSettings?(id: string, tab: AppTabSettings | null): Promise<void>;
  appStop(id: string): Promise<void>;
  appDelete(id: string): Promise<void>;
  appRename(id: string, label: string): Promise<void>;
  appRestore(id: string, versionId: string): Promise<{ version?: AppVersion; error?: string }>;
  appEditFile(id: string, path: string, source: string): Promise<{ version?: AppVersion; error?: string }>;
  appPreview(id: string, versionId?: string): Promise<{ script?: string; placeholders: string[]; check?: AppCheckResult; error?: string }>;
  appDeploy(id: string): Promise<{ result?: AppDeployResult; error?: string }>;
  appImport(name: string): Promise<{ project?: AppProject; error?: string }>;
  appOrgApps(): Promise<{ apps?: OrgApp[]; error?: string }>;
  appStarters(): Promise<{ starters?: AppStarter[]; error?: string }>;
  appFromStarter(id: string, runAs?: AppRunAs): Promise<{ project?: AppProject; error?: string }>;
  appDescribe(objects: string[], projectId?: string): Promise<{ objects?: AppObjectInfo[]; error?: string }>;
  onAppEvent(cb: (e: { projectId: string; event: AppBuilderEvent }) => void): () => void;
}

export const builderApi = (): BuilderApi => window.lscApi as unknown as BuilderApi;
