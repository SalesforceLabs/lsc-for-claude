/**
 * Stand-ins for the platform modules an org LWC imports, used when Studio
 * compiles an inline component (lscMobileInline_*) for its live preview.
 * `lightning/*` modules are written as LWC modules ahead of
 * lightning-base-components; `@salesforce/*` imports are generated per id
 * (`salesforceModule`).
 *
 * Data comes through `lightning/studioBridge`: the preview's host page answers
 * read-only UI API GETs and GraphQL queries (src/studio/lwc/request.ts). Writes,
 * Apex and other network calls fail the way they would without a connection,
 * so the component shows its own error state.
 */

/** Files under the shim module root, by path (`lightning/uiRecordApi/uiRecordApi.js`). */
export const SHIM_FILES: Record<string, string> = {};

function js(name: string, source: string): void {
  SHIM_FILES[`lightning/${name}/${name}.js`] = source.trim() + "\n";
}

function component(name: string, source: string, template: string): void {
  js(name, source);
  SHIM_FILES[`lightning/${name}/${name}.html`] = template.trim() + "\n";
}

js(
  "studioBridge",
  `
const g = globalThis;
const pending = new Map();
let seq = 0;
const cache = new Map();

if (!g.__studioBridge) {
  g.__studioBridge = true;
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window.parent || !m || m.__studio !== "response") return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.data);
    else p.reject(m.error);
  });
  // An error before anything is drawn means the component didn't mount; later ones leave it on screen.
  window.addEventListener("error", (e) => {
    const root = document.getElementById("root");
    emit("error", { message: String((e.error && e.error.message) || e.message), mounted: !!root && root.offsetHeight > 0 });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const message = (r && r.body && r.body.message) || (r && r.message) || String(r);
    emit("warn", { message });
  });
  document.addEventListener("lightning__showtoast", (e) => emit("toast", { toast: e.detail || {} }));
  document.addEventListener("lightning__actionsclosescreen", () => emit("close"));
}

export function context() {
  return g.__studioContext || {};
}

export function emit(type, detail) {
  window.parent.postMessage({ __studio: type, ...(detail || {}) }, "*");
}

/** A read-only request answered by the preview host; identical GETs share one answer. */
export function request(method, path, body) {
  const key = method === "GET" ? path : "";
  if (key && cache.has(key)) return cache.get(key);
  const p = new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ __studio: "request", id, method, path, body }, "*");
  });
  if (key) {
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** An error shaped like the platform's (FetchResponse): status, statusText, body.message. */
export function failure(message, status = 400) {
  return { status, statusText: message, ok: false, body: { message }, headers: {} };
}

export const READ_ONLY = "Studio's preview is read-only, so this change wasn't saved.";

/** A wire adapter that turns its config into one request; an incomplete config emits nothing (as LDS). */
export function requestAdapter(toRequest, shape) {
  return class {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      this.config = undefined;
      this.seq = 0;
    }
    connect() {
      this.connected = true;
      this.run();
    }
    disconnect() {
      this.connected = false;
    }
    update(config) {
      this.config = config;
      this.run();
    }
    run() {
      if (!this.connected || !this.config) return;
      const req = toRequest(this.config);
      if (!req) return;
      const n = ++this.seq;
      const [method, path, body] = Array.isArray(req) ? req : ["GET", req];
      request(method, path, body).then(
        (data) => n === this.seq && this.callback({ data: shape ? shape(data, this.config) : data, error: undefined }),
        (error) => n === this.seq && this.callback({ data: undefined, error })
      );
    }
  };
}

/** A wire adapter Studio doesn't answer: it emits an error the component can show. */
export function unavailableAdapter(what) {
  return class {
    constructor(callback) {
      this.callback = callback;
    }
    connect() {
      this.callback({ data: undefined, error: failure(what + " isn't answered in Studio's preview. On the iPad it needs a connection.", 503) });
    }
    update() {}
    disconnect() {}
  };
}

export function objectName(o) {
  return typeof o === "string" ? o : o && o.objectApiName;
}

/** "Account.Name" for a field given as a string or an @salesforce/schema import. */
export function fieldName(f) {
  if (typeof f === "string") return f;
  return f && f.objectApiName && f.fieldApiName ? f.objectApiName + "." + f.fieldApiName : "";
}

export function fieldList(v) {
  return (v == null ? [] : Array.isArray(v) ? v : [v]).map(fieldName).filter(Boolean);
}

export function query(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    const value = Array.isArray(v) ? v.join(",") : String(v);
    if (value) parts.push(k + "=" + encodeURIComponent(value));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

export function list(v) {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}
`
);

