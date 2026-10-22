import React from "react";
import Spinner from "../ui/Spinner";

/** The iPad preview's own loading note for a screen read on demand (drawn on the white sheet, not in the app's look). */
export function IpadWait({ label }: { label: string }) {
  return (
    <div className="studio-ipad-lazy" role="status" aria-live="polite">
      <Spinner size={20} />
      <div className="studio-ipad-lazy-title">{label}</div>
    </div>
  );
}

/** What went wrong reading a screen on demand, with a Retry. */
export function IpadFail({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="studio-ipad-lazy" role="alert">
      <div className="studio-ipad-lazy-title">{title}</div>
      <div className="studio-ipad-lazy-detail">{message}</div>
      <button type="button" className="studio-ipad-lazy-retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
