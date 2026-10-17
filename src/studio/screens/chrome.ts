/** The app chrome's data: the bell's Alerts modal (AppAlert) and the profile sheet's Synced / Territory / username lines. */

import { inList, query, type Row } from "../helpers.js";
import type { ScreenContext } from "./context.js";
import { actionTitle, configRecords, supportedAction } from "./fabs.js";

/** OCEDBNotificationType; the pill a type belongs to (NotificationViewController). */
export type AlertPill = "alerts" | "recommendations" | "guidedActions";

export interface PublishedAlert {
  id: string;
  /** Subject. */
  title: string;
  /** The message HTML: `<a>` links kept, nothing else. From AdditionalMessage's `message`, else Message. */
  body: string;
  /** "Sep 20 • 7:59 AM" (NotificationItemViewModel.startTimeValue). */
  when: string;
  pill: AlertPill;
}

/** One entry of a list card's ••• menu (a Search-location quick action). */
export interface PublishedCardAction {
  name: string;
  label: string;
  /** Record type developer names it is limited to; empty = every record type. */
  recordTypes: string[];
}

export interface PublishedChrome {
  /**
   * The ••• menu of an Accounts list card, before the per-account record type filter
   * (AccountListDataFetcher.updateConfigs: OCEDBQuickActionModel.fetch(forLocation: .search), by SortOrder).
   */
  cardActions: PublishedCardAction[];
  /** The alerts the viewer's device lists, newest first. */
  alerts: PublishedAlert[];
  profile: {
    /** UserProfile.userName: the sign-in name, shown under the role. */
    username: string;
    /** The first territory in the active model, which the app selects by default. */
    territory: string | null;
    /** "Oct 17, 2026 at 1:04 PM": the viewer's last sync start, from DeviceSyncSummary (null when it never uploaded one). */
    synced: string | null;
  };
}

export interface AlertRow {
  id: string;
  subject: string;
  message: string | null;
  additional: string | null;
  type: string | null;
  silent: boolean;
  effective: string | null;
  validUntil: string | null;
  contextType: string | null;
  contextName: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** NotificationSQLBuilder.typeCondition with the Alerts pill's type: Notification or no type; the other pills match their type; Announcements are never listed. */
export function alertPill(type: string | null): AlertPill | null {
  if (type === null || type === "" || type === "Notification") return "alerts";
  if (type === "Recommendation") return "recommendations";
  if (type === "GuidedAction") return "guidedActions";
  return null;
}

/**
 * NotificationSQLBuilder.buildAppAlertQuery for the Home context: not silent,
 * started before now, not ended, and shown on every tab (context Global or none).
 */
export function isAlertShown(a: AlertRow, now: Date): boolean {
  if (a.silent) return false;
  if (!a.effective || new Date(a.effective) >= now) return false;
  if (a.validUntil && new Date(a.validUntil) <= now) return false;
  if (alertPill(a.type) === null) return false;
  return !a.contextType || a.contextType.toLowerCase() === "global" || !a.contextName;
}

/** AdvancedMessageLinkParser: keep `<a href>` links, escape everything else. */
export function safeHtml(html: string): string {
  const out: string[] = [];
  let last = 0;
  for (const m of html.matchAll(/<a\s+[^>]*href=\\?["']([^"'\\]*)\\?["'][^>]*>(.*?)<\/a>/gis)) {
    out.push(esc(html.slice(last, m.index)), `<a href="${esc(m[1])}">${esc(m[2])}</a>`);
    last = m.index + m[0].length;
  }
  out.push(esc(html.slice(last)));
  return out.join("");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The alert text: the AdditionalMessage JSON's `message`, else the Message field. */
export function alertBody(additional: string | null, message: string | null): string {
  if (additional) {
    try {
      const m = (JSON.parse(additional) as { message?: unknown }).message;
      if (typeof m === "string") return safeHtml(m);
    } catch {
      // Not JSON: the app falls back to the plain message.
    }
  }
  return safeHtml(message ?? "");
}

/** iOS 17+ puts a narrow no-break space before AM/PM; ICU in older Node builds uses a plain one. */
const narrow = (t: string) => t.replace(/ (AM|PM)$/i, "\u202f$1");

const dayKey = (d: Date, tz: string) => d.toLocaleDateString("en-CA", { timeZone: tz });

/** NotificationItemViewModel.startTimeValue: Today / Yesterday • time, "EEEE, time" within a week, else "MMM d • time" (user time zone). */
export function alertWhen(effective: string | null, now: Date, fmt: { timeZone: string; locale: string }): string {
  const { timeZone, locale } = fmt;
  const time = (d: Date) => narrow(d.toLocaleTimeString(locale, { timeZone, hour: "numeric", minute: "2-digit" }));
  if (!effective) return time(now);
  const d = new Date(effective);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 7) {
    const today = dayKey(now, timeZone);
    const yesterday = dayKey(new Date(now.getTime() - 86_400_000), timeZone);
    const key = dayKey(d, timeZone);
    if (key === yesterday) return `Yesterday • ${time(d)}`;
    if (key === today) return `Today • ${time(d)}`;
    return `${d.toLocaleDateString(locale, { timeZone, weekday: "long" })}, ${time(d)}`;
  }
  return `${d.toLocaleDateString(locale, { timeZone, month: "short", day: "numeric" })} • ${time(d)}`;
}

/** Date.sfString(dateStyle: .medium, timeStyle: .short): "Oct 17, 2026 at 1:04 PM". */
export function syncedLabel(iso: string, fmt: { timeZone: string; locale: string }): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(fmt.locale, { timeZone: fmt.timeZone, month: "short", day: "numeric", year: "numeric" });
  const time = narrow(d.toLocaleTimeString(fmt.locale, { timeZone: fmt.timeZone, hour: "numeric", minute: "2-digit" }));
  return `${date} at ${time}`;
}

