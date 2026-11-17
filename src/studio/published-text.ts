/**
 * Where the iPad's text comes from. LSC Mobile reads every label from the
 * profile's metadata cache: the user's `translations/<language>.json` (else
 * en_US), then the cache's own metadata, then the raw value. These resolvers
 * follow lifesciences-ios and say which step gave the text the rep sees, so the
 * preview can show it and SIs can find where to change it.
 */

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const obj = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};

/** One place the app looks for the text, in order; `value` is null when it found nothing there. */
export interface TextStep {
  source: string;
  value: string | null;
}

export interface TextOrigin {
  /** The text the rep sees. */
  shown: string;
  steps: TextStep[];
  /** Index of the step that gave `shown`. */
  used: number;
  /** What an en_US user of the same cache sees, when the preview is in another language. */
  english?: string;
  /** Where to change it, in Setup words. */
  change: string;
  /** A custom label with no translation for this language: the app falls back to its default-language value. */
  labelFallback?: { key: string; language: string };
}

/** The parts of one `translations/<language>.json` the preview reads. */
export interface Translation {
  /** The file's language code (`de`). */
  language: string;
  tabs: Record<string, { label: string }>;
  layouts: Record<
    string,
    { sections: Record<string, string>; relatedLists: Record<string, string> }
  >;
  fields: Record<
    string,
    {
      labels: Record<string, string>;
      nameFieldLabel?: string;
      /** Field → master label → translation (non-empty only). */
      picklists?: Record<string, Record<string, string>>;
    }
  >;
  objects: Record<
    string,
    { label?: string; labelPlural?: string; recordTypes: Record<string, string> }
  >;
  /** Custom labels by lowercased name (Translation.init lowercases the keys). */
  labels: Record<string, { value: string; language: string }>;
  /** TranslatedFlexiPage: `items` (regions, then components by index) and `tabs` (raw title → title). */
  flexiPages: Record<string, Row>;
  /** Standard and global value sets: name → master label → translation (non-empty only). */
  valueSets: Record<string, Record<string, string>>;
}

const nonEmpty = (pairs: [string, string][]) =>
  Object.fromEntries(pairs.filter(([k, v]) => k && v));

/** Read the parts of a translation file the preview uses. */
export function readTranslation(raw: Row, language: string): Translation {
  const objects = obj(raw.objects);
  const out: Translation = {
    language,
    tabs: {},
    layouts: {},
    fields: {},
    objects: {},
    labels: {},
    flexiPages: {},
    valueSets: {},
  };
  for (const [k, t] of Object.entries(obj(raw.tabs)))
    if (str(obj(t).label)) out.tabs[k] = { label: str(obj(t).label) };
  for (const [name, o0] of Object.entries(objects)) {
    const o = obj(o0);
    const objectName = str(o.object) || name;
    for (const l of arr(o.layouts)) {
      if (!str(l.layoutName)) continue;
      out.layouts[str(l.layoutName)] = {
        sections: nonEmpty(arr(l.sections).map((x) => [str(x.section), str(x.label)])),
        relatedLists: nonEmpty(
          arr(l.relatedLists).map((x) => [str(x.relatedList), str(x.relatedListLabel)])
        ),
      };
    }
    const picklists: Record<string, Record<string, string>> = {};
    for (const f of arr(o.fields)) {
      const values = nonEmpty(
        arr(f.picklistValues).map((p) => [str(p.masterLabel), str(p.translation)])
      );
      if (str(f.name) && Object.keys(values).length) picklists[str(f.name)] = values;
    }
    out.fields[objectName] = {
      labels: nonEmpty(arr(o.fields).map((f) => [str(f.name), str(f.label)])),
      ...(str(o.nameFieldLabel) ? { nameFieldLabel: str(o.nameFieldLabel) } : {}),
      ...(Object.keys(picklists).length ? { picklists } : {}),
    };
    out.objects[objectName] = {
      ...(str(o.label) ? { label: str(o.label) } : {}),
      ...(str(o.labelPlural) ? { labelPlural: str(o.labelPlural) } : {}),
      recordTypes: nonEmpty(arr(o.recordTypes).map((r) => [str(r.name), str(r.label)])),
    };
  }
  for (const [k, l] of Object.entries(obj(raw.labels))) {
    const value = str(obj(l).value);
    if (value) out.labels[k.toLowerCase()] = { value, language: str(obj(l).language) };
  }
  for (const [k, p] of Object.entries(obj(raw.flexiPages))) out.flexiPages[k] = obj(p);
  for (const sets of [obj(raw.standardValueSets), obj(raw.globalValueSets)])
    for (const [k, s] of Object.entries(sets)) {
      const values = nonEmpty(
        arr(obj(s).valueTranslation).map((p) => [str(p.masterLabel), str(p.translation)])
      );
      if (Object.keys(values).length && !out.valueSets[k]) out.valueSets[k] = values;
    }
  return out;
}

