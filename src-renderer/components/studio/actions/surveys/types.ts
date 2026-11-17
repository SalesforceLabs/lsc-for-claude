/** Structural copy of src/studio/screens/surveys/logic.ts. */
export type SurveyStatus = "open" | "started" | "completed";

export interface SurveyListRow {
  id: string;
  invitationId: string;
  name: string;
  developerName: string;
  version: number | null;
  status: SurveyStatus;
  percent: number;
  completedBy?: string;
  completedOn?: string;
  expires?: string;
}

export type QuestionKind =
  | "single"
  | "picklist"
  | "rating"
  | "multi"
  | "slider"
  | "date"
  | "short"
  | "text"
  | "info";

export interface SurveyQuestion {
  id: string;
  text: string;
  help: string;
  required: boolean;
  kind: QuestionKind;
  choices: { id: string; label: string }[];
  min?: number;
  max?: number;
}

export interface SurveyPage {
  name: string;
  label: string;
  questions: SurveyQuestion[];
}

export interface SurveyForm {
  title: string;
  pages: SurveyPage[];
}

export interface PublishedSurveys {
  surveys: SurveyListRow[];
  notes: string[];
}

/** Answers by question id: a string, or the chosen choice ids for a multi-select. */
export type Answers = Record<string, string | string[]>;
