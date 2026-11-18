import React, { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import Spinner from "../../ui/Spinner";

interface NewDraftDialogProps {
  /** Starts the draft; resolves with an error message, or nothing when it started. */
  onStart: (brief: string) => Promise<string | null>;
  onCancel: () => void;
}

const EXAMPLE =
  "Three slides for Cordim: a title slide, a dosing overview with a table, and a summary with a button back to the start. Our brand colors are navy and teal.";

/** Studio → Build → Intelligent Content → New presentation → Draft pages with Roz: the brief. */
export default function NewDraftDialog({ onStart, onCancel }: NewDraftDialogProps) {
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const start = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError("");
    const problem = await onStart(brief.trim());
    if (problem) {
      setError(problem);
      setBusy(false);
    }
  };

  return (
    <div className="studio-modal-backdrop" onClick={() => !busy && onCancel()}>
      <div
        className="studio-modal content-draft-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Draft pages with Roz"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="studio-modal-header">
          <span className="studio-inspector-eyebrow">New page</span>
          <button
            className="ui-icon-btn"
            onClick={onCancel}
            title="Close"
            aria-label="Close"
            disabled={busy}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <>
          <h2 className="studio-inspector-title">What should the page show?</h2>
          <p className="content-muted">
            Roz writes it as HTML slides and runs them here in the CLM player. Nothing goes to the
            org until you put the page in a presentation and apply it.
          </p>
          <label className="ui-label">
            Brief
            <textarea
              className="ui-field content-draft-brief"
              value={brief}
              rows={6}
              autoFocus
              placeholder={EXAMPLE}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void start();
                }
              }}
            />
          </label>
          <p className="content-muted">
            Roz won't make up claims, data or references: it leaves a marked placeholder for each
            one. Every drafted page needs medical, legal and regulatory review before reps see it.
          </p>
          {error && (
            <p className="content-problem" role="alert">
              {error}
            </p>
          )}
        </>
        <div className="studio-modal-actions">
          <button className="studio-btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="studio-btn primary"
            onClick={() => void start()}
            disabled={!brief.trim() || busy}
          >
            {busy ? <Spinner size={14} /> : <Sparkles size={14} aria-hidden="true" />}
            Draft it
          </button>
        </div>
      </div>
    </div>
  );
}