js(
  "uiRecordApi",
  `
import { request, requestAdapter, failure, READ_ONLY, fieldName, fieldList, query, list } from "lightning/studioBridge";

const recordPath = (c) =>
  c.recordId
    ? "/ui-api/records/" + c.recordId + query({ fields: fieldList(c.fields), optionalFields: fieldList(c.optionalFields), layoutTypes: list(c.layoutTypes), modes: list(c.modes) })
    : null;

export const getRecord = requestAdapter(recordPath);

/** One batch request per group, merged into the platform's { results } shape. */
export const getRecords = requestAdapter(() => null);
getRecords.prototype.run = function () {
  if (!this.connected || !this.config) return;
  const groups = list(this.config.records).filter((r) => r && list(r.recordIds).length);
  if (!groups.length) return;
  const n = ++this.seq;
  Promise.all(
    groups.map((g) =>
      request("GET", "/ui-api/records/batch/" + list(g.recordIds).join(",") + query({ fields: fieldList(g.fields), optionalFields: fieldList(g.optionalFields) }))
    )
  ).then(
    (all) => n === this.seq && this.callback({ data: { results: all.flatMap((r) => (r && r.results) || []) }, error: undefined }),
    (error) => n === this.seq && this.callback({ data: undefined, error })
  );
};

export const getRecordUi = requestAdapter((c) => {
  const ids = list(c.recordIds);
  return ids.length ? "/ui-api/record-ui/" + ids.join(",") + query({ layoutTypes: list(c.layoutTypes), modes: list(c.modes), optionalFields: fieldList(c.optionalFields) }) : null;
});

export const getRecordCreateDefaults = requestAdapter((c) => {
  const o = typeof c.objectApiName === "string" ? c.objectApiName : c.objectApiName && c.objectApiName.objectApiName;
  return o ? "/ui-api/record-defaults/create/" + o + query({ recordTypeId: c.recordTypeId, formFactor: c.formFactor, optionalFields: fieldList(c.optionalFields) }) : null;
});

function walk(record, field) {
  const name = fieldName(field);
  if (!record || !name) return undefined;
  const parts = name.split(".").slice(1);
  let cur = record;
  for (let i = 0; i < parts.length; i++) {
    const f = cur && cur.fields && cur.fields[parts[i]];
    if (!f) return undefined;
    if (i === parts.length - 1) return f;
    cur = f.value;
  }
  return undefined;
}

export function getFieldValue(record, field) {
  const f = walk(record, field);
  return f === undefined ? undefined : f.value;
}

export function getFieldDisplayValue(record, field) {
  const f = walk(record, field);
  return f === undefined ? undefined : f.displayValue;
}

export function createRecord() {
  return Promise.reject(failure(READ_ONLY));
}
export function updateRecord() {
  return Promise.reject(failure(READ_ONLY));
}
export function deleteRecord() {
  return Promise.reject(failure(READ_ONLY));
}
export function getRecordNotifyChange() {}
export function notifyRecordUpdateAvailable() {
  return Promise.resolve();
}

function inputFields(record, objectInfo, flag) {
  const fields = {};
  for (const [name, f] of Object.entries((record && record.fields) || {})) {
    const info = objectInfo && objectInfo.fields && objectInfo.fields[name];
    if (!objectInfo || (info && info[flag])) fields[name] = f && typeof f === "object" && "value" in f ? f.value : f;
  }
  return fields;
}

export function generateRecordInputForCreate(record, objectInfo) {
  return { apiName: (objectInfo && objectInfo.apiName) || (record && record.apiName), fields: inputFields(record, objectInfo, "createable") };
}

export function generateRecordInputForUpdate(record, objectInfo) {
  return { fields: { Id: record && record.id, ...inputFields(record, objectInfo, "updateable") } };
}

export function createRecordInputFilteredByEditedFields(recordInput, originalRecord) {
  const fields = {};
  for (const [k, v] of Object.entries((recordInput && recordInput.fields) || {})) {
    const before = originalRecord && originalRecord.fields && originalRecord.fields[k];
    if (k === "Id" || !before || before.value !== v) fields[k] = v;
  }
  return { ...recordInput, fields };
}

export function getRecordInput() {
  return { fields: {} };
}
`
);

