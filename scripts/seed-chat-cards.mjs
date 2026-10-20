#!/usr/bin/env node
// Seed an isolated Roz user-data folder with sessions that show every chat card, for ui-shots.
//   ROZ_SHOTS_USER_DATA=/tmp/roz-cards node scripts/seed-chat-cards.mjs
// Never run it against the real user-data folder: it only writes under ROZ_SHOTS_USER_DATA.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.env.ROZ_SHOTS_USER_DATA;
if (!dir) throw new Error("set ROZ_SHOTS_USER_DATA to an isolated folder");
fs.mkdirSync(path.join(dir, "data"), { recursive: true });
const dbPath = path.join(dir, "data", "conversations.db");
fs.rmSync(dbPath, { force: true });

const ORG = { username: "admin@lsdo-260.org", label: "peter-lsc-260-trial", id: "00DHn000007duSEMAY", url: "https://trailsignup-18142fec8660f1.my.salesforce.com" };
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const stmts = [
  `CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), pinned INTEGER NOT NULL DEFAULT 0, org_username TEXT, org_label TEXT, org_id TEXT, org_instance_url TEXT);`,
  `CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, tool_calls TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);`,
];
let t = Date.parse("2026-10-20T09:00:00Z");
const stamp = () => new Date((t += 1000)).toISOString();
const conv = (id, title, messages) => {
  stmts.push(`INSERT INTO conversations (id,title,created_at,updated_at,org_username,org_label,org_id,org_instance_url) VALUES (${q(id)},${q(title)},${q(stamp())},${q(stamp())},${q(ORG.username)},${q(ORG.label)},${q(ORG.id)},${q(ORG.url)});`);
  messages.forEach(([role, text, tools], i) =>
    stmts.push(`INSERT INTO messages (id,conversation_id,role,text,tool_calls,created_at) VALUES (${q(`${id}-${i}`)},${q(id)},${q(role)},${q(text)},${tools ? q(JSON.stringify(tools)) : "NULL"},${q(stamp())});`)
  );
};
const tool = (id, name, result, extra = {}) => ({ id, name, input: {}, result: typeof result === "string" ? result : JSON.stringify(result), status: "success", collapsed: true, ...extra });

const item = (o) => ({ kind: "cause", area: "Mobile sync", byDesign: false, notApplicable: false, steps: [], records: [], failedRules: [], matched: "sync", score: 8, ...o });
const diagnosis = {
  checkedOrg: ORG.label,
  items: [
    item({ id: "c1", title: "Account DB Schema record has no profile assigned", status: "found", why: "Reps whose profile isn't assigned to the Account DB Schema record download no accounts, so the iPad shows an empty list after the first sync.", steps: ["Open Admin Console > Mobile > DB Schema.", "Open the Account record and add the rep profile under Profiles.", "Publish to iPad so the new cache is generated."], uiPath: "Admin Console > Mobile > DB Schema", records: ["Account (DbSchema:Account_Default)", "Contact (DbSchema:Contact_Default)", "ProviderVisit (DbSchema:Visit_Default)"] }),
    item({ id: "c2", title: "Metadata cache older than the last Admin Console change", status: "found", why: "The iPad downloads the last published cache.", steps: ["Publish to iPad for the affected profiles."], message: "Cache from 3 days ago" }),
    item({ id: "c3", title: "Delta date field missing on Task", status: "not-found" }),
    item({ id: "c4", title: "Sync filter longer than 4,000 characters", status: "unchecked", message: "the query timed out" }),
    item({ id: "c5", title: "Sync takes longer on cellular networks", status: "found", byDesign: true, why: "Initial sync scales with the number of accounts in the rep's territories." }),
  ],
};
const noItems = { items: [], checkedOrg: ORG.label };
const chk = (id, stage, title, status, severity, extra = {}) => ({ id, stage, title, status, severity, source: "studio", ...extra });
const trace = {
  org: ORG.label, collectedAt: "2026-10-20T09:00:00Z", userId: "005Hn00000AAA01", userName: "Carmen Ortiz", profile: "LSC Field Rep", featureId: "visit",
  checks: [
    chk("user.enabled.active", "enabled", "User is active", "pass", "error", { detail: "Active" }),
    chk("user.access.psl", "access", "Has the Life Sciences Commercial license", "pass", "error"),
    chk("user.access.permset", "access", "Holds the LSC Field Rep permission set", "fail", "error", {
      detail: "Not assigned",
      why: "Without the permission set Carmen can't open Visits on the iPad.",
      steps: ["Setup > Users > Carmen Ortiz > Permission Set Assignments.", "Add LSC Field Rep."],
      uiPath: "Setup > Users",
      fixes: [{ kind: "assignPsl", label: "Give Carmen Ortiz the LSC license", userId: "005Hn00000AAA01", userName: "Carmen Ortiz", pslId: "0PLxx", pslLabel: "Life Sciences Commercial" }],
    }),
    chk("user.data.territory", "data", "In an active territory", "pass", "warning", { detail: "2 territories" }),
    chk("user.mobile.cache", "mobile", "Metadata cache is current", "unknown", "warning", { detail: "Couldn't read the cache" }),
  ],
};
const matches = { message: "Several users have a similar name.", matches: [
  { id: "005A", name: "Carmen Ortiz", username: "carmen.ortiz@lsdo-260.org", profile: "LSC Field Rep" },
  { id: "005B", name: "Carmen Ortega", username: "carmen.ortega@lsdo-260.org", profile: "LSC Manager" },
  { id: "005C", name: "Carmen Olivera Santos-Fernandez-Montgomery", username: "carmen.olivera.santos.fernandez@very-long-company-domain.example.org", profile: "LSC Field Rep with a long name" },
] };
const queued = { status: "queued", changes: ["Give Carmen Ortiz the LSC license", "Activate Account DB Schema record"], message: "Waiting in Studio" };

conv("c-diag", "Cards: diagnosis", [
  ["user", "Reps see an empty account list after sync. Why?"],
  ["assistant", "I matched this against the known causes.", [tool("t1", "diagnose_lsc_issue", diagnosis)]],
  ["user", "And this error: widget flickers"],
  ["assistant", "Nothing matched.", [tool("t2", "diagnose_lsc_issue", noItems)]],
]);
conv("c-user", "Cards: user check", [
  ["user", "Why can't Carmen see visits?"],
  ["assistant", "Here is the chain for Carmen.", [tool("t3", "check_user_access", trace)]],
  ["user", "Check Carmen"],
  ["assistant", "More than one match.", [tool("t4", "check_user_access", matches)]],
]);
conv("c-queued", "Cards: queued and group", [
  ["user", "Fix it"],
  ["assistant", "I queued both changes.", [tool("t5", "update_lsc_action", queued)]],
  ["user", "Look into the sync"],
  ["assistant", "Done looking.", [
    tool("g1", "list_db_schema", "12 records"),
    tool("g2", "check_territory_config", "ok"),
    tool("g3", "get_lsc_troubleshooting", "..."),
    tool("g4", "diagnose_lsc_issue", diagnosis),
  ]],
  ["user", "Write something"],
  ["assistant", "Updating the account.", [{ id: "w1", name: "update_record", input: { sobject: "Account", id: "001xx0000012345", fields: { Name: "Acme", Phone: "555-0100" } }, status: "running", collapsed: false }]],
]);
execFileSync("sqlite3", [dbPath], { input: stmts.join("\n") });
console.log("seeded", dbPath);
