import type { ScriptType } from "./script-model";

/** A starting point offered by the new-script dialog. Code follows the skill's confirmed patterns (see skills/lsc-custom-scripts). */
export interface ScriptTemplate {
  id: string;
  type: ScriptType;
  title: string;
  /** One plain sentence about what the script does. */
  blurb: string;
  /** A name to suggest when the admin hasn't typed one. */
  suggestedName: string;
  code: string;
}

const lines = (...l: string[]) => l.join("\n") + "\n";

/**
 * The visit action validation wrapper: context-data parsing, the web/iPad split, Proxy-safe results. `checks` are the
 * bodies of the async check functions, `calls` the names of the ones to run. No comment may come before the IIFE.
 */
function visitScript(checks: string[], calls: string[]): string {
  return lines(
    "(() => {",
    "    function parseContextData(record) {",
    "        try {",
    "            if (!record || typeof record.getContextData !== 'function') return {};",
    "            var contextData = record.getContextData();",
    "            if (typeof contextData === 'string') return JSON.parse(contextData);",
    "            if (typeof contextData === 'object' && contextData !== null) return contextData;",
    "            return {};",
    "        } catch (e) { return {}; }",
    "    }",
    "",
    "    function getFieldData(contextData, baseFieldName) {",
    "        return contextData[baseFieldName + '.VisitId'] || contextData[baseFieldName];",
    "    }",
    "",
    "    function unwrapProxy(results) {",
    "        return JSON.parse(JSON.stringify(results));",
    "    }",
    "",
    ...checks,
    "",
    "    async function validateVisit() {",
    "        try {",
    "            var contextData = parseContextData(record);",
    `            var results = [${calls.map((c) => `await ${c}(contextData)`).join(", ")}];`,
    "            return unwrapProxy(results);",
    "        } catch (error) {",
    "            return [{ title: 'Validation error: ' + error.message, status: 'error' }];",
    "        }",
    "    }",
    "",
    "    if (record && user && env && db) {",
    "        var contextData = parseContextData(record);",
    "        var hasWebField = contextData['ProviderVisit'] !== undefined;",
    "        if (hasWebField) return [validateVisit()];",
    "        else return validateVisit();",
    "    }",
    "})();"
  );
}

const requireDetailing = lines(
  "    async function requireProductDetail(contextData) {",
  "        try {",
  "            var details = getFieldData(contextData, 'ProviderVisitProdDetailing') || [];",
  "            if (details.length === 0) {",
  "                return { title: 'Add at least one product detail before you submit this visit.', status: 'error' };",
  "            }",
  "            return { title: 'Product detail recorded', status: 'success' };",
  "        } catch (e) {",
  "            return { title: 'Validation error: ' + e.message, status: 'error' };",
  "        }",
  "    }"
).trimEnd();

const blockExpiredLots = lines(
  "    async function blockExpiredLots(contextData) {",
  "        try {",
  "            var samples = getFieldData(contextData, 'ProductDisbursement') || [];",
  "            var now = new Date();",
  "            var expired = [];",
  "            samples.forEach(function (sample) {",
  "                var info = {};",
  "                try { info = JSON.parse(sample.AdditionalInformation || '{}'); } catch (e) {}",
  "                var batch = info.ProductionBatch || {};",
  "                if (batch.ExpirationDate && new Date(batch.ExpirationDate) < now) {",
  "                    var product = (info.Product2 && info.Product2.Name) || 'A sample';",
  "                    expired.push(product + ' (lot ' + (batch.Name || 'unknown') + ')');",
  "                }",
  "            });",
  "            if (expired.length > 0) {",
  "                return { title: 'Expired sample lots: ' + expired.join(', ') + '. Remove them to continue.', status: 'error' };",
  "            }",
  "            return { title: 'No expired sample lots', status: 'success' };",
  "        } catch (e) {",
  "            return { title: 'Validation error: ' + e.message, status: 'error' };",
  "        }",
  "    }"
).trimEnd();

const blankVisitCheck = lines(
  "    async function myCheck(contextData) {",
  "        try {",
  "            var visit = contextData.ProviderVisit || {};",
  "            // Return { title: 'message', status: 'success' | 'warning' | 'error' }",
  "            return { title: 'Visit checks passed', status: 'success' };",
  "        } catch (e) {",
  "            return { title: 'Validation error: ' + e.message, status: 'error' };",
  "        }",
  "    }"
).trimEnd();