/** An empty translation, for a cache with no translation files. */
export const NO_TRANSLATION: Translation = readTranslation({}, "");

/** StaticStorage.namespace for LSC. */
const NAMESPACE = "lsc4ce__";

/**
 * TranslationServiceProtocol.localizedString: the key lowercased, then
 * `labels[namespace + key]`, then `labels[key]`, a non-empty value only.
 * (CoreLocalizable.strings comes next on the device; it holds none of the keys looked up here.)
 */
export function lookupLabel(
  tr: Translation,
  key: string
): { value: string; language: string } | null {
  const k = key.toLowerCase();
  return tr.labels[NAMESPACE + k] ?? tr.labels[k] ?? null;
}

const WORKBENCH = "Setup › Translation Workbench › Translate";
const PUBLISH = "Then publish to iPad: the app reads translations from the metadata cache.";

function origin(steps: TextStep[], fallback: string, change: string): TextOrigin {
  const used = steps.findIndex((s) => s.value != null && s.value !== "");
  if (used >= 0) return { shown: str(steps[used].value), steps, used, change };
  return {
    shown: fallback,
    steps: [...steps, { source: "Nothing found: the name is shown", value: fallback }],
    used: steps.length,
    change,
  };
}

/** A `{!$Label.X}` reference's text, as String.localizedValueForLocalizableKey resolves it: the label, else its name. */
function labelRef(tr: Translation, steps: TextStep[], key: string, change: string): TextOrigin {
  const found = lookupLabel(tr, key);
  const all: TextStep[] = [
    ...steps,
    { source: `Custom label ${key}`, value: found ? found.value : null },
    { source: "No such label: the label's name is shown", value: key },
  ];
  const used = found ? all.length - 2 : all.length - 1;
  const o: TextOrigin = {
    shown: found ? found.value : key,
    steps: all,
    used,
    change: `Setup › Custom Labels › ${key}: add a local translation for the language. ${PUBLISH}`,
  };
  if (found && tr.language && found.language && found.language !== tr.language)
    o.labelFallback = { key, language: found.language };
  if (!found) o.change = `Create the custom label ${key}, or fix the reference. ${change}`;
  return o;
}

const LABEL_REF = /^\{!\$Label\.([^}]+)\}$/;

/** MetadataNavigation.init: a non-empty translated tab label wins, else the tab's label, else its name. */
export function tabTextOrigin(tr: Translation, fullName: string, label: string): TextOrigin {
  return origin(
    [
      { source: `Translation: tab ${fullName}`, value: tr.tabs[fullName]?.label ?? null },
      { source: "Tab label in the metadata cache", value: label || null },
    ],
    fullName,
    `${WORKBENCH} › Custom Tab (standard object tabs: Setup › Rename Tabs and Labels). ${PUBLISH}`
  );
}

/**
 * MetadataSobjectField.init + TitleLabel: RecordTypeId is always "Record Type",
 * Name takes the translated name field label, Type (outside Account) is "Type";
 * otherwise the translated label, else the object's field label, else the
 * layout item's, else the API name.
 */
