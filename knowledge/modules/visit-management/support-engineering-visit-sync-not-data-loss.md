# Visit children missing on web after an iPad submit

**What you see:** An iPad Visit submit included Product Disbursement, Presentation Forum, or Presentation Click Stream Entry (`PresentationClickStreamEntry`), and those records are missing on the web. The report may already say a presentation lock raced the upload and permanently dropped the rows. Do not start there. Read the Device Sync Transaction first.

If the player opened from the Visit and nothing was recorded at all, check **Pause tracking when player launches** first. A paused session never creates those rows. See [support-engineering-pause-tracking-on-launch.md](../intelligent-content/support-engineering-pause-tracking-on-launch.md). This leaf is for a submit whose rows did reach the Device Sync Transaction.

## What to check

1. Find the Device Sync Transaction for that user and submit, then its child records.

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

2. If Product Disbursement, Presentation Forum, and Presentation Click Stream Entry rows are **present** on `DeviceSyncTransactionRecord`, the client submitted them. There is no silent data loss and no drop before sync.
3. Read the transaction status and error. A transaction that **failed** on a **customer validation rule** (often on Presentation Click Stream Entry) leaves the payload on the sync records. The web objects stay empty because the transaction did not commit.
4. A later sync can clear those rows from the iPad and move the Visit to Completed. The device drops local pending data after the server acknowledges the transaction, including a failed one. An empty iPad is not evidence the upload was discarded.

## What to tell the user

The submitted records are on the Device Sync Transaction. They did not reach the web records because the customer's validation rule failed the sync. The customer's implementation team inactivates that rule or changes it so a valid submit can commit. No package change is required for this pattern.

## Required answer

The reply must include all of:

- No data loss. Product Disbursement, Presentation Forum, and Presentation Click Stream Entry are present on `DeviceSyncTransactionRecord`.
- Cause: the Device Sync Transaction failed on the customer's validation rule, so the web rows never committed.
- The customer's implementation team inactivates that rule or changes it. No package change.

## Do not

- Do not stop at "check the sync transaction" without the rule and the customer action.
- Do not assert a race between presentation writes and a presentation lock handler when the child rows are already on the sync transaction.
- Do not treat a failed transaction as a successful sync that hid a silent drop.
- Do not ask for an Apex debug log or an iOS sync log before reading the Device Sync Transaction error.
- Do not open a product defect for missing web records while the sync error names a customer validation rule.
