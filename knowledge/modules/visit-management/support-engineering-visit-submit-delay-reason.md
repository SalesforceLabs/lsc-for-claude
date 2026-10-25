# Web late-visit submit stays enabled without a delay reason

**What you see:** Admin Console **Submission Delay Reason Threshold** is set (for example 5 days). A visit whose planned start is older than that threshold opens the delay-reason popup on submit. On web, the user can still submit with the reason empty. On iPad, the same field is required and submit is blocked.

This is a known product defect on Life Sciences package **262**. The fix ships in package **264**. An org still on 262.x sees it until that upgrade. Do not open a new investigation when the org package is still 262.

## What is not the cause

`VisitDelayReasonHandler` only clears a delay reason that was already entered, after the user moves the date back inside the threshold. Toggling that handler does not add the missing submit guard.

## What to check

1. Confirm iPad blocks the same late submit and web does not.
2. Read the **lsc4ce package version** on the org, not only the core platform version.
3. If the package is **262.x**, the org is before the fix. A submit from Account → More Actions → New Visit on 262 is the same unfixed package, not a second code path.
4. Revisit the behavior only if the org is **already on 264** and web still submits with an empty reason.

## What to tell the user

iPad already requires the delay reason. Web does too, starting in package **264**. Orgs on 262.x can still submit without a reason until they upgrade. There is no org-side workaround: do not change the threshold, field-level security, or `VisitDelayReasonHandler` to force the guard.

## Required answer

The reply must include all of:

- Cause: on Life Sciences package 262, web submit stays enabled when Submit Delay Reason is empty. iPad already blocks that submit.
- The org's lsc4ce package version, and that 262.x is before the fix in package 264. The resolution is the upgrade.
- `VisitDelayReasonHandler` is not the guard. It only clears a reason after the date moves back inside the threshold.

## Do not

- Do not leave "handler might be inactive" or "a second web path" open once the package version is 262.x.
- Do not start a new search of `SubmissionDelayReason` once the package version shows 262.x.
- Do not ask for an Apex debug log before comparing the org package to 264.
- Do not treat a report from a 262 org as proof the 264 fix skipped a path.
