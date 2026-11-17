import type { Answers, SurveyListRow, SurveyPage, SurveyQuestion } from "./types";

export type ListTab = "Open" | "Completed";

/**
 * The list under the segment and search. iOS: SurveyRelatedListViewModel.filterSurveys (~L435-475) — Open hides
 * completed ones, Completed shows only those — and partialMatchOnSurveyNameOrProductsLinked (~L420-424), a
 * case-insensitive contains on the name (linked products aren't read by the preview).
 */
export function visibleSurveys(
  rows: SurveyListRow[],
  tab: ListTab,
  search: string
): SurveyListRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (tab === "Completed") === (r.status === "completed") &&
      (!q || r.name.toLowerCase().includes(q))
  );
}

/** iOS: SurveyViewCell's button reads "Launch" for started and open surveys, "View" otherwise (SurveyRelatedListView ~L20-95). */
export function actionLabel(r: SurveyListRow): "Launch" | "View" {
  return r.status === "completed" ? "View" : "Launch";
}

export function isAnswered(q: SurveyQuestion, a: Answers): boolean {
  const v = a[q.id];
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "";
}

/**
 * Required questions on the page still unanswered. iOS: SurveyViewModel.isCurrentPageHasUnansweredVisibleRequiredQuestions
 * (~L400-413) keeps Next / Submit disabled; "Please answer required questions" is its alert. A welcome text has nothing to answer.
 */
export function unansweredRequired(page: SurveyPage, a: Answers): SurveyQuestion[] {
  return page.questions.filter((q) => q.required && q.kind !== "info" && !isAnswered(q, a));
}

export function toggleChoice(a: Answers, id: string, choice: string): Answers {
  const cur = Array.isArray(a[id]) ? (a[id] as string[]) : [];
  return { ...a, [id]: cur.includes(choice) ? cur.filter((c) => c !== choice) : [...cur, choice] };
}

export function progress(pages: SurveyPage[], a: Answers): { answered: number; total: number } {
  const qs = pages.flatMap((p) => p.questions).filter((q) => q.kind !== "info");
  return { answered: qs.filter((q) => isAnswered(q, a)).length, total: qs.length };
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
