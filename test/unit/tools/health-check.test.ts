import { describe, expect, it } from "vitest";
import { MOBILE_CACHE_QUERY } from "../../../src/tools/health-check.js";

describe("health_check mobile cache query", () => {
  it("reads the Active LifeSciMobileMetadataRecord, not a nonexistent object", () => {
    expect(MOBILE_CACHE_QUERY).toContain("FROM LifeSciMobileMetadataRecord");
    expect(MOBILE_CACHE_QUERY).toContain("Status = 'Active'");
    expect(MOBILE_CACHE_QUERY).not.toContain("MobileApplicationDetail");
  });
});