js(
  "uiObjectInfoApi",
  `
import { requestAdapter, objectName, fieldName, list } from "lightning/studioBridge";

export const getObjectInfo = requestAdapter((c) => (objectName(c.objectApiName) ? "/ui-api/object-info/" + objectName(c.objectApiName) : null));

export const getObjectInfos = requestAdapter((c) => {
  const names = list(c.objectApiNames).map(objectName).filter(Boolean);
  return names.length ? "/ui-api/object-info/batch/" + names.join(",") : null;
});

export const getPicklistValues = requestAdapter((c) => {
  const f = fieldName(c.fieldApiName);
  const dot = f.indexOf(".");
  return c.recordTypeId && dot > 0 ? "/ui-api/object-info/" + f.slice(0, dot) + "/picklist-values/" + c.recordTypeId + "/" + f.slice(dot + 1) : null;
});

export const getPicklistValuesByRecordType = requestAdapter((c) =>
  objectName(c.objectApiName) && c.recordTypeId ? "/ui-api/object-info/" + objectName(c.objectApiName) + "/picklist-values/" + c.recordTypeId : null
);
`
);

js(
  "uiLayoutApi",
  `
import { requestAdapter, objectName, query } from "lightning/studioBridge";

export const getLayout = requestAdapter((c) =>
  objectName(c.objectApiName) ? "/ui-api/layout/" + objectName(c.objectApiName) + query({ layoutType: c.layoutType, mode: c.mode, recordTypeId: c.recordTypeId }) : null
);
`
);

js(
  "uiRelatedListApi",
  `
import { requestAdapter, unavailableAdapter, objectName, fieldList, query, list } from "lightning/studioBridge";

export const getRelatedListRecords = requestAdapter((c) =>
  c.parentRecordId && c.relatedListId
    ? "/ui-api/related-list-records/" + c.parentRecordId + "/" + c.relatedListId +
      query({ fields: fieldList(c.fields), optionalFields: fieldList(c.optionalFields), pageSize: c.pageSize, sortBy: list(c.sortBy), where: c.where })
    : null
);

export const getRelatedListInfo = requestAdapter((c) =>
  objectName(c.parentObjectApiName) && c.relatedListId
    ? "/ui-api/related-list-info/" + objectName(c.parentObjectApiName) + "/" + c.relatedListId + query({ recordTypeId: c.recordTypeId })
    : null
);

export const getRelatedListsInfo = requestAdapter((c) =>
  objectName(c.parentObjectApiName) ? "/ui-api/related-list-info/" + objectName(c.parentObjectApiName) + query({ recordTypeId: c.recordTypeId }) : null
);

export const getRelatedListCount = requestAdapter((c) =>
  c.parentRecordId && c.relatedListId ? "/ui-api/related-list-count/" + c.parentRecordId + "/" + c.relatedListId : null
);

export const getRelatedListRecordsBatch = unavailableAdapter("getRelatedListRecordsBatch");
export const getRelatedListInfoBatch = unavailableAdapter("getRelatedListInfoBatch");
`
);

for (const [name, adapters] of [
  [
    "uiListsApi",
    [
      "getListUi",
      "getListInfoByName",
      "getListInfosByName",
      "getListRecordsByName",
      "getListInfosByObjectName",
      "getListObjectInfo",
      "getListPreferences",
    ],
  ],
  ["uiListApi", ["getListUi"]],
  [
    "uiActionsApi",
    [
      "getRecordActions",
      "getRecordEditActions",
      "getRelatedListActions",
      "getRelatedListsActions",
      "getGlobalActions",
      "getQuickActionLayout",
      "getQuickActionDefaults",
      "getLookupActions",
      "getObjectCreateActions",
    ],
  ],
  ["uiAppsApi", ["getNavItems", "getAllApps", "getAppDetails", "getSelectedApp"]],
] as const) {
  js(
    name,
    `import { unavailableAdapter } from "lightning/studioBridge";\n` +
      adapters.map((a) => `export const ${a} = unavailableAdapter("${a}");`).join("\n")
  );
}

