# Custom fields on product detailing are blank after save

**What you see:** A Visit flow writes customer fields on `ProviderVisitProdDetailing`. After the visit saves, those fields are blank. Product, priority, and the other fields in the save payload are still there.

`LogACallSaveHelper` is the class that writes the detailing row. The blanking is not because that write is unscoped to package fields.

## How to pin it

1. Note the custom fields on `ProviderVisitProdDetailing` that the Visit flow sets, and the value it writes.
2. Save the visit. Query the detailing:

```sql
SELECT Id, ProductId, <custom fields>
FROM ProviderVisitProdDetailing
WHERE ProviderVisitId = '<provider visit id>'
```

The custom fields are null. Fields that were in the save payload are still populated.

3. Order the two writes. The Visit flow commits the custom values first. `LogACallSaveHelper` then upserts the `ProviderVisitProdDetailing` it already holds from the start of the save. That copy is not queried again after the Visit flow.
4. The cached row only carries the save DTO. Fields outside that DTO are blank on it. The second DML writes those blanks over the values the Visit flow just saved.
5. Stop. A before-save flow on `ProviderVisitProdDetailing` sets the custom fields again when the helper upserts the row. A flow that runs only on Visit has already finished by then.

## Required answer

The reply must include all of:

- Cause: `LogACallSaveHelper` upserts a locally cached `ProviderVisitProdDetailing` that was not re-queried after the Visit flow. Fields outside its DTO are blank on that cached row, so the second DML clears them.
- Evidence: the custom fields have values after the Visit flow and are null after the helper's detailing upsert.
- Fix: a before-save flow on `ProviderVisitProdDetailing`.

## Do not

- Do not say the helper clears the fields because it does not limit the write to package-managed fields.
- Do not stop after naming `LogACallSaveHelper`.
- Do not leave the values only on a Visit flow. That flow runs before the stale detailing upsert.
