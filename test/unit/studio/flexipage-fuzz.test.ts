import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFlexiPageOps } from "../../../src/studio/metadata/flexipage-ops.js";
import { liveFlexiPageOf } from "../../../src/studio/metadata/live.js";
import { cloneNode, parseXml, serializeNode } from "../../../src/studio/metadata/xml.js";
import { componentVerbs, diffOps, modelOf, targetOf, locateItem, insertComponent, propertyEdits, removedItems, reinsertComponent, type PageDraft } from "../../../src-renderer/components/studio/flexipage-draft.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { FlexiPageOp, LiveFlexiPage } from "../../../src-renderer/components/studio/types.js";

const FULL = "Inquiry_LSDO_All_Personas";
const root = parseXml(readFileSync(join(__dirname, "../../fixtures/metadata/Inquiry_LSDO_All_Personas.flexipage-meta.xml"), "utf8"));
const mk = (r: typeof root): LiveFlexiPage => ({ ...liveFlexiPageOf(FULL, r), profiles: ["x"], appDefaults: [], managed: false, production: false });
const live = mk(root);
const base = modelOf(live);
const queued = (p: PendingChange[]): FlexiPageOp[] => {
  const f = p.find((x) => x.fix.kind === "editMetadata")?.fix;
  return f && f.kind === "editMetadata" ? (f.ops as FlexiPageOp[]) : [];
};

describe("Lightning page draft ops, random verb sequences on a tabbed page", () => {
  it("random verbs always apply on the server", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let run = 0; run < 300; run++) {
      let pending: PendingChange[] = [];
      for (let s = 0; s < 10; s++) {
        const target = targetOf(FULL, base, pending);
        const d: PageDraft = { fullName: FULL, label: live.label, live, base, target, aligned: new Map() };
        const keys = [...new Set([...base.regions.flatMap((r) => r.items.map((i) => i.key))])];
        const key = keys[rnd(keys.length)];
        const where = locateItem(target, key) ?? locateItem(base, key)!;
        const tab = where.item.component === "flexipage:tab";
        const shown = where.region.items.map((i) => i.key);
        const vs: { id: string; run?: (p: PendingChange[]) => PendingChange[] }[] = componentVerbs(d, key, key, shown, tab).filter((v) => v.run);
        const regs = target.regions.filter((r) => !r.facet || true);
        const rg = regs[rnd(regs.length)];
        vs.push({ id: `insert@${rg.name}`, run: (p) => insertComponent(d, rg.name, rg.items.length ? rg.items[rnd(rg.items.length)].key : null, "flexipage:richText", [{ name: "richTextValue", value: "hi" }], p) });
        const pe = propertyEdits(d, key).filter((e) => !e.readOnly);
        if (pe.length) { const e = pe[rnd(pe.length)]; vs.push({ id: `prop ${e.property}`, run: (p) => e.set(e.property === "title" ? "T" + rnd(5) : e.def.type === "Integer" ? String(1 + rnd(9)) : "v" + rnd(3), p) ?? p }); }
        const rm = removedItems(d);
        if (rm.length) { const r = rm[rnd(rm.length)]; vs.push({ id: `reinsert ${r.key}`, run: (p) => reinsertComponent(d, r.key, r.region, null, p) ?? p }); }
        const v = vs[rnd(vs.length)];
        const trail = `run${run} step${s} ${v.id} ${key}`;
        pending = v.run!(pending);
        const ops = queued(pending);
        expect(ops, trail).toEqual(diffOps(base, targetOf(FULL, base, pending)));
        try {
          const r = applyFlexiPageOps(cloneNode(root), ops);
          const back = applyFlexiPageOps(r.root, r.inverse).root;
          expect(serializeNode(back), trail + " undo").toEqual(serializeNode(root));
        } catch (e) { throw new Error(trail + ": " + (e as Error).message); }
      }
    }
  });
});
