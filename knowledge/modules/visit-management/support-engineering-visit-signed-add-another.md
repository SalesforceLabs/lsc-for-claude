# iPad Add Another and the side menu stay open after signature

**What you see:** On iPad, after the visit is signed, the Product Item dropdown hides products the signature rule locks. **Add Another** is still available, and the side menu still offers those products.

The dropdown applies the signature rule. Add Another does not. `SamplesPlugin.canInsertForGroup` only checks whether another product-item and batch pair is free. The side menu does not apply the rule either. `ProductMenuBloc` leaves sample rows enabled and only locks product-detail rows.

This is an iPad defect. It is not a web Visit Engagement defect.

## How to pin it

1. Sign the visit on iPad. Use a product whose signature requirement the dropdown already enforces.
2. Open Samples. The Product Item dropdown does not offer that product.
3. **Add Another** for that brand is still available. The side menu still selects the product.
4. Stop. The dropdown is the control that applies the signature rule. Add Another and the side menu ignore it.
5. The fix is in `SamplesPlugin.canInsertForGroup` and `ProductMenuBloc`, so those two paths use the same signature rule as the Product Item dropdown. Do not file this as a web defect.

## Required answer

The reply must include all of:

- Cause: on iPad, after signature, Add Another (`SamplesPlugin.canInsertForGroup`) and the side menu (`ProductMenuBloc`) ignore the signature rule that the Product Item dropdown applies.
- Evidence: the visit is signed, the Product Item dropdown hides the product, and Add Another and the side menu still offer it.
- Fix: those two iPad paths. This is not a web defect.

## Do not

- Do not route this to web Visit Engagement.
- Do not treat the dropdown and Add Another as the same check. Only the dropdown applies the signature rule.
- Do not call the side menu locked because product details are locked. Sample rows in `ProductMenuBloc` stay enabled.
