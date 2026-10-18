/**
 * The Account Ratings tab's layout, read like CustomerRatings reads it from its local tables
 * (OCEDBRatingLayoutItemModel.fetch): the PrvdClassificationLayout whose DeveloperName is the
 * flexipage's `layoutName`, its active PrvdClsfnLayoutAttribute items, and each item's
 * PrvdClsfnAttrDefinition (label, sobject, field). Read-only SOQL; null when the org does not expose
 * those entities to the API (they are synced to the device through its DB Schema, not always queryable).
 */

import { inList, query, type Row } from "../helpers.js";
import type { ScreenContext } from "./context.js";

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const obj = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

export interface RatingItem {
  /** elementlabel of the rating definition. */
  label: string;
  /** The sobject the rating reads (`Account`, `ProviderAcctTerritoryInfo`, an account-territory product entity…). */
  sobject: string;
  field: string;
  /** Doughnut, Continuum, Number, Checkbox, Date, … (displaytype). */
  displayType: string;
  row: number;
  column: number;
}

export async function readRatingLayout(ctx: ScreenContext, layoutName: string): Promise<RatingItem[] | null> {
  if (!/^[A-Za-z0-9_]+$/.test(layoutName)) return null;
  try {
    const layouts = await query(`SELECT Id FROM PrvdClassificationLayout WHERE DeveloperName = '${layoutName}'`, ctx.org);
    const id = str(layouts[0]?.Id);
    if (!id) return null;
    const items = await query(
      `SELECT PrvdClsfnAttrDefinitionId, RowNumber, ColumnNumber FROM PrvdClsfnLayoutAttribute WHERE PrvdClassificationLayoutId = '${id}' AND IsActive = true`,
      ctx.org
    );
    const defIds = [...new Set(items.map((i) => str(i.PrvdClsfnAttrDefinitionId)).filter(Boolean))];
    if (!defIds.length) return [];
    const defs = new Map(
      (await query(`SELECT Id, ElementLabel, ClassificationType, FieldApiName, DisplayType, IsActive FROM PrvdClsfnAttrDefinition WHERE Id IN (${inList(defIds)})`, ctx.org)).map((d) => [str(d.Id), d] as const)
    );
    return items
      .map((i) => ({ item: i, def: obj(defs.get(str(i.PrvdClsfnAttrDefinitionId))) }))
      .filter(({ def }) => str(def.FieldApiName) && def.IsActive !== false)
      .map(({ item, def }) => ({
        label: str(def.ElementLabel),
        sobject: str(def.ClassificationType),
        field: str(def.FieldApiName),
        displayType: str(def.DisplayType),
        row: Number(item.RowNumber) || 0,
        column: Number(item.ColumnNumber) || 0,
      }))
      .sort((a, b) => a.row - b.row || a.column - b.column);
  } catch {
    return null;
  }
}
