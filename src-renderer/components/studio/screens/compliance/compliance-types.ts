/** Structural copy of PublishedCompliance in src/studio/screens/compliance/compliance.ts. Keep equal by hand. */
export type ComplianceCycleStatus =
  | "notStarted"
  | "upcoming"
  | "dueSoon"
  | "overDue"
  | "complete"
  | "skipped";
export type ComplianceCycleAction =
  | "none"
  | "viewOnWeb"
  | "createVisit"
  | "viewVisit"
  | "addSkipReason"
  | "viewSkipReason";
export type CompliancePlanState =
  | "notStarted"
  | "inProgress"
  | "completed"
  | "stopped"
  | "restarted"
  | "other";

export interface PublishedComplianceCycle {
  number: number;
  name: string;
  start: string | null;
  end: string | null;
  status: ComplianceCycleStatus;
  action: ComplianceCycleAction;
  secondaryAction?: ComplianceCycleAction;
  interviewer?: string;
  visitDate?: string;
}

export interface PublishedCompliancePlan {
  id: string;
  accountName: string;
  name: string;
  state: CompliancePlanState;
  stateLabel: string;
  total: number;
  completeCount: number;
  skippedCount: number;
  progress: number;
  allCyclesPast: boolean;
  previousOverdue: boolean;
  currentCycle?: PublishedComplianceCycle;
  cycleStatus: ComplianceCycleStatus | null;
  action: ComplianceCycleAction;
  cycles: PublishedComplianceCycle[];
}

export interface PublishedCompliance {
  plans: PublishedCompliancePlan[];
  today: string;
  visitLabel?: string;
  unavailable?: string[];
}
