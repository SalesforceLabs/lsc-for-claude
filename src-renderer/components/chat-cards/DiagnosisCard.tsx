import React, { useMemo, useState } from "react";
import { SearchCheck } from "lucide-react";
import StatusIcon from "../ui/StatusIcon";
import { CheckRow } from "../studio/ReadinessView";
import { diagnosisVerdict, toCheck, type DiagnosisResult } from "../studio/diagnose-logic";
import "../studio/readiness.css";
import "./chat-cards.css";

const NO_FIXES = { pending: [], onPendingChange: () => {}, profiles: [] };

/** Known causes matched to an error, as check rows: the cause found in the org is open, with its records and steps. */
export default function DiagnosisCard({ result }: { result: DiagnosisResult }) {
  const connected = Boolean(result.checkedOrg);
  const checks = useMemo(() => result.items.map((i) => toCheck(i, connected)), [result, connected]);
  const [open, setOpen] = useState<string | null>(() => result.items.find((i) => i.status === "found" && !i.byDesign)?.id ?? null);

  if (result.items.length === 0) {
    return (
      <div className="chat-card chat-card-line">
        <SearchCheck size={16} aria-hidden="true" />
        <span>No known cause matched</span>
      </div>
    );
  }
  const verdict = diagnosisVerdict(result);
  return (
    <section className="chat-card" aria-label="Known causes">
      <header className="chat-card-head">
        <StatusIcon tone={verdict.tone} size={24} />
        <div className="chat-card-title">
          <span>{verdict.title}</span>
          {result.orgNote && <span className="chat-card-meta">{result.orgNote}</span>}
        </div>
      </header>
      <ol className="studio-checklist-rows chat-card-rows">
        {checks.map((check) => (
          <CheckRow
            key={check.id}
            check={check}
            expanded={open === check.id}
            onToggle={() => setOpen(open === check.id ? null : check.id)}
            fixProps={NO_FIXES}
          />
        ))}
      </ol>
    </section>
  );
}
