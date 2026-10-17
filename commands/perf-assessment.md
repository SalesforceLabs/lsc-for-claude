---
description: Assess Life Sciences Cloud (LSC) mobile sync performance against an NFR profile (pass/warn/fail report)
---

# Performance Assessment

Check the connected org's configuration against the customer's performance NFRs. Read-only and safe in production.

## Steps

1. **Find the NFR profile.**
   - If the user gave a path to a profile YAML, use it.
   - Otherwise ask for the customer's NFR targets and the representative users for each persona. Draft a profile from `docs/perf-nfr-profile.example.yaml`, replace every example value, and show it to the user before running.
   - Never invent thresholds. If a target is unknown, leave the metric out and it will be reported as "no threshold".

2. **Ask about sharing-exact counts.** If the user has an sf CLI alias logged in *as* a persona user, pass it as `countAsOrg`. Otherwise, warn that counts reflect the connected user's visibility.

3. **Run** `run_perf_assessment({ profilePath, outputPath? })`. Suggest an `outputPath` such as `perf-reports/<org>-<date>.json` so later runs can be compared.

4. **Present the results.**
   - Overall status first, then each persona's metric table.
   - For each WARN or FAIL, name the user, territory, and table that drove it, and recommend a concrete fix (see the `lsc-performance-validation` skill).
   - List any `error` tables. Their filters don't execute and will fail on device.
   - Close with the method caveats from the report.

5. Offer to drill in with `profile_sync_volume` (one user or territory) or `analyze_sync_telemetry` (narrower window or profile).
