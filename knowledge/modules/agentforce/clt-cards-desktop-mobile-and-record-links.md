# Agentforce Custom Lightning Type Cards: Desktop, iPad/iPhone and Record Links

Practitioner write-up. Tested in a Winter '27 org (API 68.0) with Agent Script employee agents, custom Lightning types (CLTs) and LWCs, in the desktop Agentforce panel and the Salesforce mobile app on iPad. For the focused mobile-rendering checklist, see [clt-cards-on-mobile](./clt-cards-on-mobile.md).

## 1. How a card gets on screen

1. An Apex invocable returns an Apex class (`@AuraEnabled global` fields, `@JsonAccess`).
2. The agent action declares `complex_data_type_name: "c__<cltName>"`.
3. The CLT bundle `lightningTypes/<cltName>/` maps it: `schema.json` points at `@apexClassType/c__<ApexClass>`.
4. `lightningDesktopGenAi/renderer.json` and `lightningMobileGenAi/renderer.json` each contain `{"renderer":{"componentOverrides":{"$":{"definition":"c/<lwc>"}}}}`.
5. The LWC renders the card.

## 2. What the LWC must do to render on mobile

1. **Meta file targets:** `lightning__AgentforceOutput` **and `lightning__UrlAddressable`**. Without `UrlAddressable` the card is blank on mobile with no error. This was the last missing piece after everything else was correct.
2. **Form factors:** `<supportedFormFactors>` with `Small` and `Large` inside the `lightning__AgentforceOutput` targetConfig (the deploy fails without it), and `<sourceType name="c__<cltName>"/>`.
3. **Data:** desktop passes the object to `@api value`. Mobile does not. Mobile passes each field as a page-reference state param `c__<field>`, only when `c__channel === 'Mobile'`. Lists and objects arrive as JSON strings and must be `JSON.parse`d. Read them with `@wire(CurrentPageReference)`. Keep both paths:
   - `@api get/set value` stores `_val` (desktop).
   - The wire stores `_mob` (mobile), and the `value` getter returns `_val || _mob`.
4. **One component is enough:** a mobile renderer can point at the same rich component as desktop. A separate stripped-down mobile card isn't needed.
5. **Deploy the mobile renderer:** the `lightningTypes` folder must contain `lightningMobileGenAi/renderer.json`.

## 3. Troubleshooting a blank or wrong card

- **Blank on iPad, fine on desktop:** check `UrlAddressable`, then form factors, then that the `c__` params are read. Force-quit the app and test in a **new** chat; an old chat keeps the old render.
- **Text shows but no card:** the renderer or `sourceType` isn't matched. Check that the `complex_data_type_name`, the CLT folder name and the `sourceType` all agree.
- **Wrong card shown, or a card missing its fields:** **every action in the agent needs a unique name.** When three topics all named their action `build_card`, the data of one topic rendered in another topic's card. Use `build_<topic>_card`.
- **Which component rendered?** In Playwright, check `page.locator('c-your-card').count()` and `getRootNode().host.tagName`. A debug line in the template that never appears means a different component rendered.
- **Org differs from local** even after "Changed" in the deploy table: query the Tooling API (`LightningComponentResource.Source`) to confirm what is deployed.
- **Apex imports** (`@salesforce/apex/...`) in a card are a suspect for blank mobile cards. This is **unconfirmed**: an Apex-free variant was still being tested when this was written. An LWC that imports `lightning/navigation` does render on mobile.

## 4. Record links from a card (open an event, open a record)

Use one shared, Apex-free helper component (in the source project, `c/ppOpenRecord` with `openRecord(cmp, recordId, mobile)`).

- **Mobile app:** set `window.location.href = lsc://deeplink/lightning/r/<Object>/<id>/view`. An unhandled scheme doesn't throw, so also start a 1.2 second timer. If the page hasn't fired `pagehide`/`visibilitychange` by then, fall back to `NavigationMixin.Navigate`.
- **Everywhere else:** `NavigationMixin.Navigate` only. **Never** set an `lsc://` location on desktop: Safari shows "Safari cannot open the page because the address is invalid" and then navigates.
- **Object name** comes from the id key prefix: `001` Account, `003` Contact, `00T` Task, `500` Case, `006` Opportunity, `1PO` MngEvent. Unknown prefixes use plain navigation.
- **How the card knows it's on mobile:** desktop never receives the `c__` page-reference params. The card treats itself as mobile when `!this._val && !!this._mob`. Child components (for example a shared card view) take a `mobile` property from the parent. User-agent sniffing isn't needed.
- Use the one helper in every card. A card with its own custom deep-link logic is a separate case and doesn't share the helper's behavior.

## 5. Record-page context in the agent (so it doesn't ask "which account?")

Declare `currentRecordId`, `currentObjectApiName` and `currentPageType` as External mutable string variables, and bind them in the action with `with accountId = @variables.currentRecordId`. The instruction tells the agent to pass the record id as the account or event id and never ask first. The same variable works for any object, so the action decides whether the id is an Account or an event.

## 6. Routing between topics in one agent

- Put the specific topic's router line first and word it as a priority, with explicit "not for" lines on the neighbouring topics.
- The router uses the topic descriptions as well as the router instructions. A sentence such as "if the event already has a speaker it summarises that instead" in one topic's description will attract questions meant for another.
- A request to plan a NEW thing on an existing record page must be carved out in the existing-record topic.

## 7. Data the model narrates versus data Apex computes

Counts, flags, rosters and history are computed in Apex. The model writes only the headline, insights and next step. Put explicit wording rules in the prompt for things the model overstates. For example: say "attended" only when the outcome is Attended, and "no attendance recorded" is not a no-show.
