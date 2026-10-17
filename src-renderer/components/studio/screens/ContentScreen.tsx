import React from "react";
import type { ScreenProps } from "./types";
import "./content.css";

/** Intelligent Content grid (CLMGridViewController), drawn like LSC Mobile at 1210×834pt. Null until there is data, so the preview keeps its placeholder. */
export default function ContentScreen({ tab, snapshot }: ScreenProps): React.ReactElement | null {
  const data = snapshot.screens?.content;
  void tab;
  if (!data) return null;
  return <div className="studio-ipad-content" />;
}
