/** Every feature's readiness module, by feature id (see `features.ts`). */

import type { ReadinessModule } from "./index.js";
import visit from "./features/visit.js";
import samples from "./features/samples.js";
import accounts from "./features/accounts.js";
import activityPlan from "./features/activity-plan.js";
import products from "./features/products.js";
import kam from "./features/kam.js";
import calendarTot from "./features/calendar-tot.js";
import listsFilters from "./features/lists-filters.js";
import consent from "./features/consent.js";
import intelligentContent from "./features/intelligent-content.js";
import fieldEmail from "./features/field-email.js";
import surveys from "./features/surveys.js";
import appAlerts from "./features/app-alerts.js";
import nextBest from "./features/next-best.js";
import events from "./features/events.js";
import medicalInquiries from "./features/medical-inquiries.js";
import briefings from "./features/briefings.js";
import mobileSync from "./features/mobile-sync.js";
import territoryUsers from "./features/territory-users.js";
import actionsHome from "./features/actions-home.js";

export const MODULES: Record<string, ReadinessModule> = {
  "visit": visit,
  "samples": samples,
  "accounts": accounts,
  "activity-plan": activityPlan,
  "products": products,
  "kam": kam,
  "calendar-tot": calendarTot,
  "lists-filters": listsFilters,
  "consent": consent,
  "intelligent-content": intelligentContent,
  "field-email": fieldEmail,
  "surveys": surveys,
  "app-alerts": appAlerts,
  "next-best": nextBest,
  "events": events,
  "medical-inquiries": medicalInquiries,
  "briefings": briefings,
  "mobile-sync": mobileSync,
  "territory-users": territoryUsers,
  "actions-home": actionsHome,
};
