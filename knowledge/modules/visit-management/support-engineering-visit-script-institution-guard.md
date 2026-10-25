# Visit validation passes for every institution

**What you see:** A Visit Action Validation script does not block an institution account. A person account on the same action is blocked, or the rule was written to apply to institutions and never does.

Do not stop at "Save does not run the script." That is a second gap. It does not explain a result that depends on the account being an institution.

## How to pin it

1. Run the same action twice: one visit whose account is an institution (a business account, `IsPersonAccount` false), and one whose account is a person account.
2. If the person-account visit hits the rule and the institution visit passes, the script ran. Read the Visit Action Validation script body.

```sql
SELECT Id, Name, ComponentName, Type
FROM LifeScienceCustomScript
```

Open that component. Find the institution check. The documented check treats a non-person account as an institution and then applies the rule. An inverted check returns success, or skips the rule, when the account is an institution. Institutions then always pass.

3. If neither visit runs the script on Save, record the second cause. The script's allowed actions omit `Save`, or that Save path does not call the script. Submit and Sign can still run it. A Save gap does not replace the inverted check when the script does run and only institutions pass.
4. The customer corrects the script: apply the rule to institutions, and include `Save` in the actions the script handles when validation should run on Save.

## Required answer

The reply must include all of:

- Primary cause: the customer's Visit Action Validation script inverts the institution check, so an institution always passes.
- Evidence: a person-account visit hits the rule and an institution visit does not, and the condition in the script that produces that.
- Save is a second cause only when the script does not run on Save for either account type. It is not the cause of an institution-only pass.
- The customer corrects the script. Do not close this as Save being excluded by design.

## Do not

- Do not stop after finding that `Save` is missing from the script's action list.
- Do not call the result working as designed while an institution passes and a person account does not.
- Do not edit the platform validation list. The script condition is the customer's.