const GRAPHQL = `
import { request, requestAdapter } from "lightning/studioBridge";

/** The query text; the platform's parsed form isn't needed to send it. */
export function gql(strings, ...values) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += String(values[i]);
  });
  return out;
}

/** Emits { data, errors } as the platform does, rather than wrapping the response in data. */
export const graphql = requestAdapter(() => null);
graphql.prototype.run = function () {
  if (!this.connected || !this.config || !this.config.query) return;
  const n = ++this.seq;
  const c = this.config;
  request("POST", "/graphql", { query: String(c.query), variables: c.variables || {}, operationName: c.operationName }).then(
    (r) => n === this.seq && this.callback({ data: r && r.data, errors: r && r.errors && r.errors.length ? r.errors : undefined }),
    (error) => n === this.seq && this.callback({ data: undefined, errors: [error && error.body ? error.body : { message: String(error) }] })
  );
};

export function refreshGraphQL() {
  return Promise.resolve();
}
`;
js("uiGraphQLApi", GRAPHQL);
js("graphql", GRAPHQL);

js(
  "navigation",
  `
import { context, emit } from "lightning/studioBridge";

const Navigate = Symbol("Navigate");
const GenerateUrl = Symbol("GenerateUrl");

export function NavigationMixin(Base) {
  return class extends Base {
    [Navigate](pageReference) {
      emit("navigate", { pageReference: JSON.parse(JSON.stringify(pageReference || {})) });
    }
    [GenerateUrl]() {
      return Promise.resolve("#");
    }
  };
}
NavigationMixin.Navigate = Navigate;
NavigationMixin.GenerateUrl = GenerateUrl;

/** LMR renders an inline component from a standard__component PageRef with recordId and objectApiName in its state. */
export class CurrentPageReference {
  constructor(callback) {
    this.callback = callback;
  }
  connect() {
    const c = context();
    this.callback({ type: "standard__component", attributes: { componentName: c.componentName }, state: { recordId: c.recordId || "", objectApiName: c.objectApiName || "" } });
  }
  update() {}
  disconnect() {}
}
`
);

js(
  "platformShowToastEvent",
  `
export class ShowToastEvent extends CustomEvent {
  constructor(toast) {
    super("lightning__showtoast", { composed: true, cancelable: true, bubbles: true, detail: toast });
  }
}
`
);

// A quick action closes itself with this event; the host closes the action sheet when it sees the "close" message.
js(
  "actions",
  `
export class CloseActionScreenEvent extends CustomEvent {
  constructor() {
    super("lightning__actionsclosescreen", { composed: true, cancelable: true, bubbles: true });
  }
}
`
);

js(
  "messageService",
  `
const subscribers = new Set();
export const APPLICATION_SCOPE = Symbol("APPLICATION_SCOPE");
export class MessageContext {
  constructor(callback) {
    this.callback = callback;
  }
  connect() {
    this.callback({});
  }
  update() {}
  disconnect() {}
}
export function createMessageContext() {
  return {};
}
export function releaseMessageContext() {}
export function publish(_context, channel, message) {
  for (const s of [...subscribers]) if (s.channel === channel || (s.channel && channel && s.channel.channel === channel.channel)) s.listener(message);
}
export function subscribe(_context, channel, listener) {
  const s = { channel, listener };
  subscribers.add(s);
  return s;
}
export function unsubscribe(subscription) {
  subscribers.delete(subscription);
}
`
);

js(
  "refresh",
  `
export const REFRESH_ERROR = "error";
export const REFRESH_COMPLETE = "complete";
export const REFRESH_COMPLETE_WITH_ERRORS = "completeWithErrors";
export class RefreshEvent extends CustomEvent {
  constructor() {
    super("lightning__refreshevent", { bubbles: true, composed: true });
  }
}
export function registerRefreshContainer() {
  return 0;
}
export function unregisterRefreshContainer() {}
export function registerRefreshHandler() {
  return 0;
}
export function unregisterRefreshHandler() {}
`
);

js(
  "actions",
  `
export class CloseActionScreenEvent extends CustomEvent {
  constructor() {
    super("lightning__actionsclosescreen", { bubbles: true, composed: true });
  }
}
`
);

js(
  "platformResourceLoader",
  `
import { failure } from "lightning/studioBridge";
const offline = () => Promise.reject(failure("Static resources aren't loaded in Studio's preview.", 503));
export const loadScript = offline;
export const loadStyle = offline;
`
);

js(
  "mobileCapabilities",
  `
const none = () => ({ isAvailable: () => false });
export const getBarcodeScanner = none;
export const getLocationService = none;
export const getNfcService = none;
export const getContactsService = none;
export const getBiometricsService = none;
export const getCalendarService = none;
export const getDocumentScanner = none;
export const getAppReviewService = none;
export const getPaymentsService = none;
export const getARSpaceCapture = none;
`
);