function toRow(r: Row): AlertRow {
  return {
    id: str(r.Id),
    subject: str(r.Subject),
    message: r.Message == null ? null : str(r.Message),
    additional: r.AdditionalMessage == null ? null : str(r.AdditionalMessage),
    type: r.Type == null ? null : str(r.Type),
    silent: r.IsSilent === true,
    effective: r.EffectiveDate == null ? null : str(r.EffectiveDate),
    validUntil: r.ValidUntilDate == null ? null : str(r.ValidUntilDate),
    contextType: r.DisplayContextType == null ? null : str(r.DisplayContextType),
    contextName: r.DisplayContextName == null ? null : str(r.DisplayContextName),
  };
}

/** The AppAlerts the viewer's device has: those the viewer can read (the sync's sharing scope), then the app's date, type and context filters. */
async function collectAlerts(ctx: ScreenContext, now: Date): Promise<PublishedAlert[]> {
  const iso = now.toISOString();
  const rows = (
    await query(
      `SELECT Id, Subject, Message, AdditionalMessage, Type, IsSilent, EffectiveDate, ValidUntilDate, DisplayContextType, DisplayContextName FROM AppAlert WHERE EffectiveDate < ${iso} AND (ValidUntilDate = null OR ValidUntilDate > ${iso}) ORDER BY EffectiveDate DESC LIMIT 2000`,
      ctx.org
    )
  )
    .map(toRow)
    .filter((a) => isAlertShown(a, now));
  const readable = new Set<string>();
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map((a) => a.id);
    const access = await query(`SELECT RecordId FROM UserRecordAccess WHERE UserId = '${ctx.userId}' AND HasReadAccess = true AND RecordId IN (${inList(ids)})`, ctx.org);
    for (const r of access) readable.add(str(r.RecordId));
  }
  return rows
    .filter((a) => readable.has(a.id))
    .map((a) => ({ id: a.id, title: a.subject, body: alertBody(a.additional, a.message), when: alertWhen(a.effective, now, ctx.format), pill: alertPill(a.type) as AlertPill }));
}

/** The latest sync the viewer's device uploaded a summary for that downloaded data (DownloadStart is the app's last-sync time). */
async function lastSync(ctx: ScreenContext): Promise<string | null> {
  const rows = await query(
    `SELECT DownloadStart FROM DeviceSyncSummary WHERE CreatedById = '${ctx.userId}' AND DownloadEnd != null AND DownloadStart != null ORDER BY CreatedDate DESC LIMIT 1`,
    ctx.org
  );
  const start = rows[0]?.DownloadStart;
  return typeof start === "string" ? start : null;
}

interface SearchQuickAction {
  label: string;
  actionName: string;
  location: string;
  profiles: string;
  recordTypes: string;
  sortOrder: number;
}

/**
 * OCEDBQuickActionModel.fetch(forLocation: .search): the Search-location quick actions whose Profiles name the viewer's
 * profile (the permission-set branch needs a setting the CLI can't read, so it is left out), by SortOrder; the card
 * keeps those SFActionFactory builds an action for, titled by OCEDBQuickActionModel.localizedLabel(for: actionName).
 */
export function searchCardActions(all: SearchQuickAction[], profile: string): PublishedCardAction[] {
  return all
    .filter((a) => a.location.toLowerCase() === "search" && a.profiles.split(";").includes(profile) && supportedAction(a.actionName))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((a) => ({ name: a.actionName, label: actionTitle(a.actionName) ?? a.label, recordTypes: a.recordTypes.split(";").filter(Boolean) }));
}

async function collectCardActions(ctx: ScreenContext): Promise<PublishedCardAction[]> {
  const rows = await configRecords("QuickAction", ctx.org);
  return searchCardActions(
    rows.map((r) => ({
      label: r.label,
      actionName: str(r.fields.ActionName),
      location: str(r.fields.Location),
      profiles: str(r.fields.Profiles),
      // An unset multi-picklist comes back as boolean false from the field-value coalescing.
      recordTypes: typeof r.fields.RecordTypes === "string" ? r.fields.RecordTypes : "",
      sortOrder: Number(r.fields.SortOrder ?? 0),
    })),
    ctx.core.profile
  );
}

export async function collectChrome(ctx: ScreenContext): Promise<PublishedChrome> {
  const now = new Date();
  const [alerts, user, sync, cardActions] = await Promise.all([
    collectAlerts(ctx, now).catch(() => []),
    query(`SELECT Username FROM User WHERE Id = '${ctx.userId}'`, ctx.org).catch(() => []),
    lastSync(ctx).catch(() => null),
    collectCardActions(ctx).catch(() => []),
  ]);
  return {
    cardActions,
    alerts,
    profile: {
      username: str(user[0]?.Username),
      territory: ctx.territories[0]?.name ?? null,
      synced: sync ? syncedLabel(sync, ctx.format) : null,
    },
  };
}
