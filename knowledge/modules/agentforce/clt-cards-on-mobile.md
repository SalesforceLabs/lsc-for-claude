# Rendering Agentforce Custom Lightning Type (CLT) Cards on the Salesforce Mobile App (iPad/iPhone)

Practitioner-verified field notes. The way the mobile app delivers `c__*` params comes from a component that already works on mobile and from observed behavior, not from official documentation.

## Symptom

The card renders on desktop, but on mobile it shows blank (only the agent's text), or shows the raw fields in a plain list. Deploys succeed and there are no errors.

## What the mobile LWC needs

All five of these were needed. The mobile cards stayed blank until items 3 and 4 were in place.

### 1. A mobile renderer on the CLT

Add `lightningTypes/<clt>/lightningMobileGenAi/renderer.json`:

```json
{"renderer":{"componentOverrides":{"$":{"definition":"c/<lwcName>"}}}}
```

Without it, mobile falls back to a raw-field list. A CLT with only `lightningDesktopGenAi` is desktop-only.

### 2. Both form factors in the LWC `js-meta.xml`

The deploy fails without them:

```xml
<targetConfig targets="lightning__AgentforceOutput">
  <sourceType name="c__<clt>"/>
  <supportedFormFactors>
    <supportedFormFactor type="Small"/>
    <supportedFormFactor type="Large"/>
  </supportedFormFactors>
</targetConfig>
```

A renderer pointing at a component without `Small` is rejected with "Missing supportedFormFactor".

### 3. The `lightning__UrlAddressable` target

This was the last missing piece:

```xml
<targets>
  <target>lightning__AgentforceOutput</target>
  <target>lightning__UrlAddressable</target>
</targets>
```

Without it the card stays blank with no error. The mobile app appears to open the card by URL.

### 4. Read the data from the page reference, not only from `@api value`

On mobile the platform doesn't set `value`. It passes each field of the output as a `c__<fieldName>` state param:

```js
import { LightningElement, api, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';

export default class MyCard extends LightningElement {
    @api value;          // desktop path
    _mob = null;         // mobile path

    @wire(CurrentPageReference)
    wiredPageRef(ref) {
        const s = ref && ref.state;
        if (!s || s.c__channel !== 'Mobile') return;   // only accept the real mobile payload
        const out = {};
        Object.keys(s).forEach((k) => {
            if (k.indexOf('c__') !== 0 || k === 'c__channel') return;
            let v = s[k];
            if (typeof v === 'string' && v !== '') { try { v = JSON.parse(v); } catch (e) {} }  // lists and objects arrive as JSON strings
            out[k.substring(3)] = v;
        });
        if (Object.keys(out).length) this._mob = out;
    }
    get card() { return this.value || this._mob; }   // also JSON.parse it if it's a string
}
```

- **Channel check:** the page reference can re-fire with unrelated state, so accept it only when `c__channel === 'Mobile'`.
- **Lists and objects:** parse each param individually.

### 5. Redeploy and test cleanly

Run a new chat after each deploy. Cards already rendered in an existing chat stay blank. Force-quit the Salesforce app too, because it caches component metadata.

## What turned out NOT to be the cause

The Apex, `lightning/navigation` and `lightning-icon` imports do not break the mobile runtime. A working example imports `lightning/navigation` and runs fine. Don't spend a round building display-only cards on that theory.

## Troubleshooting order

1. **Raw fields, not a blank card:** the CLT has no `lightningMobileGenAi` renderer (item 1).
2. **Deploy error "Missing supportedFormFactor":** add both form factors to the LWC (item 2). If the LWC belongs to another project, don't edit it. Create a separate mobile component instead.
3. **Blank card, no error:** check items 3 and 4 in order. Compare your `js-meta.xml` and JS against a component that already works on mobile. This is the fastest check.
4. **Still blank:** confirm the renderer points at the right component name (`c/<lwcName>`) and that `sourceType` matches the CLT (`c__<clt>`). Then confirm you tested in a fresh chat after force-quitting the app. Confirm the deploy reached the org you're logged into. `sf data query -q "SELECT DeveloperName FROM LightningTypeBundle" --use-tooling-api` lists the deployed CLT bundles.
5. **Compare against a working example:** diff the working example's meta, renderer and JS against yours before theorizing. The fix came from that diff, not from reasoning about the runtime.

## Caveats

- A desktop LWC that writes data (buttons that call Apex) isn't proven on mobile. The cards here are read-only on mobile for now. The Apex-button behavior on mobile is untested.
- A CLT whose component lacks the `Small` form factor can't get a mobile renderer. Add `Small` to that component or build a separate mobile component.
- The details of how the mobile app delivers `c__*` params come from a working example and observed behavior. They are not from official documentation.
