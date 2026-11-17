/**
 * Medical Insights tab (InsightsCoordinator, lifesciences-ios OCE/Classes/Insights): the feed of the insights the
 * device syncs. Reads MedicalInsight filtered by its DB Schema scope, as the viewer; tab and sort filtering happen
 * in the renderer from the fields shipped here. Read-only.
 */

import { queryByIds, queryResult, type Row } from "../../helpers.js";
import { softFail, type ScreenContext } from "../context.js";
import { feedPages, splitStatuses, subtitleOf, tagNames, type InsightsPage } from "./logic.js";

export interface PublishedInsightItem {
  id: string;
  title: string;
  subtitle: string;
  fullSubtitle: string;
  loggedBy: string;
  /** Created date as the card prints it (medium date, short time, the viewer's zone). */
  date: string;
  createdDate: string;
  lastModifiedDate: string;
  lastUpvotedDate: string | null;
  createdById: string;
  ownerId: string;
  upvoteCount: number;
  childCount: number;
  tags: string[];
  products: string[];
  status: string | null;
  ownedByMe: boolean;
}

export interface PublishedInsights {
  items: PublishedInsightItem[];
  pages: InsightsPage[];
  /** The viewer's now, for the Latest and Trending 30-day cutoff. */
  now: string;
  hideName: boolean;
  hideTags: boolean;
  hideProducts: boolean;
  /** Admin Console statuses: Final, Draft and the In Progress ones. */
  finalStatus: string | null;
  draftStatus: string | null;
  inProgressStatuses: string[];
  /** The viewer's user Id, for My Insights and My Drafts. */
  viewerId: string;
  unavailable?: string[];
}

const ITEM_LIMIT = 300;

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number => (typeof v === "number" && v > 0 ? Math.floor(v) : 0);
const field = (row: Row | undefined, key: string): unknown =>
  row?.[Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase()) ?? key];
const flag = (row: Row | undefined, key: string): boolean => {
  const v = field(row, key);
  return v === true || v === "true";
};

export async function collectInsights(ctx: ScreenContext): Promise<PublishedInsights | undefined> {
  const scope = ctx.scope("MedicalInsight");
  if (scope === undefined || scope === null) return undefined;
  const { org } = ctx;
  const where = ["ParentMedicalInsightId = null", scope ? `(${scope})` : ""]
    .filter(Boolean)
    .join(" AND ");
  const base =
    "Id, Name, Content, TopicNames, UpvoteCount, ChildMedicalInsightCount, CreatedDate, LastModifiedDate, LastUpvotedDate, CreatedById, OwnerId";
  const read = (fields: string) =>
    queryResult(
      `SELECT ${fields} FROM MedicalInsight WHERE ${where} ORDER BY CreatedDate DESC LIMIT ${ITEM_LIMIT}`,
      org,
      false,
      {
        allowTruncated: true,
      }
    );
  // Status is not on every org's MedicalInsight; the device selects it only when the column exists.
  let hasStatus = true;
  const res = await read(`${base}, Status`).catch(async (e) => {
    hasStatus = false;
    try {
      return await read(base);
    } catch (e2) {
      softFail(ctx, "Medical Insights", null)(e2 ?? e);
      return null;
    }
  });
  if (!res) return undefined;
  const rows = res.records as Row[];
  if (res.totalSize > rows.length)
    ctx.note(`Medical Insights shows the newest ${rows.length} of ${res.totalSize} insights.`);

  const cfg = await ctx.config(["InsightSettings"]).catch(() => ({}) as Record<string, Row>);
  const settings = cfg.InsightSettings;
  const draftStatus = s(field(settings, "DraftStatus")).trim() || null;
  const finalStatus = s(field(settings, "FinalStatus")).trim() || null;
  const inProgressStatuses = splitStatuses(field(settings, "InProgressStatuses"));

  const ids = rows.map((r) => s(r.Id));
  const userIds = [...new Set(rows.map((r) => s(r.CreatedById)).filter(Boolean))];
  const [users, productRows] = await Promise.all([
    queryByIds("Id, Name", "User", "Id", userIds, org).catch(
      softFail(ctx, "Medical Insights people", [] as Row[])
    ),
    queryByIds(
      "MedicalInsightId, Product.Name, DisplayName",
      "MedicalInsightProduct",
      "MedicalInsightId",
      ids,
      org
    ).catch(softFail(ctx, "Medical Insight products", [] as Row[])),
  ]);
  const userName = new Map(users.map((u) => [s(u.Id), s(u.Name)]));
  const products = new Map<string, string[]>();
  for (const p of productRows) {
    const name = s(p.DisplayName) || s(field(p.Product as Row | undefined, "Name"));
    if (!name) continue;
    const list = products.get(s(p.MedicalInsightId)) ?? [];
    list.push(name);
    products.set(s(p.MedicalInsightId), list);
  }

  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(ctx.format.locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: ctx.format.timeZone,
      }).format(d);
    } catch {
      return d.toISOString();
    }
  };
  const items: PublishedInsightItem[] = rows
    .filter((r) => s(r.Name))
    .map((r) => {
      const full = s(r.Content);
      const status = hasStatus ? s(r.Status).trim() || null : null;
      return {
        id: s(r.Id),
        title: s(r.Name),
        subtitle: subtitleOf(full),
        fullSubtitle: full,
        loggedBy: userName.get(s(r.CreatedById)) ?? "",
        date: fmt(s(r.CreatedDate)),
        createdDate: s(r.CreatedDate),
        lastModifiedDate: s(r.LastModifiedDate),
        lastUpvotedDate: s(r.LastUpvotedDate) || null,
        createdById: s(r.CreatedById),
        ownerId: s(r.OwnerId),
        upvoteCount: n(r.UpvoteCount),
        childCount: n(r.ChildMedicalInsightCount),
        tags: tagNames(r.TopicNames),
        products: products.get(s(r.Id)) ?? [],
        status,
        ownedByMe: s(r.OwnerId) === ctx.userId || s(r.CreatedById) === ctx.userId,
      };
    });

  const unavailable = [
    "Which insights you have liked, the Filters button (subjects) and who an insight is shared with aren't read; likes show as not liked.",
  ];
  if (!hasStatus && (draftStatus || inProgressStatuses.length))
    unavailable.push(
      "This org's Medical Insight has no Status field, so the draft and in-progress tabs are empty."
    );
  return {
    items,
    pages: feedPages(draftStatus, inProgressStatuses),
    now: new Date().toISOString(),
    hideName: flag(settings, "HideNameFieldFromInsightFeedView"),
    hideTags: flag(settings, "HideTagsFromInsightFeedCard"),
    hideProducts: flag(settings, "HideProductsFromInsightFeedCard"),
    finalStatus,
    draftStatus,
    inProgressStatuses,
    viewerId: ctx.userId,
    unavailable,
  };
}
