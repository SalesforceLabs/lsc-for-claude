import React, { useMemo, useState } from "react";
import type { FormContext, SheetContext } from "../../ipad-sheet-ui";
import { chooserCards, nextEnabled, nextStep } from "./logic";
import { Backdrop, layoutsFor, linkBtn, NavBar, Note, Sections } from "../../ipad-sheet-ui";

/**
 * The create form a "+" opens for an object (SObjectsCoordinator.showAddNewScreen): the record type picker when
 * the object has several, then the record type's layout drawn as a form. Studio never saves: Save is inert.
 */
export default function CreateSheet({
  ctx,
  object,
  label,
  onClose,
}: {
  ctx: SheetContext;
  object: string;
  label: string;
  onClose: () => void;
}) {
  const { snapshot, record } = ctx;
  const obj = snapshot.objects[object];
  const rts = obj?.recordTypes ?? [];
  const [picked, setPicked] = useState(0);
  // New Account opens Advanced Search first (HCP / HCO / License By ID); Next stays off until one is chosen (measured on the device).
  const search = object === "Account" && rts.length > 0;
  const [kind, setKind] = useState<string | null>(null);
  const [step, setStep] = useState<"search" | "byId" | "pick" | "form">(
    search ? "search" : rts.length > 1 ? "pick" : "form"
  );
  const rt = rts[picked];
  const layouts = rt ? layoutsFor(snapshot, object, rt.name) : [];
  const seed = useMemo(() => crypto.randomUUID().toUpperCase(), []);
  const account = record?.object === "Account" ? record.title : "";
  const form: FormContext = {
    seed,
    defaults: rt?.picklistDefaults,
    values: (spec) => (/^Account/.test(spec.name) && account ? account : undefined),
    nullLabels: [],
  };

  if (step === "search" || step === "byId") {
    const cards = chooserCards(rts);
    const card = (c: (typeof cards)[number]) => (
      <div
        key={c.id}
        className={`studio-ipad-act-radio${kind === c.id ? " on" : ""}`}
        onClick={() => setKind(c.id)}
        role="radio"
        aria-checked={kind === c.id}
      >
        <span>
          <b>{c.label}</b>
          {c.description && <small>{c.description}</small>}
        </span>
        {kind === c.id && <span className="studio-ipad-act-tick" />}
      </div>
    );
    const next = () => {
      const n = nextStep(kind, rts);
      if (n?.to === "form") {
        setPicked(n.index);
        setStep("form");
      } else if (n?.to === "byId") setStep("byId");
    };
    return (
      <Backdrop onClose={onClose} className="inquiry">
        <NavBar
          plain
          left={linkBtn("Cancel", onClose)}
          title="Advanced Search"
          right={linkBtn("Next", next, !nextEnabled(kind))}
        />
        <div className="studio-ipad-act-body">
          <h3 className="studio-ipad-act-h">Search by account type</h3>
          {cards.filter((c) => c.section === "type").map(card)}
          <h3 className="studio-ipad-act-h">Search by License</h3>
          {cards.filter((c) => c.section === "license").map(card)}
          {step === "byId" && (
            <Note>
              Not in the preview: searching business licenses by ID needs a live lookup in the org.
            </Note>
          )}
        </div>
      </Backdrop>
    );
  }
  if (step === "pick") {
    return (
      <Backdrop onClose={onClose} className="inquiry">
        <NavBar
          plain
          left={linkBtn("Cancel", onClose)}
          title={label}
          right={linkBtn("Next", () => setStep("form"))}
        />
        <div className="studio-ipad-act-body">
          {rts.map((r, i) => (
            <div
              key={r.name}
              className={`studio-ipad-act-radio${i === picked ? " on" : ""}`}
              onClick={() => setPicked(i)}
              role="radio"
              aria-checked={i === picked}
            >
              {r.label}
              {i === picked && <span className="studio-ipad-act-tick" />}
            </div>
          ))}
        </div>
      </Backdrop>
    );
  }
  return (
    <Backdrop onClose={onClose} className="inquiry">
      <NavBar plain left={linkBtn("Cancel", onClose)} title={label} right={linkBtn("Save")} />
      <div className="studio-ipad-act-body form">
        {layouts.map((l) => (
          <Sections key={l.name} layout={l} firstNull={0} form={form} />
        ))}
        {!layouts.length && (
          <Note>
            Not in the preview:{" "}
            {obj
              ? `the layout for ${rt?.label ?? obj.label} isn't in the cache`
              : `${object} isn't in the cache`}
            , so its form can't be drawn.
          </Note>
        )}
        <Note>The form is not saved.</Note>
      </div>
    </Backdrop>
  );
}
