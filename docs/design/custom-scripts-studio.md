# Custom Scripts in Studio — design contract

Shared contract for the work streams that build Studio's custom script library / editor / creator. Read this before touching code; when you need to deviate from an interface here, change this file in the same commit and say so in your report.

## Goal

An admin can browse, read, write, test, create, assign and delete LSC custom scripts (`LifeScienceCustomScript`) in Studio, either by hand in a real code editor or by "vibe coding": describing what the script should check and letting Roz write and revise it. The bar is Anthropic-level UX: calm, fast, obvious, honest about what the platform will do, no dead ends. Every write still goes through the pending-changes tray and the review dialog — Studio never writes without the user confirming.

## Platform facts (verified on peter-lsc-260-trial, API 66)

- `LifeScienceCustomScript` fields: `Name` (string 255, required), `ComponentName` (string 255, required — the LWC's name), `Type` (required picklist: `Checklist`, `Validation`, `VisitActionValidation`), `OperationEventType` (picklist `OnCreate`, `OnUpdate`, `OnDelete`, nillable), `ObjectName` (string, nillable), `CodeText` (textarea 131072 — **not createable, not updateable**), `SourceSystemName`, `SourceSystemIdentifier`, `OwnerId`.
- The LWC is headless: `lwc/<name>/<name>.js` holds just the IIFE `(() => { ... })();`, plus `<name>.js-meta.xml` (`apiVersion`, `isExposed` false). It deploys fine.
- **Inserting** the record copies the LWC's `.js` into `CodeText` (trimmed).
- Redeploying the LWC does **not** change `CodeText`. **Updating the record** (even setting `ComponentName` to its current value) re-reads the LWC into `CodeText` — the same thing Admin Console's Refresh does.
- So **saving code = write the LWC's `.js`, then touch the record, then read `CodeText` back and check it equals the new code (trim both).** This keeps the LWC and the running code in step, so a later Refresh never undoes a Studio edit. Only if the LWC can't be written (managed / namespaced bundle) and `CodeText` is updateable in that org do we PATCH `CodeText`; otherwise the change is blocked with a plain explanation.
- Stage objects: `LifeSciStageObject` (`ObjectName`, `ParentObjRelaFieldName`, `IsControlledByStagePath`, `ValidationCustomScriptId`, `ChecklistCustomScriptId` — lookups, updateable). Validation/Checklist scripts are active only when a stage object points at them (and the object has a stage path). Only the **earliest created** `VisitActionValidation` script runs; it needs `ObjectName = ProviderVisit` and `OperationEventType = OnUpdate`.
- Reps need read access to the script record (OWD for `LifeScienceCustomScript` defaults to Private).
- Full API reference (globals, classes, functions, output contract): `knowledge/modules/custom-scripts/custom-scripts-api-reference.md`, with practical gotchas in `skills/lsc-custom-scripts/SKILL.md`.

## Where it lives

Studio rail → **Setup** → **Custom scripts** (after "What changed"), section id `"custom-scripts"`, kept mounted once opened (like the iPad preview) so an open editor and its Ask Roz conversation survive switching pages. Feature boards' custom script items get **Open in editor**, which opens this page on that script.

Layout (one page, three columns at full width, collapsing gracefully):

```
┌ Library (resizable, 260) ┬ Editor ─────────────────────────────────┬ Ask Roz (resizable, 360, toggle) ┐
│ Search                   │ Header: name · type pill · status line   │ conversation, streamed            │
│ + New script             │ [Code] [Details] [Test]  (Segmented)     │ proposals land in the editor as   │
│ Visit action validation  │ CodeMirror editor, lint gutter,          │ a diff with Accept / Reject       │
│  • Visit checks  Runs    │ autocomplete, problems panel             │ starter prompts per type          │
│ Validation               │                                          │ "Fix N problems" / "Fix test"     │
│ Checklist                │ footer: Discard · Review & save (⌘S)     │ composer                          │
└──────────────────────────┴──────────────────────────────────────────┴──────────────────────────────────┘
```

## Work streams and file ownership

| Stream | Owns | Must not edit |
|---|---|---|
| **A. Server** | `src/studio/scripts/` (`library.ts`, `checks.ts`, `save.ts`, `lwc.ts`), new tools in `src/tools/studio.ts`, new fix kinds in `src/studio/types.ts`, `fixes.ts`, `fix-progress.ts`, `edits.ts` (re-point `setCustomScriptCode` at the new save path), `src-electron/engine/studio-invalidation.ts`, `src-renderer/components/studio/fix-effects.ts`, `src-renderer/components/studio/types.ts` (mirror union only), `src-renderer/components/studio/changes.ts` (changeKey / isNoop / helpers for the new kinds), `src-renderer/components/studio/scripts/script-checks.ts` (verbatim copy of `checks.ts`), tests under `test/unit/studio/scripts/` | renderer views |
| **B. Test runner** | `src/studio/scripts/runner/` (sandbox, emulated globals, context data builder), tool `studio_script_test` + `studio_script_test_records` (registered in `src/tools/studio.ts` — append only in its own block), `src-renderer/components/studio/scripts/ScriptTestPanel.tsx` + its css, tests under `test/unit/studio/scripts/runner/` | other renderer views |
| **C. Editor UI** | `src-renderer/components/ui/CodeEditor.tsx` (+ `code-editor.css`, `code-editor-theme.ts`), `src-renderer/components/studio/scripts/` views (`CustomScriptsView.tsx`, `ScriptLibrary.tsx`, `ScriptEditorPane.tsx`, `ScriptDetails.tsx`, `NewScriptDialog.tsx`, `script-api.ts` completions, `script-templates.ts`, `scripts.css`), StudioView rail wiring, Inspector "Open in editor", preload/types.d.ts wrappers for the read tools, `scripts/ui-shots.mjs` tour entry | server, assist panel internals |
| **D. Ask Roz (vibe coding)** | `src-electron/engine/script-assist.ts` (prompt + small tool loop), `studio:scriptAssist*` IPC in `src-electron/ipc/handlers.ts`, abort `signal` support in `src-electron/llm/http.ts` / `anthropic.ts` / `openai.ts` / `provider.ts`, preload + `types.d.ts` entries for assist, `src-renderer/components/studio/scripts/ScriptAssistPanel.tsx` + css, `script-assist-logic.ts` (code-block extraction, proposal parsing), tests | editor internals |

Shared files several streams append to (`src/tools/studio.ts`, `src-electron/preload.cjs`, `src-renderer/types.d.ts`, `src-electron/ipc/handlers.ts`): add your block in one place with a `// --- custom scripts: <stream> ---` comment, never reformat others' code. Each stream works in its own git worktree branched from `feat/custom-script-studio` and commits there; the lead merges.

## Read tools (stream A unless noted)

### `studio_custom_scripts` → `ScriptLibrary`  (cached; dropped by every apply)

```ts
type ScriptType = "Validation" | "Checklist" | "VisitActionValidation";
interface ScriptSummary {
  id: string; name: string; componentName: string; type: ScriptType;
  objectName: string | null; operationEventType: "OnCreate" | "OnUpdate" | "OnDelete" | null;
  createdDate: string; lastModifiedDate: string; lastModifiedBy: string | null;
  codeSize: number;                     // CodeText length
  lwc: { exists: boolean; namespace: string | null; lastModifiedDate: string | null; editable: boolean };
  assignedTo: { stageObjectId: string; stageObjectName: string; objectName: string; role: "validation" | "checklist" }[];
  // One plain-language status, worded for the library row and the editor header:
  status: { tone: "pass" | "warning" | "error" | "info"; label: string; detail: string };
  // e.g. { pass, "Runs at Save, Sign and Submit" } · { error, "Won't run", "Only the first visit action validation script runs — Visit checks (created 3 Mar) does." }
  //      { warning, "Not assigned", "Validation scripts run only when a stage object uses them." } · { pass, "Runs on Inquiry" }
  findingCount: { error: number; warning: number };
}
interface StageObjectRow { id: string; name: string; objectName: string; controlledByStagePath: boolean; validationScriptId: string | null; checklistScriptId: string | null; }
interface ScriptLibrary {
  scripts: ScriptSummary[];             // ordered: type (VAV, Validation, Checklist), then CreatedDate
  stageObjects: StageObjectRow[];
  runningVisitScriptId: string | null;
  sharing: { internalAccess: string | null; note?: string };  // OWD; note when reps may not see scripts
  codeTextWritable: boolean;            // describe: CodeText updateable in this org
}
```

### `studio_custom_script` `{ id }` → `ScriptDetail`  (never cached — the editor must see the org now)

```ts
interface ScriptDetail extends ScriptSummary {
  code: string;                         // CodeText
  lwcCode: string | null;               // the bundle's .js, null when there is no bundle / can't read
  lwcOtherFiles: string[];              // other files in the bundle (html, css, tests) — kept on save
  drift: "none" | "lwc-ahead" | "no-lwc"; // lwc-ahead: LWC .js differs from CodeText (deployed but not refreshed)
}
```

## Checks (stream A writes `checks.ts`; renderer copy kept equal by a test)

Pure, dependency: `acorn` only. `analyzeScript(code: string, ctx: { type: ScriptType; objectName?: string | null; operationEventType?: string | null }): ScriptDiagnostic[]`

```ts
interface ScriptDiagnostic {
  id: string;                 // stable rule id, e.g. "syntax", "comment-before-iife", "not-iife", "no-unwrap", "custom-field-stringvalue", "db-without-await", "no-global-guard", "browser-api", "console-log", "group-condition", "too-large", "vav-object-name", "vav-event-type", "returns-non-array"
  severity: "error" | "warning" | "info";
  message: string;            // one sentence, plain language
  detail?: string;            // why it matters on web / iPad
  from: number; to: number;   // character offsets into code (0,0 for whole-script)
  fix?: { label: string; changes: { from: number; to: number; insert: string }[] };  // quick fix the editor can apply
}
```

The editor shows these live as lint; preview shows errors/warnings as review warnings; the library's `findingCount` uses them.

## Fix kinds (stream A; renderer types mirrored)

```ts
| { kind: "createCustomScript"; label: string; name: string; componentName: string; type: ScriptType;
    objectName: string | null; operationEventType: "OnCreate" | "OnUpdate" | "OnDelete" | null; code: string;
    assign?: { stageObjectId: string; role: "validation" | "checklist" }[] }
  // apply: deploy bundle (refuse if a bundle with that name exists and wasn't made for this script) → insert record → read CodeText back → assign. Roll back in reverse on failure. Undo: deleteCustomScript { deleteBundle: true }.
| { kind: "saveCustomScript"; label: string; scriptId: string; scriptName: string;
    from: { code: string; fields: ScriptFields }; to: { code?: string; fields?: Partial<ScriptFields> } }
  // ScriptFields = { name; componentName; type; objectName; operationEventType }. Refused if CodeText or fields changed since `from`.
  // apply: write LWC .js (Tooling LightningComponentResource PATCH of Source, else retrieve-swap-deploy keeping other files) → PATCH record fields (+ touch) → read back. Undo: swapped from/to.
| { kind: "deleteCustomScript"; label: string; scriptId: string; scriptName: string; deleteBundle: boolean }
  // preview lists stage objects that point at it (they're cleared first). Undo: createCustomScript from the snapshot (+ re-assign).
| { kind: "assignCustomScript"; label: string; stageObjectId: string; stageObjectName: string; role: "validation" | "checklist"; from: string | null; to: string | null }
  // Undo: swapped.
```

`setCustomScriptCode` stays (the Inspector uses it) but is re-implemented on the same save path, so it now works in orgs where `CodeText` isn't updateable.

**Deviations as built (stream A, verified end to end on peter-lsc-260-trial):**
- Types live in `src/studio/scripts/types.ts`, copied byte for byte to `src-renderer/components/studio/scripts/script-types.ts` (a test keeps them equal).
- `createCustomScript` has an extra optional `adoptBundle` (set by the undo of a delete: an existing bundle with the same code is reused instead of refused).
- `ScriptLibrary` gains `unavailable` (no custom script object in the org); the page shows "This org doesn't have custom scripts" instead of offering New script.
- Script status gains the label "No stage path" (a stage object with the script but no `LifeSciStagePath`).
- Preview and apply for the four new kinds live in `src/studio/scripts/fixes.ts`, dispatched from `edits.ts`; the save primitives are in `save.ts` and `lwc.ts`. Saves validate only the fields being changed.
- `setCustomScriptCode` no longer needs `CodeText` to be updateable; a package-owned component is refused unless `CodeText` is updateable.
- The Tooling `LightningComponentResource` PATCH, creating a bundle with a temp-dir deploy, and deleting one with `deleteMetadata` all worked on the demo org. The retrieve-swap-deploy fallback is only covered by unit mocks.

Renderer change keys: `script:${scriptId}` for save (merge code + field edits into one pending change, keeping the original `from`), `script-new:${componentName}`, `script-delete:${scriptId}`, `stage:${stageObjectId}:${role}`. A queued create shows in the library as a draft row ("New · not in the org yet").

## Test run (stream B)

`studio_script_test_records` `{ type, objectName?, search? }` → recent records to run against (VAV: ProviderVisit/Visit records with account name, date, status, child counts; workflow: records of the stage object's object), as JSON.

`studio_script_test` `{ code, type, recordId?, objectName?, platform: "web" | "ipad", env?: { actionName?, fromStatus?, toStatus? }, userId? }` → 

```ts
interface ScriptTestResult {
  ok: boolean;                                   // ran to completion and returned the contract shape
  results: { title: string; status: "success" | "warning" | "error" | string }[];
  outcome: "pass" | "warn" | "block" | "none";   // how the app would treat it (block = an error result for Validation / VAV)
  logs: { level: "log" | "warn" | "error"; text: string; at: number }[];  // env.log / console.*
  queries: { object: string; soql: string; rows: number; ms: number; error?: string }[];
  error?: { message: string; line?: number; column?: number; stack?: string };
  contract: string[];                            // problems with what came back (not an array, unresolved promise, Proxy-unsafe values, unknown status)
  durationMs: number;
  notes: string[];                               // fidelity notes: what the simulation can't reproduce
}
```

Runs in a Node `vm` context with a time limit (5 s CPU, 20 s total with queries), no `require`, no network except `db` → read-only SOQL as the connected admin (say so in `notes`). `record.setValue`/`save` are recorded, never written. Web vs iPad switches the context-data keys (`ProviderVisitProdDetailing.VisitId` vs `ProviderVisitProdDetailing`), field-name casing and `db.query` result shapes (`sObject` on web, opaque methods-only object on iPad) per the reference. The renderer's `ScriptTestPanel` shows results the way the app would (a validation dialog with the result rows), then logs and queries.

**As built (deviations):**
- `studio_script_test` also accepts `operationEventType?`. `ScriptTestResult` gains an optional `recorded` list (the `setValue`/`save` calls that were recorded, not applied), carried by the panel's `TestRunResult` (`script-test-logic.ts`), which `script-model.ts` re-exports as `ScriptTestResult`.
- VAV test records are `ProviderVisit` rows (ordered by planned start, 25 at most); a `Visit` id is accepted and resolved to its ProviderVisit. Children link by `ProviderVisitId`, falling back to `VisitId` (ProductDisbursement has only `VisitId`).
- On web, `[validateVisit()]` resolves to `[[...]]`; the runner flattens one level before checking the contract, as the app does.
- On web the script runs once, with native async/await: `db` calls return real Promises that the host settles when the query returns. Each synchronous segment is limited to 5 s CPU (cumulative) and the whole run to 20 s. `Date` and `Math.random` are real. On iPad the app strips async/await, so `db` is synchronous there; the runner replays the script (up to 12 passes) to answer it from queries fetched between passes, and on iPad only the clock is held at the run's start and `Math.random()` is seeded. A note says so.
- `ScriptTestPanel` takes an optional `onJumpTo(line, column)` for the error's "Jump to line", and optional `onResult` / `onAskRoz`. Preload: `studioScriptTestRecords(args)` and `studioScriptTest(args)`.

## Ask Roz (stream D)

IPC: `studio:scriptAssist(requestId, request)` → `{ ok } | { ok:false, error }`; events `studio:scriptAssist-delta {requestId, text}`, `studio:scriptAssist-tool {requestId, name, status}`, `studio:scriptAssist-done {requestId, message}`, `studio:scriptAssist-error {requestId, error}`; `studio:scriptAssistAbort(requestId)`.

```ts
interface ScriptAssistRequest {
  messages: { role: "user" | "assistant"; content: string }[];   // the whole mini-conversation
  script: { name: string; type: ScriptType; objectName: string | null; operationEventType: string | null; code: string };
  diagnostics?: ScriptDiagnostic[];        // current problems
  lastTest?: ScriptTestResult;             // when the user asks to fix a failing test
  model?: string;
}
```

Main builds the system prompt from the API reference + skill + the script type's contract + current code; the model may call a few read-only tools (`describe_sobject` for the target object and visit child objects) through the session's org MCP client; answers are short prose plus **one** fenced ```javascript block holding the complete script. The panel turns that block into a proposal; the editor shows it as an inline diff (`@codemirror/merge` unified view) with **Accept** (⌘↵) / **Reject** (Esc); accepting is one undo step. Starter prompts per type; one-click "Fix N problems" and "Fix this test failure". Never writes to the org.

Renderer props (stream C embeds stream D's panel):

```ts
<ScriptAssistPanel
  scriptKey={string}                                  // conversation is kept per script (and per draft)
  script={ScriptAssistRequest["script"]}
  diagnostics={ScriptDiagnostic[]}
  lastTest={ScriptTestResult | undefined}
  proposal={ "none" | "pending" }                     // editor tells the panel whether a proposal is on screen
  onPropose={(code: string, summary: string) => void} // editor shows the diff
  onClose={() => void}
/>
```

Implementation notes (stream D): the preload exposes one `onScriptAssistEvent(cb)` (kinds `delta` / `tool` / `done` / `error`, all carrying `requestId`) beside `studioScriptAssist(requestId, request)` and `studioScriptAssistAbort(requestId)`; `ScriptAssistRequest` is duplicated in `script-assist.ts` and structurally mirrored in `script-assist-logic.ts`; conversations live in `script-assist-store.ts` (module level, per `scriptKey`). The panel default-exports `ScriptAssistPanel` and exports `FOCUS_ASSIST_EVENT` (`roz:focus-assist`); it also handles Cmd-K itself. It calls `onPropose` itself when a reply finishes with a script, and "View in editor" calls it again.

Stream C exposes `ScriptTestPanel` props from stream B as: `<ScriptTestPanel script={...} code={string} onResult={(r) => void} onAskRoz={(r) => void} />`.

## Quality bar

- Follow `.claude/skills/roz-ui/SKILL.md` and keep `test/unit/ui-conventions.test.ts` green. Light and dark palettes. All three async states.
- Plain words: "Runs at Save, Sign and Submit", "Won't run", "Not assigned". No jargon in headlines; API names in secondary text.
- Keyboard: ⌘S review & save, ⌘↵ accept proposal, Esc reject, ⌘K focus Ask Roz composer, ⌘F find, ⌘/ comment.
- Unit tests for every pure module; `npx tsc --noEmit -p` each tsconfig, `npx vitest run` for touched areas.
- Real-org verification on `peter-lsc-260-trial` (demo org — writes fine; clean up anything you create: name test scripts/bundles with the prefix `rozTest`).
