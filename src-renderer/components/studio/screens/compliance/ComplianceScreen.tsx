import React, { useState } from "react";
import type { ScreenProps } from "../types";
import {
  actionTitle,
  emptyMessage,
  filterPlans,
  shortDate,
  STATUS_BADGE,
  stateTone,
  TABS,
  type ComplianceTab,
} from "./compliance-logic";
import type { PublishedCompliance, PublishedCompliancePlan } from "./compliance-types";
import "./compliance.css";

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`studio-ipad-compliance-badge ${tone}`}>{children}</span>;
}

function Stat({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="studio-ipad-compliance-stat">
      <div className="studio-ipad-compliance-stat-label">{label}</div>
      <div className={`studio-ipad-compliance-stat-value ${tone ?? ""}`}>{children}</div>
    </div>
  );
}

/** ProviderEngagementSummaryView: progress, cycle counts and the current (or last) cycle. */
function Summary({ plan, visitLabel }: { plan: PublishedCompliancePlan; visitLabel?: string }) {
  const c = plan.currentCycle;
  const last = plan.state === "completed" || plan.allCyclesPast;
  const status = plan.cycleStatus ? STATUS_BADGE[plan.cycleStatus] : null;
  const action = actionTitle(plan.action, visitLabel);
  return (
    <div className="studio-ipad-compliance-summary">
      <Stat label="Progress">
        <div className="studio-ipad-compliance-bar">
          <div style={{ width: `${Math.round(plan.progress * 100)}%` }} />
        </div>
      </Stat>
      <Stat label="Complete Cycles" tone="success">
        {plan.completeCount}
      </Stat>
      <Stat label="Skipped Cycles" tone="error">
        {plan.skippedCount}
      </Stat>
      <div className="studio-ipad-compliance-vsep" />
      <Stat label={last ? "Last Cycle" : "Current Cycle"}>{c?.name || "-"}</Stat>
      <Stat label="Cycle Start">{shortDate(c?.start)}</Stat>
      <Stat label="Cycle Due">{shortDate(c?.end)}</Stat>
      <Stat label={last ? "Last Cycle Status" : "Cycle Status"}>
        {status ? <Badge tone={status.tone}>{status.title}</Badge> : "-"}
      </Stat>
      {action && (
        <button className="studio-ipad-compliance-action" type="button">
          {action}
        </button>
      )}
    </div>
  );
}

function Detail({
  plan,
  visitLabel,
  onBack,
}: {
  plan: PublishedCompliancePlan;
  visitLabel?: string;
  onBack: () => void;
}) {
  const hasVisits = plan.cycles.some((c) => c.interviewer || c.visitDate);
  return (
    <div className="studio-ipad-compliance">
      <div className="studio-ipad-compliance-header">
        <button className="studio-ipad-compliance-back" type="button" onClick={onBack}>
          ‹ Back
        </button>
        <div className="studio-ipad-compliance-headings">
          <div className="studio-ipad-compliance-eyebrow">{plan.accountName}</div>
          <div className="studio-ipad-compliance-title">{plan.name}</div>
        </div>
        {plan.state === "notStarted" && (
          <button className="studio-ipad-compliance-action" type="button">
            View on Web
          </button>
        )}
      </div>
      {plan.state === "notStarted" ? (
        <div className="studio-ipad-compliance-empty">
          <div className="studio-ipad-compliance-empty-title">Account Compliance Not Started</div>
          <div className="studio-ipad-compliance-empty-body">
            Go to the web application to start this account compliance.
          </div>
        </div>
      ) : (
        <div className="studio-ipad-compliance-card">
          <Summary plan={plan} visitLabel={visitLabel} />
          <div className="studio-ipad-compliance-rule" />
          <table className="studio-ipad-compliance-table">
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                {hasVisits && (
                  <>
                    <th>Interviewer</th>
                    <th>Visit Date</th>
                  </>
                )}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plan.cycles.map((c) => {
                const badge = STATUS_BADGE[c.status];
                return (
                  <tr key={c.number}>
                    <td>
                      {c.number === 0 ? "Cycle 0" : `Cycle ${c.number}`}
                      <div className="studio-ipad-compliance-sub">{c.name}</div>
                    </td>
                    <td>{shortDate(c.start)}</td>
                    <td>{shortDate(c.end)}</td>
                    <td>
                      <Badge tone={badge.tone}>{badge.title}</Badge>
                    </td>
                    {hasVisits && (
                      <>
                        <td>{c.interviewer || "-"}</td>
                        <td>{shortDate(c.visitDate)}</td>
                      </>
                    )}
                    <td>
                      {[c.action, c.secondaryAction].map((a, i) => {
                        const t = a && actionTitle(a, visitLabel);
                        return t ? (
                          <button
                            key={i}
                            className="studio-ipad-compliance-action small"
                            type="button"
                          >
                            {t}
                          </button>
                        ) : null;
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function List({ data, onOpen }: { data: PublishedCompliance; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<ComplianceTab>("all");
  const [search, setSearch] = useState("");
  const plans = filterPlans(data.plans, tab, search);
  return (
    <div className="studio-ipad-compliance">
      <div className="studio-ipad-compliance-header">
        <div className="studio-ipad-compliance-icon" aria-hidden>
          ✓
        </div>
        <div className="studio-ipad-compliance-headings">
          <div className="studio-ipad-compliance-eyebrow">Account Compliance</div>
          <div className="studio-ipad-compliance-title">All Account Compliances</div>
        </div>
      </div>
      <div className="studio-ipad-compliance-toolbar">
        <div className="studio-ipad-compliance-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "on" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="studio-ipad-compliance-search"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {plans.length === 0 ? (
        <div className="studio-ipad-compliance-empty">
          <div className="studio-ipad-compliance-empty-title">Nothing to display</div>
          <div className="studio-ipad-compliance-empty-body">{emptyMessage(tab)}</div>
        </div>
      ) : (
        <div className="studio-ipad-compliance-list">
          {plans.map((p) => (
            <div key={p.id} className="studio-ipad-compliance-card" onClick={() => onOpen(p.id)}>
              <div className="studio-ipad-compliance-card-head">
                <div className="studio-ipad-compliance-card-name">
                  {p.accountName} • <span>{p.name}</span>
                </div>
                {p.previousOverdue && <Badge tone="error">Previous Cycles Overdue</Badge>}
                <Badge tone={stateTone(p.state)}>{p.stateLabel}</Badge>
              </div>
              <div className="studio-ipad-compliance-rule" />
              <Summary plan={p} visitLabel={data.visitLabel} />
            </div>
          ))}
        </div>
      )}
      {data.unavailable?.length ? (
        <div className="studio-ipad-compliance-note">
          Not in the preview: {data.unavailable.join(" ")}
        </div>
      ) : null}
    </div>
  );
}

/** Account Compliance tab (AccountComplianceTabCoordinator), drawn like LSC Mobile. Buttons are inert. */
export default function ComplianceScreen({ snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.compliance;
  const [openId, setOpenId] = useState<string | null>(null);
  if (!data) return null;
  const open = openId ? data.plans.find((p) => p.id === openId) : undefined;
  return open ? (
    <Detail plan={open} visitLabel={data.visitLabel} onBack={() => setOpenId(null)} />
  ) : (
    <List data={data} onOpen={setOpenId} />
  );
}