js("logger", `export function log() {}`);

js(
  "empApi",
  `
import { failure } from "lightning/studioBridge";
export function subscribe() {
  return Promise.reject(failure("Streaming isn't available in Studio's preview.", 503));
}
export function unsubscribe() {
  return Promise.resolve();
}
export function onError() {}
export function setDebugFlag() {}
export function isEmpEnabled() {
  return Promise.resolve(false);
}
`
);

js(
  "messages",
  `import { LightningElement } from "lwc";\nexport default class Messages extends LightningElement {}`
);
SHIM_FILES["lightning/messages/messages.html"] = "<template></template>\n";

// ── Record forms ──────────────────────────────────────────────────────────────
// lightning-record-*-form and their fields are LDS-backed, so the base
// components package doesn't ship them. These register their fields with the
// enclosing form, which reads the record and object info once.

js(
  "studioRecordFields",
  `
import { request, objectName, fieldName } from "lightning/studioBridge";

export const REGISTER = "studio__registerfield";

/** Collects the fields a form's children ask for, then answers them from one record read. */
export class FieldRegistry {
  constructor(onLoad) {
    this.fields = new Map();
    this.onLoad = onLoad;
    this.scheduled = false;
    this.recordId = undefined;
    this.objectApiName = undefined;
  }
  register(name, receive) {
    const list = this.fields.get(name) || [];
    list.push(receive);
    this.fields.set(name, list);
    this.schedule();
  }
  set(recordId, objectApiName) {
    this.recordId = recordId;
    this.objectApiName = objectName(objectApiName);
    this.schedule();
  }
  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    Promise.resolve().then(() => {
      this.scheduled = false;
      this.load();
    });
  }
  load() {
    const o = this.objectApiName;
    if (!o || !this.fields.size) return;
    const names = [...this.fields.keys()];
    const info = request("GET", "/ui-api/object-info/" + o);
    const record = this.recordId
      ? request("GET", "/ui-api/records/" + this.recordId + "?optionalFields=" + encodeURIComponent(names.map((n) => o + "." + n).join(",")))
      : Promise.resolve(null);
    Promise.all([info, record]).then(
      ([objectInfo, rec]) => {
        for (const [name, receivers] of this.fields) {
          const meta = (objectInfo && objectInfo.fields && objectInfo.fields[name]) || {};
          const f = rec && rec.fields && rec.fields[name];
          const value = f ? f.value : null;
          const displayValue = f ? (f.displayValue != null ? f.displayValue : value) : null;
          for (const r of receivers) r({ label: meta.label || name, dataType: meta.dataType, value, displayValue });
        }
        if (this.onLoad) this.onLoad(rec, objectInfo);
      },
      (error) => {
        for (const receivers of this.fields.values()) for (const r of receivers) r({ error });
      }
    );
  }
}

/** The field's API name relative to its object: "Name" for "Account.Name" or the schema import. */
export function localName(f) {
  const n = fieldName(f) || (typeof f === "object" && f && f.fieldApiName) || "";
  return n.includes(".") ? n.slice(n.indexOf(".") + 1) : n;
}

export function text(v) {
  if (v === true) return "✓";
  if (v === false || v == null) return "";
  return typeof v === "object" ? "" : String(v);
}
`
);

const FORM_JS = (cls: string) => `
import { LightningElement, api } from "lwc";
import { FieldRegistry, REGISTER } from "lightning/studioRecordFields";

export default class ${cls} extends LightningElement {
  _recordId;
  _objectApiName;
  @api density;
  @api recordTypeId;
  constructor() {
    super();
    this.registry = new FieldRegistry((record, objectInfo) => {
      const records = record ? { [record.id]: record } : {};
      const objectInfos = objectInfo ? { [objectInfo.apiName]: objectInfo } : {};
      this.dispatchEvent(new CustomEvent("load", { detail: { records, objectInfos, record } }));
    });
    this.template.addEventListener(REGISTER, (e) => this.onRegister(e));
    this.addEventListener(REGISTER, (e) => this.onRegister(e));
  }
  onRegister(e) {
    e.stopPropagation();
    this.registry.register(e.detail.field, e.detail.receive);
  }
  @api get recordId() {
    return this._recordId;
  }
  set recordId(v) {
    this._recordId = v;
    this.registry.set(this._recordId, this._objectApiName);
  }
  @api get objectApiName() {
    return this._objectApiName;
  }
  set objectApiName(v) {
    this._objectApiName = v;
    this.registry.set(this._recordId, this._objectApiName);
  }
  @api submit() {
    this.dispatchEvent(new CustomEvent("error", { detail: { message: "Studio's preview is read-only, so this change wasn't saved." } }));
  }
}
`;

