/**
 * The in-sandbox half of the runner: JavaScript source evaluated inside the
 * `vm` context before a script runs. It builds the globals a custom script
 * sees (`record`, `user`, `db`, `env`, the condition classes, `console`) and the
 * `__lscRun` entry the wrapped script is passed to.
 *
 * It talks to the host only through the object handed to the evaluated
 * function: strings in, strings out (`cfg`, `query`, `log`, `write`, `note`,
 * `done`). That object lives in a closure and is never reachable from script
 * code, so no host function object (and its realm's `Function`) leaks.
 *
 * Plain ES2020 inside String.raw — no backticks or dollar-braces in here.
 */
export const PRELUDE_SOURCE = String.raw`(function (H) {
  "use strict";
  // Every host call goes through host(). An exception a host function throws (bad input, or a stack
  // overflow forced in its frame) comes from the host realm, and its constructor's Function would
  // reach Node; it's swapped here for this realm's Error with only the message. JSON and Error are
  // captured before the script can replace them.
  var JP = JSON.parse, JS = JSON.stringify, SErr = Error;
  function host(name, a, b, c) {
    try { return H[name](a, b, c); } catch (e) {
      var m = "Studio's runner failed.";
      try { if (e && typeof e.message === "string") m = e.message; } catch (e2) { m = "Studio's runner failed."; }
      throw new SErr(m);
    }
  }
  var CFG = JP(host("cfg"));
  var WEB = CFG.platform === "web";
  var NSP = WEB ? "" : (CFG.nsPrefix || "");
  var g = globalThis;
  var state = { access: false };
  var PXS = new WeakSet();
  var PXMAP = new WeakMap();

  // Web runs once with real time and randomness. iPad scripts are replayed (their db calls are
  // synchronous), so there the clock is held at the run's start and randomness is seeded to
  // make every replay build the same queries.
  var RealDate = Date;
  if (!WEB) {
    var FIXED = CFG.now;
    class FDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
      static now() { return FIXED; }
    }
    g.Date = FDate;
    var seed = 123456789;
    Math.random = function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Web values come back wrapped like Locker Service proxies.
  function wrap(o) {
    if (!WEB || o === null || typeof o !== "object" || PXS.has(o)) return o;
    var hit = PXMAP.get(o);
    if (hit) return hit;
    var p = new Proxy(o, { get: function (t, k) { return wrap(Reflect.get(t, k, t)); } });
    PXS.add(p);
    PXMAP.set(o, p);
    return p;
  }

  function ret(fn) {
    if (WEB) return new Promise(function (res, rej) { try { res(fn()); } catch (e) { rej(e); } });
    return fn();
  }

  function isCustom(n) {
    return typeof n === "string" && /^[A-Za-z0-9_]+__(c|mdt)$/.test(n) && n.indexOf("__") === n.lastIndexOf("__");
  }
  function nsn(n, noNs) { return (NSP && !noNs && isCustom(n)) ? NSP + n : n; }

  function lit(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (v instanceof RealDate) return v.toISOString();
    return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  }
  function dateLit(v, withTime) {
    var d = v instanceof RealDate ? v : new RealDate(v);
    if (isNaN(d.getTime())) return lit(v);
    var s = d.toISOString();
    return withTime ? s : s.slice(0, 10);
  }
  function mergeReq(a, b) {
    Object.keys(b).forEach(function (k) {
      var cur = a[k] || (a[k] = []);
      b[k].forEach(function (f) { if (cur.indexOf(f) < 0) cur.push(f); });
    });
    return a;
  }

  // iPad: synchronous, answered from the replay cache.
  function hostCall(kind, args) {
    var r = JP(host("query", kind, JS(args)));
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  // Web: a real Promise the host settles when the query returns.
  function hostCallAsync(kind, args) {
    return new Promise(function (res, rej) {
      host("queryAsync", kind, JS(args), function (s) {
        var r = JP(s);
        if (r.ok) res(r); else rej(new Error(r.error));
      });
    });
  }

  // ---- condition classes ----
  class Condition {
    getRequiredFields() { return {}; }
    toSoql() { return ""; }
  }
  class OperatorCondition extends Condition {
    constructor(field, operator) { super(); this.field = field; this.operator = operator; }
    getRequiredFields(objectType) { var r = {}; r[objectType] = [this.field]; return r; }
  }
  class Group extends Condition {
    constructor(op) { super(); this.nestingOperator = op; this.conditions = []; }
    add(c) { this.conditions.push(c); return this; }
    getRequiredFields(t) {
      var r = {};
      this.conditions.forEach(function (c) { mergeReq(r, c.getRequiredFields(t)); });
      return r;
    }
    toSoql() {
      var op = this.nestingOperator;
      return this.conditions.map(function (c) { return "(" + c.toSoql() + ")"; }).join(" " + op + " ");
    }
  }
  class AndCondition extends Group { constructor() { super("AND"); } }
  class OrCondition extends Group { constructor() { super("OR"); } }

  class Query {
    constructor() { this._select = ""; this._from = ""; this._where = null; }
    select(f) { this._select = f; return this; }
    from(o) { this._from = o; return this; }
    where(c) { this._where = c; return this; }
    toSoql() {
      var s = "SELECT " + nsn(this._select, false) + " FROM " + nsn(this._from, false);
      if (this._where) s += " WHERE " + this._where.toSoql();
      return s;
    }
  }
  if (WEB) {
    Query.prototype.getRequiredFields = function () {
      var r = {};
      r[this._from] = [this._select];
      if (this._where) mergeReq(r, this._where.getRequiredFields(this._from));
      return r;
    };
  }

  function verifyAccess(r, objectType, fields) {
    if (!r.fields) return;
    var known = {};
    r.fields.forEach(function (f) { known[f.toLowerCase()] = true; });
    (fields || []).forEach(function (f) {
      if (/^[A-Za-z0-9_]+$/.test(f) && !known[f.toLowerCase()]) {
        throw new Error("Field " + f + " isn't accessible on " + objectType);
      }
    });
  }
  function checkAccess(objectType, fields) {
    if (typeof objectType !== "string") return;
    verifyAccess(hostCall("describe", { entity: objectType }), objectType, fields);
  }
  function checkAccessAsync(objectType, fields) {
    if (typeof objectType !== "string") return Promise.resolve();
    return hostCallAsync("describe", { entity: objectType }).then(function (r) { verifyAccess(r, objectType, fields); });
  }

  function variant(noNs) {
    function F(x) { return nsn(x, noNs); }
    class FieldCondition extends OperatorCondition {
      constructor(f, o, v) { super(f, o); this.value = v; }
      getRequiredFields(t) { var r = {}; r[t] = [F(this.field)]; return r; }
      toSoql() { return F(this.field) + " " + this.operator + " " + lit(this.value); }
    }
    class DateFieldCondition extends FieldCondition {
      toSoql() { return F(this.field) + " " + this.operator + " " + dateLit(this.value, false); }
    }
    class DateTimeFieldCondition extends FieldCondition {
      toSoql() { return F(this.field) + " " + this.operator + " " + dateLit(this.value, true); }
    }
    class SetCondition extends OperatorCondition {
      constructor(f, o, values) { super(f, o); this.values = values; }
      getRequiredFields(t) { var r = {}; r[t] = [F(this.field)]; return r; }
      toSoql() {
        var v = this.values;
        var body;
        if (v && typeof v.toSoql === "function") body = v.toSoql();
        else {
          var a = Array.isArray(v) ? Array.prototype.slice.call(v) : [];
          body = a.length ? a.map(function (x) { return lit(x); }).join(",") : "''";
        }
        return F(this.field) + " " + this.operator + " (" + body + ")";
      }
    }
    class ConditionBuilder {
      constructor(objectType, condition) { this.objectType = objectType; this.condition = condition; }
      build() {
        var self = this;
        if (WEB) {
          return new Promise(function (res) { res(self.condition.getRequiredFields(self.objectType)); }).then(function (req) {
            return checkAccessAsync(self.objectType, req[self.objectType]);
          }).then(function () { return self.condition.toSoql(); });
        }
        var req = self.condition.getRequiredFields(self.objectType);
        checkAccess(self.objectType, req[self.objectType]);
        return self.condition.toSoql();
      }
    }
    class ConditionEnhancedBuilder {
      constructor(objectType, condition) { this.objectType = objectType; this.condition = condition; }
      build() {
        var self = this;
        return ret(function () {
          return { soqlString: self.condition.toSoql(), fieldNamesByObjectNames: self.condition.getRequiredFields(self.objectType) };
        });
      }
    }
    return { FieldCondition: FieldCondition, DateFieldCondition: DateFieldCondition, DateTimeFieldCondition: DateTimeFieldCondition, SetCondition: SetCondition, ConditionBuilder: ConditionBuilder, ConditionEnhancedBuilder: ConditionEnhancedBuilder };
  }
  [[false, ""], [true, "_noNs"]].forEach(function (p) {
    var v = variant(p[0]);
    Object.keys(v).forEach(function (n) { g[n + p[1]] = v[n]; });
  });
  g.AndCondition = AndCondition;
  g.OrCondition = OrCondition;
  g.Query = Query;
  g.enableAccessErrors = function () { state.access = true; };

  // ---- rows (the objects db.query returns, and record / user) ----
  function cs(v) { return v === undefined ? undefined : v === null ? null : (typeof v === "object" ? JS(v) : String(v)); }
  function cn(v) { return v == null ? v : Number(v); }
  function cb(v) { return v == null ? v : (v === true || v === "true"); }
  function cd(v) { return v == null ? v : new Date(v); }

  function makeRow(item, obj) {
    var fields = item.fields;
    var lc = {};
    var sObj = {};
    function reindex() {
      lc = {};
      sObj = {};
      Object.keys(fields).forEach(function (k) {
        lc[k.toLowerCase()] = k;
        if (!(isCustom(k) && fields[k] === null)) sObj[k] = fields[k];
      });
    }
    reindex();
    var target = obj + (fields.Id ? ":" + fields.Id : "");
    function read(key, noNsCall) {
      if (typeof key !== "string") return undefined;
      if (isCustom(key) && !noNsCall) {
        if (state.access) throw new Error("Field " + key + " isn't accessible on " + obj);
        return undefined;
      }
      var k = lc[key.toLowerCase()];
      if (k === undefined) {
        if (state.access) throw new Error("Field " + key + " isn't accessible on " + obj);
        return undefined;
      }
      return fields[k];
    }
    var api = {
      enableAccessErrors: function () { state.access = true; },
      setValue: function (key, value) {
        var k = lc[String(key).toLowerCase()] || String(key);
        fields[k] = value;
        reindex();
        host("write", JS({ target: target, action: "setValue", field: k, value: value === undefined ? null : value }));
      },
      recordTypeName: function () { return item.rt || null; },
      getRecordType: function () { return item.rt || null; },
      save: function () {
        host("write", JS({ target: target, action: "save" }));
        return WEB ? Promise.resolve() : undefined;
      }
    };
    api.noNs_setValue = api.setValue;
    [["stringValue", cs], ["numValue", cn], ["boolValue", cb], ["dateValue", cd]].forEach(function (p) {
      api[p[0]] = function (key) { return p[1](read(key, false)); };
      api["noNs_" + p[0]] = function (key) { return p[1](read(key, true)); };
    });
    var o = {};
    Object.keys(api).forEach(function (n) { Object.defineProperty(o, n, { value: api[n], enumerable: false }); });
    if (WEB) {
      Object.defineProperty(o, "sObject", { get: function () { return sObj; }, enumerable: true });
      o.accessibleFields = Object.keys(fields);
      o.sObjectName = obj;
      o.namespaceUtils = {};
    }
    return o;
  }
  function rowsFrom(items, obj) { return wrap(items.map(function (it) { return makeRow(it, obj); })); }

  // ---- db ----
  function whereOf(w) {
    if (w === undefined || w === null || w === "") return "";
    if (typeof w === "string") return w;
    if (typeof w.then === "function") throw new Error("The where clause is a Promise. Await ConditionBuilder.build() before passing it to db.query.");
    throw new Error("The where clause must be a string.");
  }
  function fieldsOf(f, noNs) {
    if (!WEB || !Array.isArray(f)) return null;
    return Array.prototype.slice.call(f).map(function (x) { return nsn(String(x), noNs); });
  }
  function queryArgs(entity, where, fields, noNs) {
    if (typeof entity !== "string" || !entity) throw new Error("db: the object name must be a string.");
    return { entity: nsn(entity, noNs), where: whereOf(where), fields: fieldsOf(fields, noNs) };
  }
  function runQuery(entity, where, fields, noNs) {
    return rowsFrom(hostCall("query", queryArgs(entity, where, fields, noNs)).rows, entity);
  }
  function runQueryAsync(entity, where, fields, noNs) {
    return new Promise(function (res) { res(queryArgs(entity, where, fields, noNs)); }).then(function (a) {
      return hostCallAsync("query", a);
    }).then(function (r) { return rowsFrom(r.rows, entity); });
  }
  function dbq(entity, where, fields, noNs) { return WEB ? runQueryAsync(entity, where, fields, noNs) : runQuery(entity, where, fields, noNs); }
  var db = {};
  function def(name, fn) { Object.defineProperty(db, name, { value: fn, enumerable: true }); }
  [false, true].forEach(function (noNs) {
    var p = noNs ? "noNs_" : "";
    def(p + "query", function (entity, where, fields) { return ret(function () { return dbq(entity, where, fields, noNs); }); });
    def(p + "rowById", function (entity, id, fields) {
      return ret(function () {
        var q = dbq(entity, "Id = " + lit(id), fields, noNs);
        return WEB ? q.then(function (rows) { return rows[0] || null; }) : (q[0] || null);
      });
    });
    def(p + "rowsByEntity", function (entity, fields) { return ret(function () { return dbq(entity, "", fields, noNs); }); });
  });
  def("bulkQuery", function (queries) {
    return ret(function () {
      var out = {};
      var pending = [];
      Array.prototype.slice.call(queries || []).forEach(function (q) {
        var c = q.condition;
        if (c && typeof c.then === "function") throw new Error("The condition is a Promise. Call ConditionEnhancedBuilder.build() and pass its result.");
        var where = c && typeof c === "object" ? c.soqlString : c;
        var fields = q.selectedFields || (c && c.fieldNamesByObjectNames && c.fieldNamesByObjectNames[q.sObjectName]) || null;
        var r = dbq(q.sObjectName, where, fields, false);
        if (WEB) pending.push(r.then(function (rows) { out[q.uniqueRequestKey] = rows; }));
        else out[q.uniqueRequestKey] = r;
      });
      return WEB ? Promise.all(pending).then(function () { return out; }) : out;
    });
  });

  // ---- env, record, user, console ----
  var opts = CFG.env || {};
  function fmtLabel(key, def, args) {
    var s = String(def === undefined || def === null ? key : def);
    var list = Array.prototype.slice.call(args || []);
    list.forEach(function (a, i) { s = s.split("{" + i + "}").join(String(a)); });
    var n = 0;
    s = s.replace(/%@/g, function () { return n < list.length ? String(list[n++]) : "%@"; });
    return s;
  }
  g.env = {
    getOption: function (n) { return opts[n]; },
    setOption: function (n, v) { opts[n] = v; },
    log: function (m) { host("log", "log", String(m)); },
    formatCustomLabel: function (key, def, args) { host("note", "label"); return fmtLabel(key, def, args); }
  };
  g.db = db;
  var rec = makeRow(CFG.record, CFG.recordObject);
  if (CFG.contextData) {
    var ctx = CFG.contextData;
    Object.defineProperty(rec, "getContextData", { value: function () { return wrap(ctx); }, enumerable: false });
  }
  g.record = rec;
  g.user = makeRow(CFG.user, "User");

  function show(a) {
    if (typeof a === "string") return a;
    try { var j = JS(a); return j === undefined ? String(a) : j; } catch (e) { return String(a); }
  }
  function logger(level) { return function () { host("log", level, Array.prototype.slice.call(arguments).map(show).join(" ")); }; }
  g.console = { log: logger("log"), info: logger("log"), debug: logger("log"), warn: logger("warn"), error: logger("error") };

  // ---- entry ----
  function errInfo(e) {
    var m = e && e.message !== undefined ? String(e.message) : show(e);
    return { message: m, stack: e && e.stack ? String(e.stack) : "" };
  }
  function fail(e) { host("done", JS({ error: errInfo(e) })); }
  function finish(a, raw) {
    var leak = false;
    var seen = new WeakSet();
    (function scan(o, d) {
      if (o === null || typeof o !== "object" || d > 5 || seen.has(o)) return;
      seen.add(o);
      if (PXS.has(o)) { leak = true; return; }
      Object.keys(o).forEach(function (k) { scan(o[k], d + 1); });
    })(a, 0);
    var json;
    try { json = JS(a); } catch (e) { return fail(e); }
    var elTypes = Array.isArray(a) ? Array.prototype.map.call(a, function (x) { return x === null ? "null" : typeof x; }) : null;
    host("done", JS({ raw: raw, leak: leak, valueType: typeof a, elTypes: elTypes, valueJson: json === undefined ? null : json }));
  }
  Object.defineProperty(g, "__lscRun", {
    enumerable: false,
    value: function (fn) {
      var v;
      try { v = fn(); } catch (e) { return fail(e); }
      var thenable = function (x) { return x !== null && (typeof x === "object" || typeof x === "function") && typeof x.then === "function"; };
      var raw = {
        type: v === null ? "null" : typeof v,
        isArray: Array.isArray(v),
        thenable: thenable(v),
        elThenable: Array.isArray(v) ? Array.prototype.some.call(v, thenable) : false
      };
      Promise.resolve(v)
        .then(function (a) { return Array.isArray(a) ? Promise.all(Array.prototype.slice.call(a)) : a; })
        .then(function (a) { finish(a, raw); }, fail);
    }
  });

  [Object, Array, Function, String, Number, Boolean, Promise, Map, Set, RegExp, Error].forEach(function (C) {
    try { Object.freeze(C.prototype); } catch (e) { /* ignore */ }
  });
})`;
