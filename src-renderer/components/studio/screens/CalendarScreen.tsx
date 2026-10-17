import React from "react";
import type { ScreenProps } from "./types";
import "./calendar.css";

/** Planner (PlannerContainerViewController), drawn like LSC Mobile at 1210×834pt. Null until there is data, so the preview keeps its placeholder. */
export default function CalendarScreen({ tab, snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.calendar;
  void tab;
  if (!data) return null;
  return <div className="studio-ipad-calendar" />;
}
