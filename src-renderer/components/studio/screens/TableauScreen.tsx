import React from "react";
import type { ScreenProps } from "./types";
import "./tableau.css";

/** Tableau Followed Metrics (LSCTableauViewController), drawn like LSC Mobile at 1210×834pt. Null until there is data, so the preview keeps its placeholder. */
export default function TableauScreen({ tab, snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.tableau;
  void tab;
  if (!data) return null;
  return <div className="studio-ipad-tableau" />;
}
