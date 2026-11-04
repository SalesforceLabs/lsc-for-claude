import React from "react";
import type { PublishedIpad, PublishedLayout, RecordFieldSpec } from "./published-types";
import { autoNumber, picklistStart } from "./ipad-visit-form";
import { IpadStatusBar } from "./IpadChrome";

/** Pieces the iPad preview's sheets share: nav bars, form controls, layout sections drawn as a create form. */

export interface SheetContext {
  snapshot: PublishedIpad;
  /** The record page the menu belongs to; null on Home. */
  record: { id: string; object: string; title: string } | null;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

/** A labeled note for the parts of a screen the preview can't read. */
export function Note({ children }: { children: React.ReactNode }) {
  return <div className="studio-ipad-act-note">{children}</div>;
}

export function Backdrop({
  onClose,
  children,
  className = "",
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="studio-ipad-act-backdrop" onClick={onClose}>
      <div
        className={`studio-ipad-act-sheet ${className}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}

export function NavBar({
  left,
  title,
  right,
  plain,
}: {
  left?: React.ReactNode;
  title: React.ReactNode;
  right?: React.ReactNode;
  plain?: boolean;
}) {
  return (
    <div className={`studio-ipad-act-nav${plain ? " plain" : ""}`}>
      <div className="studio-ipad-act-nav-l">{left}</div>
      <div className="studio-ipad-act-nav-t">{title}</div>
      <div className="studio-ipad-act-nav-r">{right}</div>
    </div>
  );
}

export function Full({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`studio-ipad-act-full ${className}`} role="dialog">
      <IpadStatusBar />
      {children}
    </div>
  );
}

export const linkBtn = (label: string, onClick?: () => void, disabled = false) => (
  <button type="button" className="studio-ipad-act-link" disabled={disabled} onClick={onClick}>
    {label}
  </button>
);

// ── Form fields (the record view's layout items, as a create form) ───────────

export const Caret = () => (
  <svg
    className="studio-ipad-act-caret"
    width="14"
    height="8"
    viewBox="0 0 14 8"
    aria-hidden="true"
  >
    <path d="M0 0h14L7 8z" fill="#555" />
  </svg>
);

export const Magnifier = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="8.5" cy="8.5" r="6" fill="none" stroke="#555" strokeWidth="1.6" />
    <path d="m13 13 5 5" stroke="#555" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export function Control({
  spec,
  value,
  tall,
}: {
  spec: RecordFieldSpec;
  value?: string;
  tall?: boolean;
}) {
  const t = spec.type;
  if (
    spec.readOnly ||
    /^Owner/.test(spec.name) ||
    t === "masterdetail" ||
    /^(autonumber|calculated|summary)$/.test(t)
  ) {
    return (
      <div className="studio-ipad-act-static">
        {value ?? (t === "masterdetail" ? "Assigned on save" : "")}
      </div>
    );
  }
  if (t === "boolean") return <span className="studio-ipad-act-toggle" aria-label={spec.label} />;
  if (t === "picklist" || t === "multipicklist" || t === "combobox") {
    return (
      <div className="studio-ipad-act-box">
        <span>{value ?? ""}</span>
        <Caret />
      </div>
    );
  }
  if (t === "datetime" || t === "date" || t === "time") {
    return (
      <div className="studio-ipad-act-box">
        <span>{value ?? ""}</span>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="#555" strokeWidth="1.4" />
          <path d="M10 5v5l3 2" fill="none" stroke="#555" strokeWidth="1.4" />
        </svg>
      </div>
    );
  }
  if (t === "lookup" || t === "reference" || t === "hierarchy") {
    return (
      <div className={`studio-ipad-act-box${tall ? " tall" : ""}`}>
        <span className="studio-ipad-act-plus">⊕</span>
        <span className="studio-ipad-act-grow">{value ?? ""}</span>
        <Caret />
      </div>
    );
  }
  if (t === "textarea")
    return <textarea className="studio-ipad-act-input area" aria-label={spec.label} />;
  return (
    <input className="studio-ipad-act-input" aria-label={spec.label} defaultValue={value ?? ""} />
  );
}

export function Field({
  spec,
  value,
  tall,
}: {
  spec: RecordFieldSpec;
  value?: string;
  tall?: boolean;
}) {
  return (
    <div className="studio-ipad-act-field">
      <div className="studio-ipad-act-label">
        {spec.required && <span className="studio-ipad-act-req">*</span>}
        {spec.label}
      </div>
      <Control spec={spec} value={value} tall={tall} />
    </div>
  );
}

/** What the create form needs beyond the layout: the new record's temporary number, picklist starting values and cell values. */
export interface FormContext {
  seed: string;
  defaults?: Record<string, string>;
  /** Cell values by field; undefined draws an empty cell. */
  values: (spec: RecordFieldSpec) => string | undefined;
  /** Headings for sections that have no label (the linked Case layout's first and last). */
  nullLabels: string[];
  /** Fields the create form draws as an empty static cell whatever the layout says (observed: the Inquiry's Status). */
  staticNames?: string[];
}

/** A read-only custom text field is not drawn on the create form (observed: Inq_IsCreatorOrResponder), but its row keeps 30pt more height. */
export const hiddenCell = (spec: RecordFieldSpec): boolean =>
  !!spec.readOnly && /__c$/.test(spec.name) && /^(text|string)$/.test(spec.type);

export function FormControl({ spec, form }: { spec: RecordFieldSpec; form: FormContext }) {
  const t = spec.type;
  const value = form.values(spec);
  if (t === "masterdetail" || /^(CaseNumber|CaseId)$/.test(spec.name))
    return <div className="studio-ipad-act-static">{autoNumber(form.seed)}</div>;
  if (
    form.staticNames?.includes(spec.name) ||
    /^Owner/.test(spec.name) ||
    spec.readOnly ||
    /^(autonumber|calculated|summary)$/.test(t)
  ) {
    return <div className="studio-ipad-act-static">{value ?? ""}</div>;
  }
  if (t === "boolean") return <span className="studio-ipad-act-toggle" aria-label={spec.label} />;
  if (t === "picklist" || t === "multipicklist" || t === "combobox") {
    return (
      <div className="studio-ipad-act-box">
        <span>{value ?? picklistStart(spec, form.defaults) ?? ""}</span>
        <Caret />
      </div>
    );
  }
  if (t === "datetime" || t === "date" || t === "time")
    return <Control spec={spec} value={value} />;
  if (t === "lookup" || t === "reference" || t === "hierarchy") {
    return (
      <div className="studio-ipad-act-box">
        <span className="studio-ipad-act-plus">⊕</span>
        <span className="studio-ipad-act-grow">{value ?? ""}</span>
        <Caret />
      </div>
    );
  }
  return (
    <div className={`studio-ipad-act-box${t === "textarea" ? " tall" : ""}`}>
      <span className="studio-ipad-act-grow" />
      <Mic />
    </div>
  );
}

/** Layout sections as a create form: the cell at (row, column) is column[column][row]; a section with one column spans the width; rows are 75pt apart like the Visit editor. */
export function Sections({
  layout,
  form,
  firstNull,
}: {
  layout: PublishedLayout;
  form: FormContext;
  firstNull: number;
}) {
  let nulls = firstNull;
  return (
    <>
      {layout.sections.map((s, i) => {
        const cols: RecordFieldSpec[][] =
          s.fields ??
          s.columns.map((c) => c.map((label) => ({ name: label, label, type: "string" })));
        const rows = Math.max(0, ...cols.map((c) => c.length));
        const title = s.label ?? form.nullLabels[nulls++];
        const wide = cols.length === 1;
        return (
          <div key={i} className="studio-ipad-act-section">
            {title && <h3>{title}</h3>}
            <div className="studio-ipad-act-grid two">
              {Array.from({ length: rows }).flatMap((_, r) =>
                cols.map((c, ci) => {
                  const spec = c[r];
                  if (!spec || hiddenCell(spec)) return <div key={`${r}:${ci}`} />;
                  const padded = cols.some((x) => x[r] && hiddenCell(x[r]));
                  const area = spec.type === "textarea";
                  return (
                    <div
                      key={`${r}:${ci}`}
                      className={`studio-ipad-act-field vfield${area ? " area" : ""}${wide ? " wide" : ""}${padded ? " padded" : ""}`}
                    >
                      <div className="studio-ipad-act-label">
                        {spec.required && <span className="studio-ipad-act-req">*</span>}
                        {spec.label}
                      </div>
                      <FormControl spec={spec} form={form} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function layoutsFor(
  snapshot: PublishedIpad,
  object: string,
  recordType: string
): PublishedLayout[] {
  const rt = snapshot.objects[object]?.recordTypes.find((r) => r.name === recordType);
  const names = rt?.multiEntity?.layouts ?? (rt?.layout ? [rt.layout] : []);
  return names.map((n) => snapshot.layouts[n]).filter((l): l is PublishedLayout => !!l);
}

export const Mic = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="7" y="2" width="6" height="10" rx="3" fill="#555" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3" fill="none" stroke="#555" strokeWidth="1.5" />
  </svg>
);
