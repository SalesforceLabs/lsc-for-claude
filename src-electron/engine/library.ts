import { getDb, generateId, addColumn, ORG_COLUMNS, orgValues, rowOrg, type OrgColumns } from "./history.js";
import type { OrgRef } from "../orgs.js";

export interface LibraryItem {
  id: string;
  title: string;
  content: string;
  contentType: "response" | "code" | "diagram" | "table";
  svg?: string;
  sourceConversationId?: string;
  sourceConversationTitle?: string;
  /** The org the item came from — its own record, else its session's; null if neither is known. */
  org: OrgRef | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface LibraryRow extends OrgColumns {
  id: string;
  title: string;
  content: string;
  content_type: string;
  svg: string | null;
  source_conversation_id: string | null;
  conv_title: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: LibraryRow): LibraryItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    contentType: row.content_type as LibraryItem["contentType"],
    svg: row.svg ?? undefined,
    sourceConversationId: row.source_conversation_id ?? undefined,
    sourceConversationTitle: row.conv_title ?? undefined,
    org: rowOrg(row),
    tags: row.tags ? JSON.parse(row.tags) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let migrated = false;

function db() {
  const d = getDb();
  if (!migrated) {
    for (const column of ORG_COLUMNS) addColumn(d, "library_items", `${column} TEXT`);
    migrated = true;
  }
  return d;
}

/** Items carry their own org; older ones (and ones saved before their session was tied) take the session's. */
const SELECT_ITEMS = `SELECT l.id, l.title, l.content, l.content_type, l.svg, l.source_conversation_id, l.tags,
         l.created_at, l.updated_at, c.title as conv_title,
         COALESCE(l.org_username, c.org_username) as org_username,
         CASE WHEN l.org_username IS NOT NULL THEN l.org_label ELSE c.org_label END as org_label,
         CASE WHEN l.org_username IS NOT NULL THEN l.org_id ELSE c.org_id END as org_id,
         CASE WHEN l.org_username IS NOT NULL THEN l.org_instance_url ELSE c.org_instance_url END as org_instance_url
       FROM library_items l
       LEFT JOIN conversations c ON l.source_conversation_id = c.id`;

/** With `orgUsername`, that org's items plus those from no known org; without, every item. */
function orgFilter(orgUsername: string | undefined): { sql: string; params: string[] } {
  if (orgUsername === undefined) return { sql: "", params: [] };
  return {
    sql: "COALESCE(l.org_username, c.org_username) IS NULL OR COALESCE(l.org_username, c.org_username) = ? COLLATE NOCASE",
    params: [orgUsername],
  };
}

export function listLibraryItems(options: { orgUsername?: string; limit?: number } = {}): LibraryItem[] {
  const filter = orgFilter(options.orgUsername);
  const rows = db()
    .prepare(`${SELECT_ITEMS} ${filter.sql ? `WHERE ${filter.sql}` : ""} ORDER BY l.created_at DESC LIMIT ?`)
    .all(...filter.params, options.limit ?? 100) as LibraryRow[];
  return rows.map(rowToItem);
}

export function createLibraryItem(input: {
  title: string;
  content: string;
  contentType: LibraryItem["contentType"];
  svg?: string;
  sourceConversationId?: string;
  tags?: string[];
  /** The org it's saved under — its session's, else the current one. */
  org: OrgRef | null;
}): LibraryItem {
  const id = generateId();
  const now = new Date().toISOString();
  const tagsJson = input.tags ? JSON.stringify(input.tags) : null;

  db()
    .prepare(
      "INSERT INTO library_items (id, title, content, content_type, svg, source_conversation_id, tags, created_at, updated_at, org_username, org_label, org_id, org_instance_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(id, input.title, input.content, input.contentType, input.svg ?? null, input.sourceConversationId ?? null, tagsJson, now, now, ...orgValues(input.org));

  return {
    id,
    title: input.title,
    content: input.content,
    contentType: input.contentType,
    svg: input.svg,
    sourceConversationId: input.sourceConversationId,
    org: input.org,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function deleteLibraryItem(id: string): void {
  db().prepare("DELETE FROM library_items WHERE id = ?").run(id);
}

export function updateLibraryItem(
  id: string,
  updates: { title?: string; tags?: string[] }
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.title);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    values.push(JSON.stringify(updates.tags));
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  db()
    .prepare(`UPDATE library_items SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function searchLibraryItems(query: string, options: { orgUsername?: string } = {}): LibraryItem[] {
  const pattern = `%${query}%`;
  const filter = orgFilter(options.orgUsername);
  const rows = db()
    .prepare(
      `${SELECT_ITEMS}
       WHERE (l.title LIKE ? OR l.content LIKE ? OR l.tags LIKE ?) ${filter.sql ? `AND (${filter.sql})` : ""}
       ORDER BY l.created_at DESC LIMIT 100`
    )
    .all(pattern, pattern, pattern, ...filter.params) as LibraryRow[];
  return rows.map(rowToItem);
}
