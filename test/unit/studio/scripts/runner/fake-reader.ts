import type { DescribeInfo, OrgReader, Row } from "../../../../../src/studio/scripts/runner/types.js";

export interface FakeReader extends OrgReader {
  soql: string[];
}

/** An in-memory org: rows per object; fields are the union of the rows' keys. */
export function fakeReader(
  data: Record<string, Row[]>,
  options: { namespace?: string | null; user?: Row; filter?: (soql: string, object: string, rows: Row[]) => Row[] } = {},
): FakeReader {
  const soql: string[] = [];
  const describe = async (object: string): Promise<DescribeInfo | null> => {
    const rows = data[object];
    if (!rows) return null;
    const names = new Set<string>(["Id"]);
    for (const r of rows) for (const k of Object.keys(r)) names.add(k);
    return { name: object, fields: [...names].map((name) => ({ name, type: "string" })) };
  };
  return {
    soql,
    describe,
    namespace: async () => options.namespace ?? null,
    user: async () => options.user ?? { Id: "005000000000001AAA", Username: "admin@example.com" },
    query: async (q: string) => {
      soql.push(q);
      const m = /\bFROM\s+([A-Za-z0-9_]+)/i.exec(q);
      const object = m?.[1] ?? "";
      if (!data[object]) throw new Error(`sObject type '${object}' is not supported.`);
      const rows = options.filter ? options.filter(q, object, data[object]) : data[object];
      return rows.slice(0, 501);
    },
  };
}
