/** Structural copy of src/studio/screens/kam/kam.ts (kept equal by hand). */

export type KamStatusKind = "completed" | "inProgress" | "notStarted" | "other";

export interface KamNomenclature {
  objective?: string;
  objectivePlural?: string;
  actionPlan?: string;
  actionPlanPlural?: string;
  tactic?: string;
  tacticPlural?: string;
}

export interface KamTask {
  id: string;
  name: string;
  status: string | null;
  kind: KamStatusKind;
  owner: string | null;
  assignedTo: string | null;
  dueDate: string | null;
}

export interface KamActionPlan {
  id: string;
  title: string;
  status: string | null;
  kind: KamStatusKind;
  percent: number;
  owner: string | null;
  tasks: KamTask[];
}

export interface KamObjective {
  id: string;
  title: string;
  status: string | null;
  kind: KamStatusKind;
  percent: number;
  owner: string | null;
  assignedTo: string | null;
  products: string[];
  actionPlans: KamActionPlan[];
}

export interface KamStakeholder {
  id: string;
  title: string;
  nonProfiled: boolean;
  role: string | null;
  influence: string | null;
  strength: string | null;
  comment?: string | null;
  members?: string[];
}

export interface KamParticipant {
  id: string;
  name: string;
  role?: string | null;
}

export interface KamPlan {
  name?: string;
  object: "AccountPlan" | "TerritoryBusinessPlan";
  objectives: KamObjective[];
  stakeholders?: KamStakeholder[];
  participants?: KamParticipant[];
  cut?: string[];
}

export interface PublishedKam {
  plans: Record<string, KamPlan>;
  mode: "status" | "percentage";
  nomenclature: KamNomenclature;
  configRead: boolean;
  /** KAM tables the device syncs for the viewer (for the on-demand plan read). */
  sync?: string[];
  promoTemplates?: { id: string; name: string; status: string | null }[];
}
