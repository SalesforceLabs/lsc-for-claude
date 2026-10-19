# LSC App Builder ("vibe code an LSC App") — design & contracts

Studio → **Build → LSC apps**. A user describes an app in plain words ("show the rep a list of
recommended actions from Next Best Action as a stylized to-do list; tapping one shows its
details"). Roz's model (the app's saved connection) plans it against the org's real schema, writes
an LSC App (an `lscMobileInline_*` LWC bundle, plus nested `c/` children), Studio compiles and
checks it, the model repairs what fails, and the user sees it **running live in an iPad frame
before anything is deployed**. Follow-ups iterate ("make the cards denser", "add a filter by
priority"). **Deploy** writes the bundle (and, for record pages, the LWC quick action) to the org;
**Add to iPad** places it on the Home page or a record page tab through the existing pending-changes
tray (FlexiPage `addComponent` op), then **Publish to iPad**.

## LSC App rules (from Salesforce Help, release 264)

Sources: `ind.lsc_custom_lwc_apps`, `..._create_and_add_lwc_to_home_page`,
`..._create_and_add_lwc_as_inline_component_on_record_page`, `lsc_custom_lwc_apps_offline_*`,
and `knowledge/modules/lsc-apps/release-264-offline-and-nested-components.md`.

- API name of the **parent** bundle starts with `lscMobileInline_`. Children (nested components)
  have no prefix and no targets requirement; they can be reused across apps.
- **Home page**: `.js-meta.xml` has `isExposed=true`, targets `lightning__HomePage` **and**
  `lightning__UrlAddressable` (both required or it doesn't render on mobile), and the
  `lightning__HomePage` targetConfig has `<property name="mobileHeight" type="Integer" .../>`.
- **Record page tab**: targets `lightning__RecordPage` and `lightning__RecordAction`; the
  `lightning__RecordPage` targetConfig has the Integer `mobileHeight` property. The component
  takes `@api recordId` and `@api objectApiName`. On iPad it also needs a Quick Action of type
  LightningWebComponent on the object whose **Name equals the component name** (hidden from the
  action menu because of the prefix). Studio deploys that quick action with the bundle.
- **Quick action** (`target: "action"`, launched from the record's action menu on the iPad):
  targets `lightning__RecordAction` with `<targetConfig targets="lightning__RecordAction"><actionType>ScreenAction</actionType></targetConfig>`;
  **no** `lscMobileInline_` prefix (the iPad hides prefixed quick actions from the menu) and no
  `mobileHeight`. Takes `@api recordId` (set after construction — use a setter or read it in
  connectedCallback/wire with `$recordId`) and `@api objectApiName`; closes itself with
  `this.dispatchEvent(new CloseActionScreenEvent())` from `lightning/actions`. Needs a Quick Action
  of type LightningWebComponent on the object, **added to the page layout's Mobile & Lightning
  Actions** (`platformActionList`, the list the iPad's action menu reads). Help:
  `ind.lsc_customer_engagement_create_and_add_lwc_quick_action_to_record_page`.
- Only one LSC app per page (Home or record page) is recommended.
- Users need access to every object/field used.
- Offline (Admin Console > Mobile > Application Settings > "Use Mobile Apps offline"): supported
  adapters are `lightning/uiRecordApi` (getRecord, createRecord, updateRecord, deleteRecord,
  getRecordCreateDefaults, getLayout, getRecordUi, getLookupRecords), `getRelatedListRecords`
  (`lightning/uiRelatedListApi`), `getObjectInfo(s)`, `getPicklistValues(ByRecordType)`
  (`lightning/uiObjectInfoApi`), and `graphql` from **`lightning/uiGraphQLApi`** (Winter '27; not
  `lightning/graphql`; no aggregates, no mutations, pagination on top-level only, no dynamic query
  construction). Apex, Connect API, Apex REST, REST SOQL, `fetch`, `lightning-map`,
  `lightning-file-upload` need the network. Only data in the synced DB Schema exists offline.
- OmniStudio is not available on the iPad.

The builder's default: **offline-first** — GraphQL via `lightning/uiGraphQLApi` (static query
string in a `gql` template literal, `$`-variables for reactivity) or uiRecordApi; never Apex
unless the user insists (then a warning).

## Contracts

### Files

```ts
// same shape as LwcFile in src/studio/screens/inline-lwc.ts
interface AppFile { bundle: string; path: string; source: string } // path: "lwc/<bundle>/<file>"
type AppTarget = "home" | "record" | "action" | "tab";
```

### MCP tools (src/tools/studio.ts → src/studio/apps/*). `studio_` prefix = hidden from chat.

Read-only (always registered):

| Tool | Input | Output |
|---|---|---|
| `studio_app_check` | `{ name, target, objectApiName?, files: AppFile[] }` | `AppCheckResult` (no org needed for compile; uses the org only for the DB-Schema sync check when connected) |
| `studio_app_describe` | `{ objects: string[] }` (≤ 8) | `{ objects: AppObjectInfo[] }` |
| `studio_app_sample` | `{ soql }` (SELECT only, LIMIT forced ≤ 5) | `{ records: Row[], totalSize }` |
| `studio_app_list` | `{}` | `{ apps: OrgApp[] }` — the org's `lscMobileInline_*` bundles |
| `studio_app_guide` | `{}` | `{ guide: string }` — the builder's system prompt |
| `studio_app_source` | `{ name }` | `{ name, target, objectApiName?, files: AppFile[] }` (parent + `c/` children it uses) |

Write (registered only with `LSC_STUDIO_FIXES=1`; refused from chat like every studio_ tool):

| Tool | Input | Output |
|---|---|---|
| `studio_app_deploy` | `{ name, target, objectApiName?, files, expectedOrg }` | `AppDeployResult` |

```ts
interface AppIssue {
  severity: "error" | "warning" | "info";
  /** Stable id, e.g. "meta.missing-urladdressable", "compile", "offline.apex". */
  rule: string;
  message: string;            // plain words, for the user and the model
  path?: string;              // file it's in
  line?: number;
  fix?: string;               // what to do, for the model's repair round
}
interface AppCheckResult {
  ok: boolean;                // no "error" issues and it compiled
  issues: AppIssue[];
  offline: InlineLwcCheck;    // from checkInlineLwc
  /** Compiled IIFE for the live frame (same as studio_lwc_bundle's script); absent when it didn't compile. */
  script?: string;
  placeholders: string[];
  /** mobileHeight default read from the meta file. */
  mobileHeight?: number;
  /** Objects the source reads (GraphQL / uiRecordApi fields), and whether DB Schema syncs them to the iPad. */
  objects?: { name: string; synced: boolean | null }[];
}
interface AppObjectInfo {
  name: string; label: string; exists: boolean;
  synced: boolean | null;     // an active DB Schema record exists for it (null = couldn't check)
  recordCount?: number;       // COUNT(), capped/omitted when slow
  fields: { name: string; label: string; type: string; referenceTo?: string[]; picklist?: string[] }[]; // ≤ 120, no system noise
  childRelationships?: { name: string; object: string; field: string }[]; // ≤ 30
}
interface OrgApp {
  name: string; label: string; target: AppTarget | null; objectApiNames?: string[];
  lastModifiedDate?: string; lastModifiedBy?: string; description?: string;
}
interface AppDeployResult {
  ok: boolean;
  deployed: string[];         // "LightningComponentBundle:lscMobileInline_X", "QuickAction:Account.lscMobileInline_X"
  error?: string;
  warnings: string[];
  production: boolean;
}
```

### Electron main (src-electron/engine/app-builder*.ts, src-electron/ipc/app-builder.ts)

Projects are stored per org (connection username) in the app's SQLite (like perf-store).

```ts
interface AppProject {
  id: string; org: string;     // org username, lowercased
  name: string;                // bundle API name, lscMobileInline_Xxx
  label: string;               // "Next best actions"
  target: AppTarget; objectApiName?: string;
  createdAt: string; updatedAt: string;
  turns: AppTurn[];
  versions: AppVersion[];      // newest last
  currentVersionId: string | null;
  deployed?: { versionId: string; at: string; deployed: string[] };
  importedFrom?: string;       // an org app it started from
}
interface AppTurn {
  id: string; prompt: string; at: string;
  status: "running" | "done" | "failed" | "stopped";
  steps: AppStep[];            // the visible timeline
  reply: string;               // the model's narrative (markdown), streamed
  versionId?: string;          // the version this turn produced
  error?: string;
}
interface AppStep {
  id: string;
  kind: "plan" | "describe" | "sample" | "write" | "check" | "repair" | "note";
  label: string;               // "Looking at RecommendedAction fields", "Writing todoList.html"
  status: "running" | "done" | "failed";
  detail?: string;             // e.g. "3 errors: …"
  startedAt: string; endedAt?: string;
}
interface AppVersion {
  id: string; at: string; source: "ai" | "manual" | "org";
  files: AppFile[];
  check: Omit<AppCheckResult, "script">;
  turnId?: string; note?: string;
}
type AppBuilderEvent =
  | { type: "turn"; turn: AppTurn }                         // turn created / status changed
  | { type: "step"; turnId: string; step: AppStep }          // added or updated (by id)
  | { type: "reply-delta"; turnId: string; text: string }
  | { type: "writing"; turnId: string; path: string; chars: number } // live file-writing progress
  | { type: "version"; version: AppVersion }
  | { type: "project"; project: AppProject };               // full refresh (rare)
```

`window.lscApi` additions (preload.cjs, types in src-renderer/types.d.ts):

```ts
appList(): Promise<AppProject[]>                       // selected org's projects, newest first (turns/versions included)
appGet(id): Promise<AppProject | null>
appCreate(input: { prompt: string; target: AppTarget; objectApiName?: string }): Promise<{ project?: AppProject; error?: string }> // starts turn 1
appSend(id, prompt): Promise<{ ok: boolean; error?: string }>  // starts a follow-up turn
appStop(id): Promise<void>
appDelete(id): Promise<void>
appRename(id, label): Promise<void>
appRestore(id, versionId): Promise<{ version?: AppVersion; error?: string }> // copies an old version as the new current one
appEditFile(id, path, source): Promise<{ version?: AppVersion; error?: string }> // manual edit → new checked version
appPreview(id, versionId?): Promise<{ script?: string; placeholders: string[]; check?: AppCheckResult; error?: string }>
appDeploy(id): Promise<{ result?: AppDeployResult; error?: string }>
appImport(name): Promise<{ project?: AppProject; error?: string }> // from studio_app_source
appOrgApps(): Promise<{ apps?: OrgApp[]; error?: string }>
appDescribe(objects: string[]): Promise<{ objects?: AppObjectInfo[]; error?: string }>
onAppEvent(cb: (e: { projectId: string; event: AppBuilderEvent }) => void): () => void
```

### Builder loop (main process)

System prompt = `src/studio/apps/guide.ts` `APP_BUILDER_GUIDE`. Electron main doesn't import
`src/`, so the server exposes it as the read-only tool `studio_app_guide` → `{ guide: string }`,
read once per turn. The model gets tools with
**builder-local names** (not MCP names):

- `describe_objects({ objects })` → studio_app_describe
- `sample_records({ soql })` → studio_app_sample
- `write_app({ label?, files, notes? })` → full file set for every bundle it changes (unchanged files may be omitted; deletions via `delete: string[]`); main merges, runs studio_app_check, and returns the issues as the tool result. A version is recorded for each write; the turn's version is the last that compiled.
- `finish({ summary })` — ends the turn.

Up to 12 rounds; at most 4 repair rounds after failing checks. Streams `reply-delta` from text,
`writing` from the `write_app` input JSON as it streams.

### Renderer (src-renderer/components/studio/builder/)

Rail: new section **Build** (above Testing) with **LSC apps** (`Sparkles`). Views:

1. **Gallery**: hero composer ("Describe an app for your reps…", target picker Home / Record page
   + object), 4–6 example prompts as chips, the selected org's projects as cards (label, target,
   status: Draft / Deployed / Changed since deploy), and "Start from an app in this org"
   (studio_app_list → appImport).
2. **Workspace**: two panes. Left: the conversation (prompts, step timeline with live Spinner /
   StatusIcon, streamed reply, version chips "v3 · compiled", composer at the bottom with ⌘↵).
   Right: header (label, target pill, version picker, **Deploy** primary, **Add to iPad**),
   `Segmented` Preview / Code / Checks. Preview = iPad-sized frame (Home card or record tab
   chrome) running the compiled script live (reuse `inlineLwcFrame`, `studio_lwc_request`),
   record picker for record targets, mobileHeight readout; Code = file tree + highlighted source,
   editable (save = appEditFile); Checks = issues grouped by severity + offline/DB-Schema notes.
3. **Add to iPad** for `action`: queue an `editMetadata` Layout change with the new LayoutOp
   `{ op: "addAction"; action: "<Object>.<Name>"; before: string | null }` (and `removeAction`)
   on the object's layout(s) the previewed profile gets, then the tray → apply → Publish flow.
   Preview for `action`: the app in an iPad action sheet (modal) over a record page.
4. **Add to iPad**: after deploy, Home → opens the iPad preview in Draft and queues an
   `addComponent` on the profile's Home page (or opens Insert component… preselected); Record →
   the object's record page tab.

## Additions (Oct 2026)

- **Nav tab** (`target: "tab"`, bundle keeps `lscMobileInline_`): deploy writes the bundle, an
  AppPage FlexiPage (`flexipage:defaultAppHomeTemplate`, component with a `mobileHeight` instance
  property), a CustomTab (`flexiPage` → the page; page and tab named like the bundle), and each
  chosen profile's `tabVisibilities` DefaultOn (+ optional CustomApplication membership); then
  Publish to iPad. **No UISchema record** — a UISchema "mobile" tab only opens native screens
  ("Coming soon"). Verified against the org's existing flexipage tabs (MT_*, Pat_Sim) and
  `published.ts` routing; a published read-back is pending (demo org's cache generation fails
  org-side). Input `tab?: { label?, application?, profiles?: string[] }`.
- **Quick action naming**: `lscMobileQuickAction_Xxx` (lifesciences-ios `LMRModule.swift`
  `quickActionComponentTriggerPrefix` — prefetched for offline); never `lscMobileInline_`.
  LayoutOps `addAction { action: "<Object>.<Name>", before, actionType? }` / `removeAction { action, dropList? }`.
- **Run as a test user**: `AppProject.runAs?: { loginId, username, userId?, profile? }` (set at
  create or with `appSetRunAs`). `studio_app_describe` / `studio_app_sample` take `mobileLogin`
  (token resolved in main, never sent to the renderer), `studio_app_check` takes `userId`/`profile`
  so "synced" is for that user's profile; the live preview's data requests go through
  `lwcRequestAs(loginId)`. An expired login fails the turn / preview with "sign in again" — never a
  silent fallback to the admin login. `AppObjectInfo.access` reports what the user can read.
- **Deploy plan**: read-only `studio_app_deploy_plan` → `{ components, existing, production, warnings }`
  drives the Deploy dialog (production tick from the server's check, not the host name).
- **Device frame**: preview defaults to iPad landscape with a Rotate control; the frame is a device
  spec (`kind: "ipad" | "iphone"`, orientation, size, safe areas) so iPhone can be added later.
- **Starter apps** ("Start from a sample" in the gallery): working LSC apps from the
  [afls-ideas](https://github.com/afls-ideas) GitHub account, copied at pinned commits into
  `knowledge/app-starters/<id>/lwc/<bundle>/` (packaged with `knowledge/**`). The manifest
  (`knowledge/app-starters/manifest.json`) gives each its repo, `sha`, parent bundle `name`, `target`,
  `objectApiName`, the `bundles` to copy, `objects` the scan can't see (related-list ids in markup),
  a description and `tryNext` prompts. `node scripts/sync-app-starters.mjs [--update] [id...]`
  re-fetches the pinned files (`--update` moves each `sha` to the repo's default-branch tip first, so a
  refresh is a reviewable diff); it writes only the listed bundles' files and never builds or runs them.
  `test/unit/studio/apps/starters.test.ts` fails if a starter stops passing `checkApp` (no errors, compiles,
  every copied bundle used). Server: `studio_app_starters` → `{ starters: AppStarter[] }` and
  `studio_app_starter_source { id }` → `AppInput & { starter }` (`src/studio/apps/starters.ts`; no org).
  Main: `AppBuilder.fromStarter(org, id, runAs?)` (`appBuilder:fromStarter`) makes a project whose first
  version has `source: "starter"`, `label` the starter's and `starter` (`AppStarterRef`) recorded; an
  untouched project from the same starter is reopened instead, and the parent bundle is renamed
  (`renameBundle`, paths and references) when the org or another project already has its name. Helper
  bundles keep their names, so `write_app` lets the model edit any prefixed bundle already in the project,
  and the turn context says where the app came from. Two projects from the composable starters share
  `lscMobileInline_relatedList` / `lscMobileInline_timeline`: deploying both deploys one copy of each
  (the deploy plan lists them as overwritten). The conversation opens with the starter's source link,
  its first version and the `tryNext` prompts (they fill the composer until the first turn).
  Lint takes JS-only service modules (no template, no default class export) as helper bundles.