export function fieldTextOrigin(
  tr: Translation,
  sobject: string,
  name: string,
  describedLabel: string,
  itemLabel: string
): TextOrigin {
  const custom = /__c$/i.test(name);
  const change = custom
    ? `${WORKBENCH} › Custom Field (${sobject}). ${PUBLISH}`
    : `Setup › Rename Tabs and Labels (${sobject}), or ${WORKBENCH} › Custom Field. ${PUBLISH}`;
  const fixed = (shown: string, why: string): TextOrigin => ({
    shown,
    steps: [{ source: why, value: shown }],
    used: 0,
    change: "The app always shows this label; it can't be changed.",
  });
  if (name.toLowerCase() === "recordtypeid")
    return fixed("Record Type", "The app always calls this field Record Type");
  const t = tr.fields[sobject];
  if (name === "Name" && t?.nameFieldLabel)
    return {
      shown: t.nameFieldLabel,
      steps: [{ source: `Translation: ${sobject} name field label`, value: t.nameFieldLabel }],
      used: 0,
      change: `${WORKBENCH} › Standard Field or Custom Object (${sobject} name field). ${PUBLISH}`,
    };
  if (name === "Type" && sobject.toLowerCase() !== "account")
    return fixed("Type", "The app always calls Type fields Type outside Account");
  return origin(
    [
      { source: `Translation: field ${sobject}.${name}`, value: t?.labels[name] ?? null },
      { source: "Field label in the metadata cache", value: describedLabel || null },
      { source: "Label on the layout", value: itemLabel || null },
    ],
    name,
    change
  );
}

/** String.separatedWithSpaces: a space before every uppercase letter but the first character. */
export function separatedWithSpaces(s: string): string {
  return [...s].map((c, i) => (i > 0 && c.toLowerCase() !== c ? ` ${c}` : c)).join("");
}

/** MetadataLayoutSection.label: the translation, else the section's label (spaced out when it looks like an API name). */
export function sectionTextOrigin(tr: Translation, layout: string, section: Row): TextOrigin {
  const raw = str(section.label);
  const translated = tr.layouts[layout]?.sections[raw] || null;
  const label = translated || raw;
  const spaced =
    label === raw &&
    str(section.customLabel) !== "true" &&
    section.customLabel !== true &&
    !raw.includes(" ");
  const shown = spaced ? separatedWithSpaces(raw) : label;
  return {
    shown,
    steps: [
      { source: `Translation: section "${raw}" of the layout`, value: translated },
      {
        source:
          spaced && shown !== raw
            ? `Section label "${raw}", spaced out`
            : "Section label on the layout",
        value: shown,
      },
    ],
    used: translated && !spaced ? 0 : 1,
    change: `${WORKBENCH} › Layout Section (${layout}). ${PUBLISH}`,
  };
}

/** A related list's label: the translation, else the layout's label, else one made from its name. */
export function relatedTextOrigin(tr: Translation, layout: string, related: Row): TextOrigin {
  const rl = str(related.relatedList);
  return origin(
    [
      {
        source: `Translation: related list ${rl} on the layout`,
        value: tr.layouts[layout]?.relatedLists[rl] || null,
      },
      {
        source: "Related list label on the layout",
        value: str(related.relatedListLabel) || str(related.label) || null,
      },
      {
        source: "Made from the related list's name",
        value: rl.replace(/^RelatedList$/, "").replace(/__r$|__c$/g, "") || null,
      },
    ],
    rl,
    `${WORKBENCH} › Related List Label (${layout}). ${PUBLISH}`
  );
}

/** MetadataComponentInstanceProperty.StandartTabTitle: custom labels named Details, Related and Lines, in English when the org has none. */
const STANDARD_TABS: Record<string, string> = {
  "Standard.Tab.detail": "Details",
  "Standard.Tab.relatedLists": "Related",
  "Standard.Tab.transactionLines": "Lines",
};

/**
 * A Lightning page tab's title (MetadataComponentInstanceProperty.init, `title`):
 * Standard.Tab.* is the Details / Related / Lines label; otherwise the page
 * translation's title for the tab (matched by position), else the translation's
 * `tabs` map (only when the page has no translation item), else the raw title.
 * Shown through String.localizedValueForLocalizableKey, so a `{!$Label.X}`
 * title is the label's text, or X when there's no such label.
 */
