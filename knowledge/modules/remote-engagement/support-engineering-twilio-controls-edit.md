# Twilio controls are missing on the desktop Visit Engagement page

**What you see:** On desktop Visit Engagement, the Twilio controls (start, mute, audio, and video) are not on the page you opened. Twilio setup is already correct: credentials, the remote visit channel, and trusted URLs.

Those controls render when you edit an existing visit. They do not render while you are creating a visit. A Lightning action override, or a Visit record-type routing row, that sends **New** to the Visit Engagement page will not show them. The override belongs on **Edit**.

## How to pin it

1. Open an existing remote visit with Edit. The Twilio controls are on that page.
2. Start a new visit of the same record type. Those controls are not on the create page.
3. In Setup, open Visit > Buttons, Links, and Actions, and any app or profile action override for Visit. Also open the Visit rows under object record-type routing and read **Action** on each row.
4. The override or routing row that opens Visit Engagement is on New. Move it to Edit. Leave New on the create action.

## Required answer

The reply must include all of:

- Cause: Twilio controls appear on Edit, not while the visit is being created. The override that should show them is on New.
- Evidence: the controls are present on an existing visit opened with Edit, absent on New, and the override or routing Action is New.
- Fix: apply that override to Edit, not New.
- Twilio channel, credentials, and trusted URLs are already sufficient when Edit shows the controls.

## Do not

- Do not start with a mismatch between the visit channel and the video visit channel.
- Do not change Twilio setup when Edit already shows the controls.
- Do not expect the controls on the create page.