component("recordViewForm", FORM_JS("RecordViewForm"), `<template><slot></slot></template>`);
component("recordEditForm", FORM_JS("RecordEditForm"), `<template><slot></slot></template>`);

const FIELD_JS = (cls: string) => `
import { LightningElement, api } from "lwc";
import { REGISTER, localName, text } from "lightning/studioRecordFields";

export default class ${cls} extends LightningElement {
  @api fieldName;
  @api variant;
  @api fieldClass;
  @api disabled;
  @api readOnly;
  @api required;
  label = "";
  shown = "";
  checked = false;
  isBoolean = false;
  connectedCallback() {
    const field = localName(this.fieldName);
    if (!field) return;
    this.label = field;
    this.dispatchEvent(
      new CustomEvent(REGISTER, {
        bubbles: true,
        composed: true,
        detail: {
          field,
          receive: (r) => {
            if (r.error) return;
            this.label = r.label;
            this.isBoolean = r.dataType === "Boolean";
            this.checked = r.value === true;
            this.shown = text(r.displayValue);
          },
        },
      })
    );
  }
  get showLabel() {
    return this.variant !== "label-hidden";
  }
  get elementClass() {
    const inline = this.variant === "label-inline" ? " slds-form-element_horizontal" : this.variant === "label-stacked" ? " slds-form-element_stacked" : "";
    return "slds-form-element slds-form-element_readonly" + inline + (this.fieldClass ? " " + this.fieldClass : "");
  }
  @api reset() {}
  @api get value() {
    return this.shown;
  }
}
`;

component(
  "outputField",
  FIELD_JS("OutputField"),
  `
<template>
  <div class={elementClass}>
    <template lwc:if={showLabel}><span class="slds-form-element__label">{label}</span></template>
    <div class="slds-form-element__control">
      <template lwc:if={isBoolean}><lightning-input type="checkbox" checked={checked} disabled variant="label-hidden" label={label}></lightning-input></template>
      <template lwc:else><div class="slds-form-element__static">{shown}</div></template>
    </div>
  </div>
</template>
`
);

component(
  "inputField",
  FIELD_JS("InputField"),
  `
<template>
  <template lwc:if={isBoolean}>
    <lightning-input type="checkbox" label={label} checked={checked} disabled={disabled} variant={variant}></lightning-input>
  </template>
  <template lwc:else>
    <lightning-input label={label} value={shown} disabled={disabled} read-only={readOnly} required={required} variant={variant}></lightning-input>
  </template>
</template>
`
);

component(
  "recordForm",
  `
import { LightningElement, api } from "lwc";
import { request, objectName } from "lightning/studioBridge";
import { localName } from "lightning/studioRecordFields";

export default class RecordForm extends LightningElement {
  @api recordId;
  @api objectApiName;
  @api layoutType;
  @api columns;
  @api mode;
  @api density;
  @api recordTypeId;
  _fields;
  layoutFields = [];
  @api get fields() {
    return this._fields;
  }
  set fields(v) {
    this._fields = v;
  }
  connectedCallback() {
    if (this.fieldNames.length || !this.layoutType || !this.recordId) return;
    request("GET", "/ui-api/records/" + this.recordId + "?layoutTypes=" + encodeURIComponent(this.layoutType)).then(
      (r) => (this.layoutFields = Object.keys((r && r.fields) || {})),
      () => {}
    );
  }
  get fieldNames() {
    const v = this._fields;
    return (v == null ? [] : Array.isArray(v) ? v : [v]).map(localName).filter(Boolean);
  }
  get cells() {
    const names = this.fieldNames.length ? this.fieldNames : this.layoutFields;
    const size = Math.max(1, Math.min(12, Number(this.columns) || 1));
    return names.map((name) => ({ name, cls: "slds-col slds-p-horizontal_x-small slds-size_1-of-" + size }));
  }
  get object() {
    return objectName(this.objectApiName);
  }
}
`,
  `
<template>
  <lightning-record-view-form record-id={recordId} object-api-name={object}>
    <div class="slds-grid slds-wrap">
      <template for:each={cells} for:item="c">
        <div key={c.name} class={c.cls}><lightning-output-field field-name={c.name}></lightning-output-field></div>
      </template>
    </div>
  </lightning-record-view-form>
</template>
`
);

