# iPad crashes when editing a Presentation Forum on package 262

**What you see:** On iPad, editing a Presentation Forum from the visit closes the app. The org is on package 262. The same edit does not crash on package 264.

The 262 handler passes the Presentation Forum id to `editCoordinator`. That method expects the parent Visit id. The forum id is not a Visit, so `editCoordinator` hits `fatalError` and the app crashes.

Package 264 passes the parent Visit id, `PresentationForum.ForumReferenceId`.

## How to pin it

1. Confirm the crash is Edit on a Presentation Forum row from the visit, and the installed package is 262. If the package is 264 or later, this defect is already fixed.
2. Load the row:

```sql
SELECT Id, ForumReferenceId
FROM PresentationForum
WHERE Id = '<forum id>'
```

`Id` is the forum. `ForumReferenceId` is the parent Visit. They are different.

3. Stop. On 262, Edit sends `Id` to `editCoordinator`. `editCoordinator` requires the Visit id, so the app crashes. Do not ask for a crash log, a database, or a recording once the version and the row are confirmed.
4. The fix is package 264, which sends `ForumReferenceId`. Upgrade the org. Do not change the forum record.

## Required answer

The reply must include all of:

- Cause: on package 262, the Presentation Forum edit handler passes the forum id, not the parent Visit id, to `editCoordinator`. That `fatalError` crashes the app.
- Evidence: the crash is Edit on a Presentation Forum, the package is 262, and `ForumReferenceId` is a different id from the forum `Id`.
- Fix: package 264 passes the parent Visit id. Upgrade.

## Do not

- Do not stop after asking for a crash log, a database export, or a recording.
- Do not leave the cause unverified once the package version and the two ids are known.
- Do not use this leaf for a crash on package 264. That build already passes `ForumReferenceId`.
