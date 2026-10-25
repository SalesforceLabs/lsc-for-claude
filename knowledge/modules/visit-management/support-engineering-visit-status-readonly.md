# Visit Status is editable and shows every value

**What you see:** On web Visit Engagement, Visit **Status** is editable while the visit is being created, and the dropdown lists every value on the field. Life Sciences visits use **Planned** and **Completed**.

Status is read-only by default on the Visit layout. The full picklist is not the design. It appears because a client bug cleared that read-only default, so the control behaved like a normal picklist.

The same client bug clears any field the page layout or field-level security marks read-only, not only Status. It shows up while the visit is being created. This is not the **Set Audit Fields upon Record Creation** permission. That permission controls audit fields such as Created Date. It does not unlock a layout or field-level security lock.

This is the web Visit Engagement client, not the iPad app. The correction ships in Life Sciences package **264.5**. An org still on an earlier 264 package, or on 262, still sees the lock cleared.

## What is going wrong

The client marks Status read-only when it reads the layout. `refreshFieldReadOnlyStatus` then runs during creation and clears that layout or field-level security lock, including on Status. Once the control is editable, every value defined on the field is selectable.

Status is not one of the fields a Remote Engagement session unlocks (Channel, RecordTypeId, CallDateTime, PlannedVisitEndTime, Location, BookingStatus, Account, InvitationEmail, DurationPicklist). The client correction keeps Status read-only on a normal visit. It unlocks only a Remote Engagement field, and only on a Remote Engagement visit.

There is no runtime whitelist that accepts Planned and resets every other value. The field's schema listing more values does not mean those values are the visit lifecycle.

## What to check

1. Confirm the symptom is web Visit Engagement, on create. The page layout or field-level security marks the field read-only, and the control is still editable.
2. Read the org's lsc4ce package version. Before **264.5**, the client clears that lock during creation. **264.5** keeps a layout or field-level security read-only lock on a normal visit.
3. Stop. Do not check Set Audit Fields. Do not search Visit triggers or the picklist definition for a state machine.
4. For Status, do not remove picklist values. Life Sciences uses Planned and Completed. The other values are visible only because the control was editable.

## What to tell the user

A field that is read-only on the layout or by field-level security stays editable on create until the org is on package **264.5**. Changing Set Audit Fields, field-level security, the page layout, or the metadata cache does not fix an org that is still before that package. After 264.5 the client keeps the lock. Status stays read-only, and Life Sciences still uses Planned and Completed.

## Required answer

The reply must include all of:

- Cause: during Visit creation, `refreshFieldReadOnlyStatus` clears a read-only lock that came from the page layout or from field-level security. This is a product defect, fixed in package **264.5**.
- The org's lsc4ce version, and whether it is before 264.5. The resolution on an older package is the upgrade, not a permission change.
- Set Audit Fields is not the cause. For Status, Life Sciences uses Planned and Completed. Extra values appear only because the control was editable.

## Do not

- Do not call this expected platform behavior, or lead with Set Audit Fields.
- Do not call the full Status value set working as designed, or a whitelist that resets anything other than Planned.
- Do not change field-level security, the page layout, or the metadata cache to put the lock back on a package before 264.5.
- Do not treat this as an iPad defect.