/** A base component Studio doesn't have: renders a labelled box so the rest of the card still shows. */
export function placeholderComponent(name: string): Record<string, string> {
  const tag = "lightning-" + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  return {
    [`lightning/${name}/${name}.js`]: `import { LightningElement } from "lwc";\nexport default class Placeholder extends LightningElement {}\n`,
    [`lightning/${name}/${name}.html`]: `<template><div class="slds-box slds-box_x-small slds-text-color_weak slds-text-body_small">&lt;${tag}&gt; isn't drawn in Studio's preview</div></template>\n`,
  };
}

/** Lightning modules the shims stand in for (over lightning-base-components). */
export const SHIMMED_LIGHTNING = new Set(Object.keys(SHIM_FILES).map((p) => p.split("/")[1]));

/**
 * Source of an `@salesforce/*` import, or null to leave it to
 * lightning-base-components (its labels, gates and i18n values).
 */
export function salesforceModule(id: string, labels: Record<string, string>): string | null {
  const rest = id.slice("@salesforce/".length);
  const slash = rest.indexOf("/");
  const kind = slash < 0 ? rest : rest.slice(0, slash);
  const name = slash < 0 ? "" : rest.slice(slash + 1);
  const value = (v: unknown) => `export default ${JSON.stringify(v)};\n`;
  switch (kind) {
    case "apex":
    case "apexContinuation": {
      if (!name)
        return `export function refreshApex() { return Promise.resolve(); }
export function getSObjectValue(sobject, field) {
  const n = typeof field === "string" ? field : field && field.fieldApiName;
  if (!n) return undefined;
  const parts = typeof field === "string" && n.includes(".") ? n.split(".").slice(1) : n.split(".");
  return parts.reduce((o, k) => (o == null ? undefined : o[k]), sobject);
}
`;
      return `import { failure } from "lightning/studioBridge";
const message = ${JSON.stringify(`Apex ${name} isn't run in Studio's preview. On the iPad it needs a connection.`)};
function method() { return Promise.reject(failure(message, 503)); }
method.adapter = class {
  constructor(callback) { this.callback = callback; }
  connect() { this.callback({ data: undefined, error: failure(message, 503) }); }
  update() {}
  disconnect() {}
};
export default method;
`;
    }
    case "schema": {
      const dot = name.indexOf(".");
      return value(
        dot < 0
          ? { objectApiName: name }
          : { objectApiName: name.slice(0, dot), fieldApiName: name.slice(dot + 1) }
      );
    }
    case "label":
      if (name.startsWith("c.")) return value(labels[name.slice(2)] ?? name.slice(2));
      return null;
    case "user":
      if (name === "Id") return `export default (globalThis.__studioContext || {}).userId;\n`;
      if (name === "isGuest") return value(false);
      return value(undefined);
    case "userPermission":
    case "customPermission":
      return `export default ((globalThis.__studioContext || {}).permissions || {})[${JSON.stringify(name)}];\n`;
    case "i18n":
      if (name === "locale" || name === "lang")
        return `export default (globalThis.__studioContext || {}).locale || "en-US";\n`;
      if (name === "timeZone")
        return `export default (globalThis.__studioContext || {}).timeZone || "America/New_York";\n`;
      return null;
    case "resourceUrl":
      return value(`/resource/${name}`);
    case "contentAssetUrl":
      return value(`/file-asset/${name}`);
    case "messageChannel":
      return value({ channel: name });
    case "community":
    case "site":
      return value(undefined);
    default:
      return null;
  }
}

/** Last-resort source for an `@salesforce/*` import nothing else resolved. */
export function salesforceFallback(id: string): string {
  const rest = id.slice("@salesforce/".length);
  const kind = rest.split("/")[0];
  const name = rest.slice(kind.length + 1);
  if (kind === "label")
    return `export default ${JSON.stringify(name.slice(name.indexOf(".") + 1))};\n`;
  if (kind === "gate" || kind === "accessCheck") return `export default false;\n`;
  return `export default undefined;\n`;
}
