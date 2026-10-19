/** The runner's view of an org: read-only SOQL, describes, the LSC namespace and the connected user. */

import { cachedDescribeSObject, getOrgDisplay } from "../../../salesforce/cli.js";
import { query } from "../../helpers.js";
import { pickFields, plainRow, sqlString } from "./fields.js";
import { RUN_LIMITS, type DescribeInfo, type OrgReader, type Row } from "./types.js";

export function createOrgReader(org: string): OrgReader {
  let namespace: Promise<string | null> | undefined;

  const describe = async (object: string): Promise<DescribeInfo | null> => {
    const res = await cachedDescribeSObject(object, org);
    if (!res.success || !res.data) return null;
    return { name: res.data.name, fields: res.data.fields.map((f) => ({ name: f.name, type: f.type })) };
  };

  return {
    query: (soql) => query(soql, org, false, { allowTruncated: true, maxRows: RUN_LIMITS.rowsPerQuery + 1 }),
    describe,
    namespace: () => {
      namespace ??= query("SELECT NamespacePrefix FROM PackageLicense WHERE NamespacePrefix = 'lsc4ce'", org)
        .then((rows) => (rows.length ? "lsc4ce" : null))
        .catch(() => null);
      return namespace;
    },
    async user(userId?: string): Promise<Row | null> {
      const info = await describe("User");
      if (!info) return null;
      const { fields } = pickFields(info);
      let where: string;
      if (userId) where = `Id = ${sqlString(userId)}`;
      else {
        const display = await getOrgDisplay(org);
        const username = display.success ? display.data?.username : undefined;
        if (!username) return null;
        where = `Username = ${sqlString(username)}`;
      }
      const rows = await query(`SELECT ${fields.join(", ")} FROM User WHERE ${where} LIMIT 1`, org);
      return rows[0] ? plainRow(rows[0]) : null;
    },
  };
}
