import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import SearchPicker from "../../ui/SearchPicker";

export interface PreviewRecord {
  id: string;
  name: string;
}

const clean = (s: string) => s.replace(/[\\"%_]/g, "").slice(0, 60);

/** The user's recently viewed records of an object (UI API MRU list), empty when there are none or the object has no MRU list. */
async function recentRecords(object: string): Promise<PreviewRecord[]> {
  const r = await window.lscApi.studioLwcRequest("GET", `/ui-api/mru-list-records/${encodeURIComponent(object)}?pageSize=10&optionalFields=${encodeURIComponent(`${object}.Name`)}`);
  const body = r.data as { ok?: boolean; data?: { records?: { id: string; fields?: Record<string, { value?: unknown }> }[] } } | undefined;
  if (!body?.ok) return [];
  return (body.data?.records ?? []).map((x) => ({ id: x.id, name: typeof x.fields?.Name?.value === "string" && x.fields.Name.value ? x.fields.Name.value : x.id }));
}

/** Up to 25 records of an object by name, through the same read-only GraphQL the live components use. */
export async function searchRecords(object: string, q: string): Promise<PreviewRecord[]> {
  // With nothing typed, the recently viewed list is a small indexed read; the unfiltered GraphQL query scans a big object and can take many seconds.
  if (!q.trim()) {
    const recent = await recentRecords(object).catch(() => []);
    if (recent.length) return recent;
  }
  const ask = async (named: boolean): Promise<PreviewRecord[]> => {
    const where = named && q.trim() ? `, where: { Name: { like: "%${clean(q.trim())}%" } }` : "";
    const query = `query { uiapi { query { ${object}(first: ${q.trim() ? 25 : 10}${where}) { edges { node { Id${named ? " Name { value }" : ""} } } } } } }`;
    const r = await window.lscApi.studioLwcRequest("POST", "/graphql", { query });
    const body = r.data as { ok?: boolean; data?: { data?: { uiapi?: { query?: Record<string, { edges?: { node: { Id: string; Name?: { value?: string } } }[] }> } }; errors?: { message: string }[] } } | undefined;
    const gql = body?.data;
    if (!body?.ok || !gql || gql.errors?.length || !gql.data?.uiapi?.query?.[object]) throw new Error(gql?.errors?.[0]?.message ?? r.error ?? "Couldn't read records.");
    return (gql.data.uiapi.query[object].edges ?? []).map((e) => ({ id: e.node.Id, name: e.node.Name?.value || e.node.Id }));
  };
  try {
    return await ask(true);
  } catch {
    return ask(false);
  }
}

const SYSTEM_FIELD = /^(Id|Name|OwnerId|IsDeleted|SystemModstamp|(Created|LastModified)(By)?(Id|Date)|LastViewedDate|LastReferencedDate|RecordTypeId|.*Id)$/;
const humanize = (api: string) =>
  api
    .replace(/__c$/, "")
    .replace(/_+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

/** A few plain fields of a record (label and shown value) to draw the page behind an action sheet; empty when it can't be read. */
export async function readRecordFacts(id: string, as?: string): Promise<{ label: string; value: string }[]> {
  const path = `/ui-api/records/${id}`;
  const r = as ? await window.lscApi.studioLwcRequestAs(as, "GET", path) : await window.lscApi.studioLwcRequest("GET", path);
  const body = r.data as { ok?: boolean; data?: { fields?: Record<string, { displayValue?: string | null; value?: unknown }> } } | undefined;
  const fields = body?.ok ? body.data?.fields : undefined;
  if (!fields) return [];
  const facts: { label: string; value: string }[] = [];
  for (const [api, f] of Object.entries(fields)) {
    if (SYSTEM_FIELD.test(api)) continue;
    const value = f.displayValue ?? (typeof f.value === "string" || typeof f.value === "number" ? String(f.value) : "");
    if (value && value.length <= 60) facts.push({ label: humanize(api), value });
    if (facts.length === 4) break;
  }
  return facts;
}

interface Props {
  object: string;
  record: PreviewRecord | null;
  onPick: (r: PreviewRecord) => void;
}

/** The record the app previews against: a button showing it, a search dialog behind it. */
export default function RecordPicker({ object, record, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PreviewRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const run = (q: string) => {
    const mine = ++seq.current;
    setSearching(true);
    setError("");
    searchRecords(object, q).then(
      (r) => mine === seq.current && (setOptions(r), setSearching(false)),
      (e: unknown) => mine === seq.current && (setError(e instanceof Error ? e.message : String(e)), setSearching(false))
    );
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button
        type="button"
        className="studio-btn sm bld-record-btn"
        onClick={() => {
          setOpen(true);
          run("");
        }}
        aria-label={`Previewing ${object} ${record?.name ?? "none selected"}. Change record`}
      >
        <Search size={14} aria-hidden="true" />
        <span className="bld-record-name">{record?.name ?? `Pick a ${object}`}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <SearchPicker
          eyebrow={`${object} record`}
          title="Preview with which record?"
          description="The app runs against this record, reading the org live."
          placeholder={`Search ${object} by name`}
          options={options.map((o) => ({ value: o.id, label: o.name, detail: o.id }))}
          emptyTitle={`No ${object} records`}
          searching={searching}
          error={error || undefined}
          onQueryChange={(q) => {
            clearTimeout(timer.current);
            timer.current = setTimeout(() => run(q), 250);
          }}
          onPick={(id) => {
            const r = options.find((o) => o.id === id);
            if (r) onPick(r);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}
