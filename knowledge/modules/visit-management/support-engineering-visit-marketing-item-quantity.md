# A Provider Visit Marketing Item accepts a negative quantity on web

**What you see:** On web Visit Engagement, Quantity on a Provider Visit Marketing Item can be saved as a negative number. The field rejects 0. It still accepts a leading minus. On iOS, a quantity of 0 or less is blocked in the field. The server accepts the negative value that web saved.

This is a gap between the web field and the iOS field. It is not working as designed.

## How to pin it

1. On web, add a marketing item and set Quantity to a negative number. The value saves.
2. On iOS, the same entry is blocked.
3. Open validation rules on Provider Visit Marketing Item. None of them require Quantity to be greater than 0.

## Required answer

The reply must include all of:

- Cause: the web quantity field rejects 0 and still allows a leading minus. iOS blocks 0 and any negative value. The server does not check Quantity.
- Evidence: a negative Quantity saved from web, and the same entry blocked on iOS.
- Workaround: add a validation rule on Provider Visit Marketing Item that Quantity must be greater than 0. That rule blocks the save on every client.

## Do not

- Do not call this working as designed.
- Do not say there is no check. Web rejects zero. iOS rejects zero and negative values. The gap is the minus sign on web, and the missing server check.
- Do not ask the customer to change product code. The validation rule is the workaround they can apply.
