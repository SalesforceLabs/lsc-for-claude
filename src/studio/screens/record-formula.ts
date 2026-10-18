/**
 * Formula fields that read the running user's profile ($Profile.Name). The device downloads the value
 * the server computed for the signed-in rep, but Studio reads the record as the connected admin, so
 * those formulas are re-evaluated here for the viewer. Only IF / OR / AND / NOT, `=` / `<>` / `!=`,
 * string literals and $Profile.Name are understood; anything else returns null (value left as read).
 */

type Value = string | boolean;

export function usesProfileName(formula: string): boolean {
  return /\$Profile\.Name/i.test(formula);
}

export function evalProfileFormula(formula: string, profileName: string): string | null {
  const tokens = formula.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\$Profile\.Name|<>|!=|=|\(|\)|,|[A-Za-z_][A-Za-z0-9_]*|\S/g) ?? [];
  let pos = 0;
  const fail = (): never => {
    throw new Error("unsupported");
  };
  const eat = (t?: string): string => {
    const x = tokens[pos++];
    if (x === undefined || (t !== undefined && x !== t)) return fail();
    return x;
  };
  const truthy = (v: Value) => v === true;

  const expr = (): Value => {
    const left = primary();
    const op = tokens[pos];
    if (op === "=" || op === "<>" || op === "!=") {
      pos++;
      const right = primary();
      return op === "=" ? left === right : left !== right;
    }
    return left;
  };
  const primary = (): Value => {
    const t = eat();
    if (t === "$Profile.Name") return profileName;
    if (t.startsWith('"') || t.startsWith("'")) return t.slice(1, -1);
    if (/^[A-Za-z_]/.test(t) && tokens[pos] === "(") {
      eat("(");
      const results: Value[] = [];
      while (tokens[pos] !== ")") {
        results.push(expr());
        if (tokens[pos] === ",") pos++;
        else if (tokens[pos] !== ")") fail();
      }
      eat(")");
      switch (t.toUpperCase()) {
        case "IF":
          return results.length === 3 ? (truthy(results[0]!) ? results[1]! : results[2]!) : fail();
        case "OR":
          return results.some(truthy);
        case "AND":
          return results.every(truthy);
        case "NOT":
          return !truthy(results[0] ?? false);
        default:
          return fail();
      }
    }
    if (/^TRUE$/i.test(t)) return true;
    if (/^FALSE$/i.test(t)) return false;
    return fail();
  };

  try {
    const v = expr();
    return pos === tokens.length && typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}
