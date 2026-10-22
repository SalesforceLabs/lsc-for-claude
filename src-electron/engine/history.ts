import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { app } from "electron";
import type { OrgRef } from "../orgs.js";

export interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** The org the session works in; tied on its first message and never changed. Null for sessions from before orgs were recorded. */
  org: OrgRef | null;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: string; // JSON-serialized
  createdAt: string;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbDir = path.join(app.getPath("userData"), "data");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(path.join(dbDir, "conversations.db"));
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      tool_calls TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

    -- Migration: add pinned column if missing
    CREATE TABLE IF NOT EXISTS _migration_check (id INTEGER);
    DROP TABLE _migration_check;
  `);

  // Add columns to existing tables (safe to run repeatedly)
  addColumn(db, "conversations", "pinned INTEGER NOT NULL DEFAULT 0");
  for (const column of ORG_COLUMNS) addColumn(db, "conversations", `${column} TEXT`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(org_username COLLATE NOCASE)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL,
      svg TEXT,
      source_conversation_id TEXT,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

/** Where a session or saved item records its org (an OrgRef). */
export const ORG_COLUMNS = ["org_username", "org_label", "org_id", "org_instance_url"] as const;

export function addColumn(d: Database.Database, table: string, definition: string): void {
  try {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch {
    // Column already exists — ignore
  }
}

export interface OrgColumns {
  org_username: string | null;
  org_label: string | null;
  org_id: string | null;
  org_instance_url: string | null;
}

export function rowOrg(row: OrgColumns): OrgRef | null {
  if (!row.org_username) return null;
  return {
    username: row.org_username,
    label: row.org_label || row.org_username,
    orgId: row.org_id ?? undefined,
    instanceUrl: row.org_instance_url ?? undefined,
  };
}

export const orgValues = (org: OrgRef | null | undefined) =>
  [org?.username ?? null, org?.label ?? null, org?.orgId ?? null, org?.instanceUrl ?? null] as const;

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Derive a short title from the first user message */
function deriveTitle(text: string): string {
  const clean = text.replace(/^\/lsc:\S+\s*/, "").trim();
  if (!clean) return text.slice(0, 60);
  return clean.length > 60 ? clean.slice(0, 57) + "..." : clean;
}

// --- Conversations ---

type ConversationRow = Omit<Conversation, "pinned" | "org"> & { pinned: number } & OrgColumns;

const CONVERSATION_COLUMNS =
  "id, title, pinned, created_at as createdAt, updated_at as updatedAt, org_username, org_label, org_id, org_instance_url";

function rowToConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    title: r.title,
    pinned: r.pinned === 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    org: rowOrg(r),
  };
}

/**
 * Sessions in the org whose connection is `orgUsername`, plus those not tied to an org yet
 * (they work in whichever org they continue in). Without a username, every session.
 */
export function listConversations(options: { orgUsername?: string; limit?: number } = {}): Conversation[] {
  const { orgUsername, limit = 50 } = options;
  if (orgUsername === undefined) return selectConversations("", [], limit);
  // Listed apart, so a long backlog of unlinked sessions doesn't push the org's own off the list.
  return [
    ...selectConversations("WHERE org_username = ? COLLATE NOCASE", [orgUsername], limit),
    ...selectConversations("WHERE org_username IS NULL", [], UNLINKED_LIMIT),
  ];
}

/** Enough to list every unlinked session in practice, so "Move all" and the count cover them all. */
const UNLINKED_LIMIT = 500;

function selectConversations(where: string, params: string[], limit: number): Conversation[] {
  const rows = getDb()
    .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations ${where} ORDER BY pinned DESC, updated_at DESC LIMIT ?`)
    .all(...params, limit) as ConversationRow[];
  return rows.map(rowToConversation);
}

/**
 * Sessions whose title or messages contain `query`, most recent first — in the org whose
 * connection is `orgUsername` (plus unlinked ones), or every org's without it.
 */
export function searchConversations(query: string, options: { orgUsername?: string; limit?: number } = {}): Conversation[] {
  const { orgUsername, limit = 50 } = options;
  const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const match = `(title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id AND m.text LIKE ? ESCAPE '\\'))`;
  const where = orgUsername === undefined ? `WHERE ${match}` : `WHERE ${match} AND (org_username IS NULL OR org_username = ? COLLATE NOCASE)`;
  const params = orgUsername === undefined ? [like, like] : [like, like, orgUsername];
  const rows = getDb()
    .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params, limit) as ConversationRow[];
  return rows.map(rowToConversation);
}

export function getConversation(id: string): Conversation | undefined {
  const row = getDb().prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`).get(id) as
    | ConversationRow
    | undefined;
  return row ? rowToConversation(row) : undefined;
}

export function createConversation(firstMessage: string, org: OrgRef | null): Conversation {
  const id = generateId();
  const title = deriveTitle(firstMessage);
  const now = new Date().toISOString();

  getDb()
    .prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at, org_username, org_label, org_id, org_instance_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(id, title, now, now, ...orgValues(org));

  return { id, title, pinned: false, createdAt: now, updatedAt: now, org };
}

/** The username sessions recorded for an alias, for finding a connection that's since been logged out. */
export function orgUsernameForLabel(label: string): string | undefined {
  const row = getDb()
    .prepare("SELECT org_username FROM conversations WHERE org_label = ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT 1")
    .get(label) as { org_username: string } | undefined;
  return row?.org_username;
}

/** Tie a session that has no org yet to `org`. A session already in an org keeps it. */
export function bindConversationOrg(id: string, org: OrgRef): void {
  getDb()
    .prepare(
      "UPDATE conversations SET org_username = ?, org_label = ?, org_id = ?, org_instance_url = ? WHERE id = ? AND org_username IS NULL"
    )
    .run(...orgValues(org), id);
}

/** Tie the given sessions that have no org yet to `org`; returns how many moved. */
export function bindConversationsOrg(ids: string[], org: OrgRef): number {
  const d = getDb();
  const stmt = d.prepare(
    "UPDATE conversations SET org_username = ?, org_label = ?, org_id = ?, org_instance_url = ? WHERE id = ? AND org_username IS NULL"
  );
  let moved = 0;
  d.transaction(() => {
    for (const id of ids) moved += stmt.run(...orgValues(org), id).changes;
  })();
  return moved;
}

export function updateConversationTitle(id: string, title: string): void {
  getDb()
    .prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title, id);
}

export function deleteConversation(id: string): void {
  const d = getDb();
  d.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  d.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export function touchConversation(id: string): void {
  getDb()
    .prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
    .run(id);
}

export function togglePinConversation(id: string): void {
  getDb()
    .prepare("UPDATE conversations SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?")
    .run(id);
}

// --- Messages ---

export function getMessages(conversationId: string): StoredMessage[] {
  return getDb()
    .prepare(
      "SELECT id, conversation_id as conversationId, role, text, tool_calls as toolCalls, created_at as createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
    )
    .all(conversationId) as StoredMessage[];
}

export function addMessage(
  conversationId: string,
  role: "user" | "assistant",
  text: string,
  toolCalls?: unknown[]
): StoredMessage {
  const id = generateId();
  const now = new Date().toISOString();
  const toolCallsJson = toolCalls ? JSON.stringify(toolCalls) : null;

  getDb()
    .prepare(
      "INSERT INTO messages (id, conversation_id, role, text, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, conversationId, role, text, toolCallsJson, now);

  touchConversation(conversationId);

  return {
    id,
    conversationId,
    role,
    text,
    toolCalls: toolCallsJson ?? undefined,
    createdAt: now,
  };
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
