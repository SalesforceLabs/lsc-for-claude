import type { MetricEvaluation, PersonaResult } from "./perf-types";
import { formatNumber, metricInfo } from "./perf-plan";

/** Seconds as "45 s", "2.3 min" or "1.2 h", for sentences. */
function plainSeconds(s: number): string {
  if (s < 120) return `${formatNumber(Math.round(s * 10) / 10)} s`;
  if (s < 7200) return `${(s / 60).toFixed(1).replace(/\.0$/, "")} min`;
  return `${(s / 3600).toFixed(1).replace(/\.0$/, "")} h`;
}

function plainValue(e: Pick<MetricEvaluation, "metric">, v: number): string {
  const { unit } = metricInfo(e.metric);
  if (unit === "s") return plainSeconds(v);
  if (unit === "records" || unit === "requests") return formatNumber(v);
  return `${formatNumber(v)} ${unit}`;
}

/** "Delta sync p95 is 2.3 min against a 2 min target" for a measure that didn't pass. */
function overBy(e: MetricEvaluation): string {
  const label = metricInfo(e.metric).label;
  const value = e.value === undefined ? "not measured" : plainValue(e, e.value);
  const fail = e.status === "fail";
  const limit = fail ? e.threshold?.fail : e.threshold?.warn;
  return limit === undefined ? `${label} is ${value}` : `${label} is ${value} against a ${plainValue(e, limit)} ${fail ? "limit" : "target"}`;
}

const MAX_NAMED = 2;

export interface Verdict {
  text: string;
  tone: "success" | "warning" | "error" | "info";
}

/** One sentence on how a persona did against its targets, naming the worst misses. */
export function personaVerdict(p: PersonaResult): Verdict {
  const targets = p.evaluations.filter((e) => e.status === "pass" || e.status === "warn" || e.status === "fail");
  const met = targets.filter((e) => e.status === "pass").length;
  const failed = targets.filter((e) => e.status === "fail");
  const close = targets.filter((e) => e.status === "warn");
  const unmeasured = p.evaluations.filter((e) => e.status === "no-data" && e.threshold).length;
  const total = targets.length + unmeasured;
  const name = p.persona.name || "This persona";
  if (total === 0) return { text: `${name} has no customer targets to check yet.`, tone: "info" };
  const named = [...failed, ...close].slice(0, MAX_NAMED).map(overBy);
  const more = failed.length + close.length - named.length;
  const rest = named.length ? `; ${named.join("; ")}${more > 0 ? `; and ${more} more` : ""}` : "";
  const tail = unmeasured ? ` ${unmeasured} couldn't be measured, so ${unmeasured === 1 ? "it is" : "they are"} unproven.` : "";
  if (failed.length) return { text: `${name} meets ${met} of ${total} targets${rest}.${tail}`, tone: "error" };
  if (unmeasured) return { text: `${name} is not proven yet: ${met} of ${total} targets met${close.length ? `${rest}` : ""}.${tail}`, tone: "warning" };
  if (close.length) return { text: `${name} meets ${met} of ${total} targets and the rest are close to their limits${rest}.`, tone: "warning" };
  return { text: `${name} meets all ${total} targets.`, tone: "success" };
}
