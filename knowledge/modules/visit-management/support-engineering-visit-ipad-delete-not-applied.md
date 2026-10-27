# iPad delete removes a Visit the server keeps

**What you see:** On iPad, Edit and Delete are available on a Visit that is completed, read-only, or outside the rep's territory. The rep deletes it. The Visit disappears on the device and does not come back on a later sync. The same Visit is still on the server.

Do not stop at sharing, a restriction rule, or `VisitLockHandler`. Those explain why the server can refuse the delete. They do not explain the buttons, and they do not explain a device row that stays gone.

## How to pin it

1. Confirm Edit and Delete were shown for that Visit on iPad, and the Visit was completed, read-only, or outside the rep's territory.
2. Confirm the server still has the Visit. The delete never committed.

```sql
SELECT Id, Status, OwnerId
FROM Visit
WHERE Id = '<visitId>'
```

The Id is present and the status is unchanged.

3. Read the Device Sync Transaction for that user around the delete.

```sql
SELECT Id, Status, CreatedDate
FROM DeviceSyncTransaction
WHERE CreatedById = '<userId>'
ORDER BY CreatedDate DESC
LIMIT 20
```

```sql
SELECT Id, Status, Log, RecordId
FROM DeviceSyncTransactionRecord
WHERE ParentId = '<dstId>'
```

The upload of the delete was rejected. The iPad did not show that rejection, and it did not put the Visit back. A later sync still does not download it. The local delete was kept.

4. Stop. That pair is the cause: the device offered a delete the server will not apply, then dropped the local row when the apply was rejected.

## What is nearby, and is not the pin

- **Sharing or a restriction rule** can be why the server rejects the delete (the user can read the Visit and cannot delete it). Record that as the rejection reason. Do not change sharing so the delete succeeds. The Visit should not have offered Delete.
- **`VisitLockHandler`** blocks changes to a submitted Visit on the server by status and signature. It does not look at territory, and it does not control the iPad Edit and Delete buttons. Finding it active is not this diagnosis.
- **`ProductDisbursementDeleteLock`.** A customer trigger rejecting a `ProductDisbursement` delete in the same transaction as visit submit. That is [support-engineering-visit-disbursement-delete-lock.md](./support-engineering-visit-disbursement-delete-lock.md). It is not an iPad Visit row that the server kept.

## What to tell the user

The Visit was not deleted in Salesforce. It is still on the server. The iPad showed Edit and Delete on a Visit the rep cannot change, removed its local copy, and did not restore that copy when the server refused the delete. Do not adjust sharing, restriction rules, or `VisitLockHandler` to make the delete go through.

## Required answer

The reply must include all of:

- Edit and Delete were shown on iPad for a Visit that was completed, read-only, or outside the rep's territory.
- The Visit Id still exists on the server, with the same status. The Device Sync Transaction rejected the delete.
- The iPad kept the local delete and does not restore the Visit. Sharing or `VisitLockHandler` explains the rejection only. Do not change them so the delete succeeds.

## Do not

- Do not stop after naming sharing or `VisitLockHandler` without the server row, the rejected upload, and the unrestored device row.
- Do not split this into a sharing-configuration task plus an open mobile-sync investigation once the server row and the rejected upload are both confirmed.
- Do not treat "the user can read the Visit but cannot delete it" as the fix.
- Do not treat a Visit that is only waiting to sync as this case. Here a completed sync left the server row in place and the device row gone.
