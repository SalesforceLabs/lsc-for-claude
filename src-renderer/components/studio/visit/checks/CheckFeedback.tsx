import React, { useEffect, useRef, useState } from "react";
import { useVisit } from "../draft";
import { runChecks, TEXT, type CheckMode, type CheckOutcome } from "./run";
import "./checks.css";

/**
 * What the device shows around a Save / Sign / Submit (VisitEditorBloc.validateAndSave): the "Just a heads-up..." and
 * "Continue with warnings?" alerts, the delay reason sheet (DelayReasonPlugin) and the error and success toasts.
 * The shell calls `request(mode)` from the nav bar; `onPassed(mode)` runs once every check (and confirmation) passed.
 * Studio never writes: a passed Save or Submit is only simulated by the shell.
 */
export interface CheckFeedbackHandle {
  request: (mode: CheckMode) => void;
}

type Dialog =
  | { kind: "alert"; title: string; message: string; resolve: (ok: boolean) => void }
  | {
      kind: "delay";
      type: "Text" | "Picklist";
      options: { value: string; label: string }[];
      resolve: (reason: string | null) => void;
    };

interface Toast {
  text: string;
  error: boolean;
}

const TOAST_MS = 4000;

/** "• " bullets, as VisitEditorBloc.warningAlertBody. */
export const bullets = (lines: string[]): string =>
  [...new Set(lines.map((l) => l.trim()).filter(Boolean))].map((l) => `• ${l}`).join("\n");

export function CheckFeedback({
  handle,
  onPassed,
}: {
  handle: React.MutableRefObject<CheckFeedbackHandle | null>;
  onPassed: (mode: CheckMode) => void;
}) {
  const visit = useVisit();
  const latest = useRef(visit);
  latest.current = visit;
  const passed = useRef(onPassed);
  passed.current = onPassed;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [note, setNote] = useState<CheckOutcome["skipped"] | null>(null);
  const confirmed = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = (text: string, error: boolean) => {
    clearTimeout(timer.current);
    setToast({ text, error });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const ask = (title: string, message: string) =>
    new Promise<boolean>((resolve) => setDialog({ kind: "alert", title, message, resolve }));
  const askDelay = (type: "Text" | "Picklist", options: { value: string; label: string }[]) =>
    new Promise<string | null>((resolve) => setDialog({ kind: "delay", type, options, resolve }));

  const run = async (mode: CheckMode) => {
    const v = latest.current;
    // A date or account change asks about a conflict again (VisitConflictValidationPlugin.rootVisitDidChange).
    const signature = [
      v.draft.values.AccountId,
      v.draft.values.PlannedVisitStartTime,
      v.draft.values.PlannedVisitEndTime,
    ].join("|");
    const out = runChecks({
      mode,
      draft: v.draft,
      snapshot: v.snapshot,
      layouts: v.layouts,
      editId: v.editId,
      now: new Date(),
      confirmedConflict: confirmed.current === signature,
    });
    v.update({ fieldErrors: out.fieldErrors, checkMessages: out.messages });
    setNote(out.skipped.length ? out.skipped : null);

    // validateState: errors stop here with the one toast; warnings ask first.
    if (!out.ok) {
      show(TEXT.fieldErrors, true);
      return;
    }
    if (out.conflictWarning) {
      if (!(await ask(TEXT.conflictTitle, out.conflictWarning))) return; // notify:false, no toast
      confirmed.current = signature;
    }
    if (out.warnings.length && !(await ask(TEXT.warningsTitle, bullets(out.warnings)))) return;

    // beforeSave: the delay reason comes after validation.
    if (out.needsDelayReason && out.delayReasonType) {
      const reason = await askDelay(out.delayReasonType, out.delayReasonOptions ?? []);
      if (reason === null || reason.trim() === "") {
        show(TEXT.delayMissing, true);
        return;
      }
      latest.current.update({ delayReason: reason });
    }

    passed.current(mode);
    const d = latest.current.draft;
    show(
      mode === "submit"
        ? TEXT.submitted
        : mode === "sign"
          ? d.signature?.type === "physical"
            ? TEXT.signedPhysical
            : TEXT.signed
          : TEXT.saved,
      false
    );
  };

  handle.current = {
    request: (mode) => {
      if (busy.current) return;
      busy.current = true;
      run(mode)
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
        });
    },
  };

  return (
    <>
      {toast && (
        <div className={`studio-ipad-chk-toast${toast.error ? " error" : ""}`} role="status">
          {toast.text}
        </div>
      )}
      {note && (
        <div className="studio-ipad-chk-note" role="note">
          <span>
            Not run in the preview: {note.map((n) => n.check).join("; ")}.
          </span>
          <button type="button" aria-label="Dismiss" onClick={() => setNote(null)}>
            ×
          </button>
        </div>
      )}
      {dialog?.kind === "alert" && (
        <AlertBox
          title={dialog.title}
          message={dialog.message}
          onDone={(ok) => {
            dialog.resolve(ok);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "delay" && (
        <DelayReasonSheet
          type={dialog.type}
          options={dialog.options}
          onDone={(reason) => {
            dialog.resolve(reason);
            setDialog(null);
          }}
        />
      )}
    </>
  );
}

/** providers.appServicesProvider.confirm: a centered iOS alert with Cancel and Continue. */
function AlertBox({
  title,
  message,
  onDone,
}: {
  title: string;
  message: string;
  onDone: (ok: boolean) => void;
}) {
  return (
    <div className="studio-ipad-chk-backdrop">
      <div className="studio-ipad-chk-alert" role="alertdialog" aria-label={title}>
        <div className="studio-ipad-chk-alert-body">
          <div className="studio-ipad-chk-alert-title">{title}</div>
          {message && <div className="studio-ipad-chk-alert-msg">{message}</div>}
        </div>
        <div className="studio-ipad-chk-alert-btns">
          <button type="button" onClick={() => onDone(false)}>
            Cancel
          </button>
          <button type="button" className="bold" onClick={() => onDone(true)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** DelayReasonSheetView (a 200 pt sheet): "Past Due", the prompt, then a text field or the SubmitDelayReasonType menu. */
function DelayReasonSheet({
  type,
  options,
  onDone,
}: {
  type: "Text" | "Picklist";
  options: { value: string; label: string }[];
  onDone: (reason: string | null) => void;
}) {
  const [value, setValue] = useState(type === "Picklist" ? (options[0]?.value ?? "") : "");
  return (
    <div className="studio-ipad-chk-backdrop sheet" onClick={() => onDone(null)}>
      <div
        className="studio-ipad-chk-sheet"
        role="dialog"
        aria-label="Submit Delay Reason"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="studio-ipad-chk-sheet-nav">
          <button type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
          <span>Submit Delay Reason</span>
          <button type="button" className="bold" disabled={!value.trim()} onClick={() => onDone(value)}>
            Submit
          </button>
        </div>
        <div className="studio-ipad-chk-sheet-body">
          <div className="studio-ipad-chk-sheet-title">Past Due</div>
          <div>Provide a reason for the late submission.</div>
          {type === "Text" ? (
            <input
              className="studio-ipad-chk-input"
              aria-label="Reason"
              placeholder="Reason..."
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <select
              className="studio-ipad-chk-input"
              aria-label="Reason"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}
