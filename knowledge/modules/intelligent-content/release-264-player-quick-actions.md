# Streamlined In-Context Actions (Player Quick Actions) - Winter '27 (264)

> Source: Winter '27 release enablement deck, "Streamline quick actions", now GA and confirmed against the official release notes. Platforms per deck: iPad and Web; face-to-face (F2F) player.

## What's New

Medical Inquiry and Survey actions are available directly from the Presentation Player's main (overflow) menu during a presentation, so the rep, MSL or KAM can respond to an HCP without leaving the presentation. It reuses the existing action configuration, permissions and workflows, and preserves attendee-based selection for group / multi-attendee interactions (the menu shows the selected attendee with the note that the action applies only to the selected attendee).

Use case: an HCP asks a detailed medical question; the rep launches a Medical Inquiry from the player for that HCP and continues the discussion.

## Admin Setup & Configuration

1. **Create two Quick Actions** (Admin Console quick actions):

| Setting | Medical Inquiry | Survey |
|---|---|---|
| Action Name | `Inquiry` | `Survey` |
| Location | Intelligent Content | Intelligent Content |
| SObject | Account | Account |

2. **Assign access** - assign each Quick Action to the appropriate permission sets and profiles of the field users.
3. No separate workflow configuration is needed; this uses the existing Intelligent Content Quick Action framework.

### Notes from Help

- Create actions from the **Quick and Custom Action Administration** tile in the Admin Console. Permission set: **Life Sciences Commercial Admin** (plus Customize Application for field sets and topics).
- **Always populate the SObject field** on each action; if blank, users can see duplicate actions with the same name.
- Related standard setup: to open the content library from the account list, create a quick action with Action Name `Intelligent Content`, Location `Search`, SObject `Account`, and assign it to permission sets/profiles.
- The Help article "Add Actions for Presentations" does not document the Location "Intelligent Content" `Inquiry`/`Survey` actions; those values come from the release deck.

## End-User Flow

In the Presentation Player menu: **Inquiry** captures a Medical Inquiry; **Survey** starts or resumes a Survey.

Per "Present Content to Your Customers": open the player menu (arrow icon top-left/bottom-left; or swipe up/down, or tap/click top or bottom of page). Use the **account icon** to see attendees (first account is the main account, others are participants), then pick **Survey** or **Inquiry** from the account's quick actions. Surveys can be closed and resumed later; responses save automatically against the account. **Capturing account-specific survey responses and creating medical inquiries from the player is supported only in the Life Sciences Cloud mobile app**, not the desktop site.

Other player behavior: locked presentations (lock icon, PIN/Face ID to unlock) hide other menu options; pause tracking via the pause icon; products restricted for an attendee's account block adding that account; the Cancel button ends the session without saving metrics, while the Visit button returns to the visit and saves metrics.

## Related

Quick action setup in general: lsc-quick-actions-configuration skill.

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_intelligent_content_add_actions.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_intelligent_content_presentation_player.htm&release=264.0.0&type=5
