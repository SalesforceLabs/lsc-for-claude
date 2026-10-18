import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFlexiPageOps } from "../../../src/studio/metadata/flexipage-ops.js";
import { liveFlexiPageOf } from "../../../src/studio/metadata/live.js";
import { parseXml } from "../../../src/studio/metadata/xml.js";
import { componentVerbs, locateItem, modelOf, targetOf, type PageDraft } from "../../../src-renderer/components/studio/flexipage-draft.js";
import type { PendingChange } from "../../../src-renderer/components/studio/changes.js";
import type { FlexiPageOp, LiveFlexiPage } from "../../../src-renderer/components/studio/types.js";

// Real pages from the demo org (nested tab facets on a record page, a Home page): every pair of verbs the preview offers
// must produce ops the server applies to the page's XML.
const PAGES = ["Inquiry_LSDO_All_Personas", "Home_LSDO_PH_FSR_LS_Comm_LS_KAM", "Account_LSDO_PH_FSR_KAM_MSL_HCO_HCP"];

describe.each(PAGES)("verbs on %s", (name) => {
  const root = parseXml(readFileSync(join(__dirname, `../../fixtures/metadata/${name}.flexipage-meta.xml`), "utf8"));
  const live: LiveFlexiPage = { ...liveFlexiPageOf(name, root), profiles: [], appDefaults: [], managed: false, production: false };
  const base = modelOf(live);
  const keys = base.regions.flatMap((r) => r.items.map((i) => i.key));

  const verbsFor = (pending: PendingChange[], key: string) => {
    const target = targetOf(name, base, pending);
    const d: PageDraft = { fullName: name, label: name, live, base, target } as unknown as PageDraft;
    const at = locateItem(target, key) ?? locateItem(base, key)!;
    return componentVerbs(d, key, key, at.region.items.map((i) => i.key), at.item.component === "flexipage:tab").filter((v) => v.run);
  };
  const opsOf = (pending: PendingChange[]) => ((pending[0]?.fix as { ops?: FlexiPageOp[] } | undefined)?.ops ?? []);

  it("applies every pair of verbs to the page's XML", () => {
    let pairs = 0;
    for (const a of keys) {
      for (const va of verbsFor([], a)) {
        const first = va.run!([]);
        for (const b of keys) {
          for (const vb of verbsFor(first, b)) {
            const second = vb.run!(first);
            expect(() => applyFlexiPageOps(root, opsOf(second)), `${a}:${va.id} then ${b}:${vb.id}`).not.toThrow();
            pairs++;
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });
});
