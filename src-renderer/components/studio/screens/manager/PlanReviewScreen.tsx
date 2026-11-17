import React from "react";
import type { ScreenProps } from "../types";
import { Browser } from "../../IpadActionSheets";
import "./manager.css";

const noop = () => {};

/**
 * Activity plan review (lifesciences-ios ActivityPlanReviewCoordinator): the device opens the tab's Lightning
 * page in a web view signed in as the rep. The preview loads it the same way, live, in the custom-action
 * sheet's sandboxed browser (signed in through the rep's test-user login when Studio holds one).
 */
export default function PlanReviewScreen({
  tab,
  snapshot,
}: ScreenProps): React.ReactElement | null {
  const review = snapshot.screens?.planReview;
  if (!review) return null;
  const url = review.instanceUrl
    ? `${review.instanceUrl}/lightning/n/${encodeURIComponent(tab.fullName)}`
    : null;
  if (!url) {
    return (
      <div className="studio-ipad-notpreview">
        <div className="studio-ipad-notpreview-title">{tab.label}</div>
        <div className="studio-ipad-notpreview-line">
          Not in the preview: the org didn't report an https address to open this page from.
        </div>
      </div>
    );
  }
  return (
    <div className="studio-ipad-planreview">
      <Browser url={url} hideSafari ctx={{ snapshot, record: null }} onClose={noop} />
    </div>
  );
}
