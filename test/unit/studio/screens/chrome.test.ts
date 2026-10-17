import { describe, it, expect } from "vitest";
import { alertBody, alertPill, alertWhen, isAlertShown, safeHtml, syncedLabel, type AlertRow } from "../../../../src/studio/screens/chrome.js";

const NOW = new Date("2026-10-17T23:18:00Z");
const FMT = { timeZone: "America/Los_Angeles", locale: "en-US" };
const row = (o: Partial<AlertRow> = {}): AlertRow => ({
  id: "1",
  subject: "s",
  message: null,
  additional: null,
  type: "Notification",
  silent: false,
  effective: "2026-09-20T14:59:19.000+0000",
  validUntil: null,
  contextType: "Global",
  contextName: null,
  ...o,
});

describe("isAlertShown", () => {
  it("shows a started, open-ended, global alert", () => {
    expect(isAlertShown(row(), NOW)).toBe(true);
  });
  it("hides alerts that have not started, have ended, or are silent", () => {
    expect(isAlertShown(row({ effective: "2026-10-18T00:00:00.000+0000" }), NOW)).toBe(false);
    expect(isAlertShown(row({ validUntil: "2026-10-01T00:00:00.000+0000" }), NOW)).toBe(false);
    expect(isAlertShown(row({ validUntil: "2026-11-01T00:00:00.000+0000" }), NOW)).toBe(true);
    expect(isAlertShown(row({ silent: true }), NOW)).toBe(false);
    expect(isAlertShown(row({ effective: null }), NOW)).toBe(false);
  });
  it("hides announcements and tab-scoped alerts", () => {
    expect(isAlertShown(row({ type: "Announcement" }), NOW)).toBe(false);
    expect(isAlertShown(row({ contextType: "Tab", contextName: "lsc4ce__AccountFilter" }), NOW)).toBe(false);
    expect(isAlertShown(row({ contextType: null }), NOW)).toBe(true);
  });
});

describe("alertPill", () => {
  it("puts untyped alerts with Notifications", () => {
    expect(alertPill(null)).toBe("alerts");
    expect(alertPill("Notification")).toBe("alerts");
    expect(alertPill("Recommendation")).toBe("recommendations");
    expect(alertPill("GuidedAction")).toBe("guidedActions");
    expect(alertPill("Announcement")).toBeNull();
  });
});

describe("alertWhen", () => {
  it("formats an older alert as 'MMM d • time' in the user's zone", () => {
    expect(alertWhen("2026-09-20T14:59:19.000+0000", NOW, FMT)).toBe("Sep 20 • 7:59 AM");
  });
  it("labels today, yesterday, and weekdays", () => {
    expect(alertWhen("2026-10-17T20:00:00.000+0000", NOW, FMT)).toBe("Today • 1:00 PM");
    expect(alertWhen("2026-10-16T20:00:00.000+0000", NOW, FMT)).toBe("Yesterday • 1:00 PM");
    expect(alertWhen("2026-10-13T20:00:00.000+0000", NOW, FMT)).toBe("Tuesday, 1:00 PM");
  });
});

describe("alert text", () => {
  it("reads the AdditionalMessage message and keeps only links", () => {
    const additional = JSON.stringify({ message: 'Tap to <a href="lsc4ce://deeplink/x">View Order</a>. <script>x</script>' });
    expect(alertBody(additional, null)).toBe('Tap to <a href="lsc4ce://deeplink/x">View Order</a>. &lt;script&gt;x&lt;/script&gt;');
  });
  it("falls back to Message when AdditionalMessage is missing or not JSON", () => {
    expect(alertBody(null, "Plain & simple")).toBe("Plain &amp; simple");
    expect(alertBody("not json", "Hi")).toBe("Hi");
  });
  it("escapes a quote inside a link target", () => {
    expect(safeHtml('<a href="a&b">t</a>')).toBe('<a href="a&amp;b">t</a>');
  });
});

describe("syncedLabel", () => {
  it("is medium date, 'at', short time in the user's zone", () => {
    expect(syncedLabel("2026-10-17T20:04:46.000+0000", FMT)).toBe("Oct 17, 2026 at 1:04 PM");
  });
});