const requiredFieldValidation = lines(
  "(() => {",
  "    async function requireDescription() {",
  "        try {",
  "            var value = record.stringValue('Description');",
  "            if (!value || !value.trim()) {",
  "                return { title: 'Add a description before moving this record on.', status: 'error' };",
  "            }",
  "            return { title: 'Description provided', status: 'success' };",
  "        } catch (error) {",
  "            return { title: 'Error: ' + error.message, status: 'error' };",
  "        }",
  "    }",
  "",
  "    return [requireDescription()];",
  "})();"
);

const blankWorkflow = lines(
  "(() => {",
  "    async function myCheck() {",
  "        try {",
  "            // Use the record, user, db and env globals.",
  "            return { title: 'Checks passed', status: 'success' };",
  "        } catch (error) {",
  "            return { title: 'Error: ' + error.message, status: 'error' };",
  "        }",
  "    }",
  "",
  "    return [myCheck()];",
  "})();"
);

const checklistRequiredFields = lines(
  "(() => {",
  "    var REQUIRED = [",
  "        { field: 'Description', label: 'Description' },",
  "        { field: 'Status', label: 'Status' }",
  "    ];",
  "",
  "    async function checkRequiredFields() {",
  "        try {",
  "            return REQUIRED.map(function (item) {",
  "                var value = record.stringValue(item.field);",
  "                var done = !!value && String(value).trim() !== '';",
  "                return {",
  "                    title: done ? item.label + ' is filled in' : 'Fill in ' + item.label,",
  "                    status: done ? 'success' : 'warning'",
  "                };",
  "            });",
  "        } catch (error) {",
  "            return [{ title: 'Error: ' + error.message, status: 'error' }];",
  "        }",
  "    }",
  "",
  "    return [checkRequiredFields()];",
  "})();"
);

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: "vav-product-detail",
    type: "VisitActionValidation",
    title: "Require a product detail before Submit",
    blurb: "Blocks the visit until at least one product has been detailed.",
    suggestedName: "Visit checks",
    code: visitScript([requireDetailing], ["requireProductDetail"]),
  },
  {
    id: "vav-expired-lots",
    type: "VisitActionValidation",
    title: "Block expired sample lots",
    blurb: "Blocks the visit when a sample left behind is from an expired lot.",
    suggestedName: "Visit checks",
    code: visitScript([blockExpiredLots], ["blockExpiredLots"]),
  },
  {
    id: "vav-both",
    type: "VisitActionValidation",
    title: "Product detail and expired lots",
    blurb: "Both checks in one script — only one visit script runs, so combine your checks.",
    suggestedName: "Visit checks",
    code: visitScript([requireDetailing, "", blockExpiredLots], ["requireProductDetail", "blockExpiredLots"]),
  },
  {
    id: "vav-blank",
    type: "VisitActionValidation",
    title: "Empty visit check",
    blurb: "The wrapper that works on web and iPad, with one check to fill in.",
    suggestedName: "Visit checks",
    code: visitScript([blankVisitCheck], ["myCheck"]),
  },
  {
    id: "validation-required-field",
    type: "Validation",
    title: "Require a field before a stage change",
    blurb: "Stops a workflow record moving on until a field has a value.",
    suggestedName: "Require description",
    code: requiredFieldValidation,
  },
  {
    id: "validation-blank",
    type: "Validation",
    title: "Empty validation",
    blurb: "A script that returns one passing result, ready for your logic.",
    suggestedName: "Workflow validation",
    code: blankWorkflow,
  },
  {
    id: "checklist-required-fields",
    type: "Checklist",
    title: "Checklist: required fields",
    blurb: "Lists each required field as done or still to do.",
    suggestedName: "Required fields checklist",
    code: checklistRequiredFields,
  },
  {
    id: "checklist-blank",
    type: "Checklist",
    title: "Empty checklist",
    blurb: "A script that returns one passing item, ready for your items.",
    suggestedName: "Workflow checklist",
    code: blankWorkflow,
  },
];

export function templatesFor(type: ScriptType): ScriptTemplate[] {
  return SCRIPT_TEMPLATES.filter((t) => t.type === type);
}

/** The code a blank script of this type starts with: the type's empty template, so a blank script still runs. */
export function blankCodeFor(type: ScriptType): string {
  return templatesFor(type).find((t) => t.id.endsWith("-blank"))!.code;
}
