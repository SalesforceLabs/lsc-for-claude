// Structural copy of src/perf (nfr.ts, sync-volume.ts, telemetry.ts, assessment.ts) and src/studio/perf.ts
// result types — the renderer bundle cannot import from src/. Keep in sync.

export type MetricKey =
  | "predictedRecordsTotal"
  | "predictedRecordsPerTable"
  | "deviceSoqlRequests"
  | "initialSyncP95Sec"
  | "deltaSyncP95Sec"
  | "metadataDownloadP95Sec"
  | "syncFailureRatePct"
  | "dbSizeP95Gb";

export interface Threshold {
  warn?: number;
  fail?: number;
}

export type Thresholds = Partial<Record<MetricKey, Threshold>>;

export interface Persona {
  name: string;
  users: string[];
  territory?: string;
  thresholds?: Thresholds;
}

/** A test plan — the NFR profile run_perf_assessment reads from YAML. */
export interface PerfPlan {
  name: string;
  personas: Persona[];
  thresholds?: Thresholds;
  telemetry?: { days?: number };
}

export type EvalStatus = "pass" | "warn" | "fail" | "no-data" | "no-threshold";
export type RunStatus = "pass" | "warn" | "fail";

export interface MetricEvaluation {
  metric: MetricKey;
  value: number | undefined;
  threshold: Threshold | undefined;
  status: EvalStatus;
  detail?: string;
}

export interface TableVolume {
  sobject: string;
  developerName: string;
  matchedBy: "profile" | "permissionSet";
  status: "counted" | "not-estimated" | "error";
  records: number;
  deviceRequests: number | null;
  idTag?: string;
  note?: string;
  scope?: "user" | "org-wide";
  sharingModel?: string;
}

export interface TerritoryVolume {
  territory: { id: string; name: string } | null;
  tables: TableVolume[];
  totalRecords: number;
  largestTable: TableVolume | null;
  totalDeviceRequests: number;
}

export interface UserVolume {
  user: {
    id: string;
    username: string;
    name: string;
    profileId: string;
    profileName: string;
    territories: Array<{ id: string; name: string }>;
    permissionSetCount: number;
  };
  tableCount: number;
  territories: TerritoryVolume[];
  error?: string;
}

export interface Distribution {
  n: number;
  p50?: number;
  p90?: number;
  p95?: number;
  max?: number;
}

export interface TelemetrySummary {
  samples: number;
  failureRatePct?: number;
  initial: { total: Distribution; download: Distribution; records: Distribution };
  delta: { total: Distribution; download: Distribution; upload: Distribution };
  metadataDownload: Distribution;
  dbSizeGb: Distribution;
  byNetwork: Array<{ key: string; n: number; deltaP95?: number }>;
  byAppVersion: Array<{ key: string; n: number; deltaP95?: number; failureRatePct: number }>;
  slowest: Array<{ id: string; createdDate: string; user: string; kind: "initial" | "delta"; totalSec?: number; downloadedRecords?: number }>;
}

export interface PersonaResult {
  persona: Persona;
  volumes: UserVolume[];
  telemetry?: TelemetrySummary;
  telemetryError?: string;
  evaluations: MetricEvaluation[];
  status: RunStatus;
}

export interface AssessmentResult {
  profile: string;
  org: string;
  generatedAt: string;
  status: RunStatus;
  personas: PersonaResult[];
}

export interface PerfJobStatus {
  jobId: string;
  org: string;
  state: "running" | "done" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  step: string;
  queries: number;
  result?: AssessmentResult;
  error?: string;
}

export interface PerfUser {
  id: string;
  username: string;
  name: string;
  profile: string;
  territories: number;
}