export function recordTabTextOrigin(
  tr: Translation,
  page: string,
  raw: string,
  translatedItem: Row | null
): TextOrigin {
  const pageChange = `${WORKBENCH} › Lightning Page (${page}). ${PUBLISH}`;
  const std = STANDARD_TABS[raw];
  if (std) {
    const found = lookupLabel(tr, std);
    const o: TextOrigin = {
      shown: found ? found.value : std,
      steps: [
        { source: `Custom label ${std}`, value: found ? found.value : null },
        { source: "The app's English default", value: std },
      ],
      used: found ? 0 : 1,
      change: `The app looks for a custom label named ${std}. Create it (Setup › Custom Labels) with a local translation to change this title. ${PUBLISH}`,
    };
    if (found && tr.language && found.language && found.language !== tr.language)
      o.labelFallback = { key: std, language: found.language };
    return o;
  }
  const steps: TextStep[] = [];
  let value: string;
  if (translatedItem) {
    const title = translatedItem.title == null ? null : str(translatedItem.title);
    steps.push({ source: "Translation: this tab's title on the page", value: title });
    steps.push({ source: "Tab title on the page", value: raw });
    value = title ?? raw;
  } else {
    const mapped = str(obj(tr.flexiPages[page]?.tabs)[raw]) || null;
    steps.push({ source: "Translation: the page's tab titles", value: mapped });
    steps.push({ source: "Tab title on the page", value: raw });
    value = mapped ?? raw;
  }
  // The first step with a value gave `value`; a $Label reference resolves after it.
  const ref = LABEL_REF.exec(value);
  if (ref) return labelRef(tr, steps, ref[1], pageChange);
  const used = steps.findIndex((s) => s.value === value);
  return { shown: value, steps, used, change: pageChange };
}

/** MetadataPicklistValueObject: a non-empty translation by master label, else the label. */
export function picklistLabel(
  tr: Translation,
  sobject: string,
  field: string,
  valueSet: string | null,
  label: string
): string {
  const own = tr.fields[sobject]?.picklists?.[field];
  // getMissingTranslatedPicklistValues: a field with no picklist translations takes its value set's.
  const values = own ?? (valueSet ? tr.valueSets[valueSet] : undefined);
  return values?.[label] || label;
}

/** MetadataRecordType.init: a non-empty translated record type label wins. */
export function recordTypeLabel(
  tr: Translation,
  sobject: string,
  name: string,
  label: string
): string {
  return tr.objects[sobject]?.recordTypes[name] || label;
}

/** The page translation's item for one region (by type and name), then for components by position. */
export function translatedRegion(tr: Translation, page: string, region: Row): Row | null {
  const items = arr(tr.flexiPages[page]?.items);
  return (
    items.find((i) => str(i.type) === str(region.type) && str(i.name) === str(region.name)) ?? null
  );
}

export const translatedChild = (item: Row | null, index: number): Row | null =>
  item ? (arr(item.items)[index] ?? null) : null;

/**
 * Salesforce's language names for the codes a cache can hold. Codes not here
 * are shown as the code.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  en_US: "English",
  en_GB: "English (UK)",
  de: "German",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  es_MX: "Spanish (Mexico)",
  ja: "Japanese",
  ko: "Korean",
  zh_CN: "Chinese (Simplified)",
  zh_TW: "Chinese (Traditional)",
  pt_BR: "Portuguese (Brazil)",
  pt_PT: "Portuguese (European)",
  nl_NL: "Dutch",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  ru: "Russian",
  pl: "Polish",
  cs: "Czech",
  hu: "Hungarian",
  tr: "Turkish",
  th: "Thai",
  iw: "Hebrew",
  el: "Greek",
  ro: "Romanian",
  bg: "Bulgarian",
  uk: "Ukrainian",
  vi: "Vietnamese",
  in: "Indonesian",
  fr_CA: "French (Canada)",
};
