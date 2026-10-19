// Generated from the JSON appendix of knowledge/modules/custom-scripts/custom-scripts-api-reference.md (section 8).
// Feeds the editor's autocomplete: custom-script globals, their methods, the injected classes and functions.

export type ApiKind = "variable" | "method" | "class" | "function";

export interface ApiCompletion {
  label: string;
  kind: ApiKind;
  /** The global or class a method belongs to. */
  parent?: string;
  signature: string;
  doc: string;
}

export const SCRIPT_API: ApiCompletion[] = [
  {
    "label": "env",
    "kind": "variable",
    "signature": "env",
    "doc": "Environment options, logging and custom-label formatting."
  },
  {
    "label": "db",
    "kind": "variable",
    "signature": "db",
    "doc": "Local/org database access; synchronous on mobile, asynchronous on desktop."
  },
  {
    "label": "record",
    "kind": "variable",
    "signature": "record",
    "doc": "The current record (field accessors, record type, context data)."
  },
  {
    "label": "user",
    "kind": "variable",
    "signature": "user",
    "doc": "The current user (field accessors)."
  },
  {
    "label": "getOption",
    "kind": "method",
    "parent": "env",
    "signature": "getOption(name)",
    "doc": "Returns an environment option: fromStatus, toStatus, fieldName, actionName."
  },
  {
    "label": "setOption",
    "kind": "method",
    "parent": "env",
    "signature": "setOption(name, value)",
    "doc": "Sets an environment option."
  },
  {
    "label": "log",
    "kind": "method",
    "parent": "env",
    "signature": "log(msg)",
    "doc": "Logs msg to the console with the prefix 'JS LOG: '."
  },
  {
    "label": "formatCustomLabel",
    "kind": "method",
    "parent": "env",
    "signature": "formatCustomLabel(key, defaultValue, argumentsList)",
    "doc": "Translates a custom label to the user's locale, substituting arguments; returns the value to use as title."
  },
  {
    "label": "rowById",
    "kind": "method",
    "parent": "db",
    "signature": "rowById(entity, id, selectedFields)",
    "doc": "Retrieves a record by Id. selectedFields (Array) is desktop only."
  },
  {
    "label": "rowsByEntity",
    "kind": "method",
    "parent": "db",
    "signature": "rowsByEntity(entity, selectedFields)",
    "doc": "Retrieves the records of an object. selectedFields is desktop only."
  },
  {
    "label": "query",
    "kind": "method",
    "parent": "db",
    "signature": "query(entity, whereClause, selectedFields)",
    "doc": "Retrieves records matching a SOQL WHERE clause (use ConditionBuilder.build()). selectedFields is desktop only."
  },
  {
    "label": "bulkQuery",
    "kind": "method",
    "parent": "db",
    "signature": "bulkQuery(queries)",
    "doc": "Runs several queries ({uniqueRequestKey, sObjectName, condition: ConditionEnhancedBuilder.build(), selectedFields}); returns results keyed by uniqueRequestKey."
  },
  {
    "label": "noNs_query",
    "kind": "method",
    "parent": "db",
    "signature": "noNs_query(entity, whereClause)",
    "doc": "Query without managed-namespace prefixing of __c/__mdt objects (Summer '26; only in the troubleshoot note)."
  },
  {
    "label": "stringValue",
    "kind": "method",
    "parent": "record",
    "signature": "stringValue(key)",
    "doc": "String field value if it exists and is readable."
  },
  {
    "label": "numValue",
    "kind": "method",
    "parent": "record",
    "signature": "numValue(key)",
    "doc": "Number field value if it exists and is readable."
  },
  {
    "label": "boolValue",
    "kind": "method",
    "parent": "record",
    "signature": "boolValue(key)",
    "doc": "Boolean field value if it exists and is readable."
  },
  {
    "label": "dateValue",
    "kind": "method",
    "parent": "record",
    "signature": "dateValue(key)",
    "doc": "Date field value if it exists and is readable."
  },
  {
    "label": "setValue",
    "kind": "method",
    "parent": "record",
    "signature": "setValue(key, value)",
    "doc": "Sets a field value on the current record."
  },
  {
    "label": "recordTypeName",
    "kind": "method",
    "parent": "record",
    "signature": "recordTypeName()",
    "doc": "Name of the record's record type, if any."
  },
  {
    "label": "getContextData",
    "kind": "method",
    "parent": "record",
    "signature": "getContextData()",
    "doc": "Visit context data (related in-memory records); used by official VAV example, not on the record reference page."
  },
  {
    "label": "stringValue",
    "kind": "method",
    "parent": "user",
    "signature": "stringValue(key)",
    "doc": "String field value of the user if readable."
  },
  {
    "label": "numValue",
    "kind": "method",
    "parent": "user",
    "signature": "numValue(key)",
    "doc": "Number field value of the user if readable."
  },
  {
    "label": "boolValue",
    "kind": "method",
    "parent": "user",
    "signature": "boolValue(key)",
    "doc": "Boolean field value of the user if readable."
  },
  {
    "label": "dateValue",
    "kind": "method",
    "parent": "user",
    "signature": "dateValue(key)",
    "doc": "Date field value of the user if readable."
  },
  {
    "label": "setValue",
    "kind": "method",
    "parent": "user",
    "signature": "setValue(key, value)",
    "doc": "Sets a field value on the user."
  },
  {
    "label": "Condition",
    "kind": "class",
    "signature": "new Condition()",
    "doc": "Abstract base class; do not use directly."
  },
  {
    "label": "ConditionBuilder",
    "kind": "class",
    "signature": "new ConditionBuilder(objectType, condition)",
    "doc": "Builds a WHERE clause, validating the user's field access. build() returns the clause (await it)."
  },
  {
    "label": "ConditionEnhancedBuilder",
    "kind": "class",
    "signature": "new ConditionEnhancedBuilder(objectType, condition)",
    "doc": "For db.bulkQuery only. build() returns {soqlString, fieldNamesByObjectNames}."
  },
  {
    "label": "OperatorCondition",
    "kind": "class",
    "signature": "new OperatorCondition(field, operator)",
    "doc": "Super class for field/set conditions."
  },
  {
    "label": "FieldCondition",
    "kind": "class",
    "signature": "new FieldCondition(field, operator, value)",
    "doc": "field operator value; null supported for = and !=."
  },
  {
    "label": "DateFieldCondition",
    "kind": "class",
    "signature": "new DateFieldCondition(dateField, operator, dateValue)",
    "doc": "Date comparison."
  },
  {
    "label": "DateTimeFieldCondition",
    "kind": "class",
    "signature": "new DateTimeFieldCondition(dateTimeField, operator, dateTimeValue)",
    "doc": "DateTime comparison."
  },
  {
    "label": "SetCondition",
    "kind": "class",
    "signature": "new SetCondition(field, operator, values)",
    "doc": "values: Array or Query subquery; e.g. IN."
  },
  {
    "label": "GroupCondition",
    "kind": "class",
    "signature": "new GroupCondition(nestingOperator)",
    "doc": "Group of conditions joined by AND or OR; add(condition)."
  },
  {
    "label": "AndCondition",
    "kind": "class",
    "signature": "new AndCondition()",
    "doc": "GroupCondition joined by AND."
  },
  {
    "label": "OrCondition",
    "kind": "class",
    "signature": "new OrCondition()",
    "doc": "GroupCondition joined by OR."
  },
  {
    "label": "Query",
    "kind": "class",
    "signature": "new Query()",
    "doc": "Subquery builder for SetCondition: select(field).from(sObjectType).where(condition)."
  },
  {
    "label": "build",
    "kind": "method",
    "parent": "ConditionBuilder",
    "signature": "build()",
    "doc": "Builds the condition."
  },
  {
    "label": "build",
    "kind": "method",
    "parent": "ConditionEnhancedBuilder",
    "signature": "build()",
    "doc": "Builds the condition."
  },
  {
    "label": "add",
    "kind": "method",
    "parent": "GroupCondition",
    "signature": "add(condition)",
    "doc": "Adds a condition to the group; returns the group."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "Condition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "OperatorCondition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "FieldCondition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "DateFieldCondition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "DateTimeFieldCondition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "SetCondition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "GroupCondition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "AndCondition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "OrCondition",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "toSoql",
    "kind": "method",
    "parent": "Query",
    "signature": "toSoql()",
    "doc": "Returns the SOQL fragment."
  },
  {
    "label": "getRequiredFields",
    "kind": "method",
    "parent": "Condition",
    "signature": "getRequiredFields(objectType)",
    "doc": "Fields the condition needs."
  },
  {
    "label": "getRequiredFields",
    "kind": "method",
    "parent": "OperatorCondition",
    "signature": "getRequiredFields(objectType)",
    "doc": "Fields the condition needs."
  },
  {
    "label": "getRequiredFields",
    "kind": "method",
    "parent": "SetCondition",
    "signature": "getRequiredFields(objectType)",
    "doc": "Fields the condition needs."
  },
  {
    "label": "getRequiredFields",
    "kind": "method",
    "parent": "GroupCondition",
    "signature": "getRequiredFields(objectType)",
    "doc": "Fields the condition needs."
  },
  {
    "label": "getRequiredFields",
    "kind": "method",
    "parent": "Query",
    "signature": "getRequiredFields()",
    "doc": "Desktop only; does not work on mobile."
  },
  {
    "label": "select",
    "kind": "method",
    "parent": "Query",
    "signature": "select(field)",
    "doc": "Sets the single selected field; returns Query."
  },
  {
    "label": "from",
    "kind": "method",
    "parent": "Query",
    "signature": "from(sObjectType)",
    "doc": "Sets the object; returns Query."
  },
  {
    "label": "where",
    "kind": "method",
    "parent": "Query",
    "signature": "where(condition)",
    "doc": "Sets the condition; returns Query."
  },
  {
    "label": "enableAccessErrors",
    "kind": "function",
    "signature": "enableAccessErrors()",
    "doc": "Makes field-access failures throw exceptions in the script."
  }
];

/** Globals a script can use without declaring them (for lint and completion). */
export const SCRIPT_GLOBALS = SCRIPT_API.filter((c) => c.kind === "variable" || c.kind === "class" || c.kind === "function").map((c) => c.label);
