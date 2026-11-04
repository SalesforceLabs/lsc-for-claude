import { useVisit } from "../draft";
import { CardOptions } from "./CardOptions";
import { useVisitSections } from "./useSections";
import "./sections.css";

/**
 * The sidebar: one card per section, each a picker that opens in place (one at a time, none on a new
 * visit). A card that can't take anything is shown collapsed and disabled.
 */
export function VisitSidebar({ organisation }: { organisation?: boolean }) {
  const { draft, update } = useVisit();
  const { data, sections, accountId } = useVisitSections(organisation);
  const cards = sections.filter((s) => s.menu);
  const open = cards.some((s) => s.key === draft.openSection && !s.dimmed)
    ? draft.openSection
    : undefined;
  return (
    <div className="studio-ipad-act-side">
      {cards.map((s) => {
        const count = draft.rows[s.object]?.length ?? 0;
        const isOpen = s.key === open;
        const toggle = () => !s.dimmed && update({ openSection: isOpen ? undefined : s.key });
        return (
          <div key={s.key} className={`studio-ipad-vs-cardwrap${isOpen ? " open" : ""}`}>
            <div
              role="button"
              tabIndex={s.dimmed ? -1 : 0}
              aria-expanded={isOpen}
              aria-disabled={s.dimmed || undefined}
              title={s.dimmedWhy}
              className={`studio-ipad-act-card studio-ipad-vs-card${s.dimmed ? " off" : ""}${isOpen ? " open" : ""}`}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") toggle();
              }}
            >
              <span className={`studio-ipad-act-chev${isOpen ? " down" : ""}`}>›</span>
              <span className="studio-ipad-act-cardl">{s.title}</span>
              {count > 0 && <span className="studio-ipad-vs-count">{count}</span>}
            </div>
            {isOpen && <CardOptions section={s} data={data} accountId={accountId} />}
          </div>
        );
      })}
    </div>
  );
}
