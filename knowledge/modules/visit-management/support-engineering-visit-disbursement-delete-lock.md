# ProductDisbursement delete fails in the same transaction as visit submit

**What you see:** Submitting a visit deletes a `ProductDisbursement` in that same transaction, and the delete is rejected. The visit is submitted, or the submit rolls back with the delete error.

The rejecting class is the customer's unmanaged trigger `ProductDisbursementDeleteLock`. The managed-package submitted-visit lock is not this rejection. The fix is in the customer's trigger: exempt the delete that runs in the same transaction as the visit submit.

## How to pin it

1. Confirm the delete and the visit submit are one transaction. A `ProductDisbursement` removed while the visit is being submitted is this case. A later edit of an already-submitted visit is not.
2. List triggers on the object with the Tooling API, not `list_trigger_handlers`:

```sql
SELECT Name, NamespacePrefix, Status
FROM ApexTrigger
WHERE TableEnumOrId = 'ProductDisbursement'
```

3. `ProductDisbursementDeleteLock` is present, `NamespacePrefix` is empty, and `Status` is Active. That is the customer's trigger. It locks the delete and does not exempt the submit transaction.
4. The managed handler `ProductDisbursementSubmitLockHandler` may also be active. It is not the class that rejected this delete. Do not send the case for a package change because that handler exists.
5. Stop. The customer adds a same-transaction exemption in `ProductDisbursementDeleteLock`.

## What is nearby, and is not the pin

- **iPad Visit delete, server row still there.** Edit and Delete were shown on the Visit, the device row is gone, and the Visit Id remains on the server. That is [support-engineering-visit-ipad-delete-not-applied.md](./support-engineering-visit-ipad-delete-not-applied.md). It is not a `ProductDisbursement` trigger.
- **`ProductDisbursementSubmitLockHandler`.** The managed lock on a submitted or signed visit. Finding it active does not make this a package defect when `ProductDisbursementDeleteLock` is the unmanaged trigger on the delete.

## Required answer

The reply must include all of:

- Cause: the customer's unmanaged trigger `ProductDisbursementDeleteLock` rejects the `ProductDisbursement` delete. The managed-package lock is ruled out.
- Evidence: Tooling API shows `ProductDisbursementDeleteLock` with an empty `NamespacePrefix` and Active status, and the delete is in the same transaction as the visit submit.
- Fix: customer code. Exempt that same-transaction delete. Do not ask for a package change.

## Do not

- Do not route this to a product fix because a submitted visit is locked.
- Do not stop on `list_trigger_handlers` or on `ProductDisbursementSubmitLockHandler`.
- Do not use this leaf for an iPad Visit that disappeared on the device and is still on the server.
