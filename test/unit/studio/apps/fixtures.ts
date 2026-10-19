import type { AppInput } from "../../../../src/studio/apps/types.js";

export const HOME_META = `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>66.0</apiVersion>
    <isExposed>true</isExposed>
    <masterLabel>Smoke</masterLabel>
    <targets>
        <target>lightning__HomePage</target>
        <target>lightning__UrlAddressable</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__HomePage">
            <property name="mobileHeight" type="Integer" default="560" label="Mobile Height" />
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>`;

export const RECORD_META = `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>66.0</apiVersion>
    <isExposed>true</isExposed>
    <masterLabel>Insights</masterLabel>
    <targets>
        <target>lightning__RecordPage</target>
        <target>lightning__RecordAction</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__RecordAction">
            <actionType>ScreenAction</actionType>
        </targetConfig>
        <targetConfig targets="lightning__RecordPage">
            <property name="mobileHeight" type="Integer" default="480" label="Mobile Height" />
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>`;

export const HOME_JS = `import { LightningElement, api } from 'lwc';
export default class Smoke extends LightningElement {
    @api mobileHeight = 560;
    items = [{ id: '1', label: 'One' }];
}
`;
export const HOME_HTML = `<template>
    <template for:each={items} for:item="i">
        <div key={i.id}>{i.label}</div>
    </template>
</template>
`;

export function homeApp(over: Partial<{ js: string; html: string; meta: string }> = {}): AppInput {
  const name = "lscMobileInline_Smoke";
  const f = (ext: string, source: string) => ({ bundle: name, path: `lwc/${name}/${name}.${ext}`, source });
  return {
    name,
    target: "home",
    files: [f("js", over.js ?? HOME_JS), f("html", over.html ?? HOME_HTML), f("js-meta.xml", over.meta ?? HOME_META)],
  };
}

export function recordApp(): AppInput {
  const name = "lscMobileInline_Insights";
  const f = (ext: string, source: string) => ({ bundle: name, path: `lwc/${name}/${name}.${ext}`, source });
  return {
    name,
    target: "record",
    objectApiName: "Account",
    files: [
      f("js", `import { LightningElement, api } from 'lwc';\nexport default class Insights extends LightningElement {\n    @api recordId;\n    @api objectApiName;\n    @api mobileHeight = 480;\n}\n`),
      f("html", `<template><div>{recordId}</div></template>\n`),
      f("js-meta.xml", RECORD_META),
    ],
  };
}

export const ACTION_META = `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>66.0</apiVersion>
    <isExposed>true</isExposed>
    <masterLabel>Log follow-up</masterLabel>
    <targets>
        <target>lightning__RecordAction</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__RecordAction">
            <actionType>ScreenAction</actionType>
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>`;

export const ACTION_JS = `import { LightningElement, api } from 'lwc';
import { CloseActionScreenEvent } from 'lightning/actions';
export default class LogFollowUp extends LightningElement {
    @api recordId;
    @api objectApiName;
    close() { this.dispatchEvent(new CloseActionScreenEvent()); }
}
`;

export function actionApp(over: Partial<{ name: string; js: string; meta: string }> = {}): AppInput {
  const name = over.name ?? "lscMobileQuickAction_LogFollowUp";
  const f = (ext: string, source: string) => ({ bundle: name, path: `lwc/${name}/${name}.${ext}`, source });
  return {
    name,
    target: "action",
    objectApiName: "Account",
    files: [f("js", over.js ?? ACTION_JS), f("html", "<template><button onclick={close}>Done</button></template>\n"), f("js-meta.xml", over.meta ?? ACTION_META)],
  };
}

export const TAB_META = `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>66.0</apiVersion>
    <isExposed>true</isExposed>
    <masterLabel>Daily briefing</masterLabel>
    <targets>
        <target>lightning__Tab</target>
        <target>lightning__AppPage</target>
        <target>lightning__UrlAddressable</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__AppPage">
            <property name="mobileHeight" type="Integer" default="900" label="Mobile Height" />
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>`;

export function tabApp(over: Partial<{ meta: string; tab: AppInput["tab"] }> = {}): AppInput {
  const name = "lscMobileInline_Briefing";
  const f = (ext: string, source: string) => ({ bundle: name, path: `lwc/${name}/${name}.${ext}`, source });
  return {
    name,
    target: "tab",
    tab: over.tab,
    files: [f("js", HOME_JS.replace("Smoke", "Briefing")), f("html", HOME_HTML), f("js-meta.xml", over.meta ?? TAB_META)],
  };
}
