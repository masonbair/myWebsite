import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Filter = { text: string; test: (row: Row) => boolean };

/** Like hosted PostgREST: each response holds at most `maxRows` rows, and a request whose filters make the URL too long fails. */
export function fakePostgrest(tables: Record<string, Row[]>, limits: { maxRows?: number; maxUrl?: number } = {}) {
  const { maxRows = 1000, maxUrl = 8000 } = limits;
  const urls: string[] = [];

  function query(table: string) {
    const rows = tables[table];
    if (!rows) throw new Error(`fake postgrest: no table ${table}`);
    const filters: Filter[] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let columns = "*";
    let window: [number, number] | null = null;
    let single = false;

    const compare = (op: string, a: unknown, b: string) => {
      if (op === "eq") return String(a) === b;
      if (op === "gte") return a !== null && a !== undefined && String(a) >= b;
      throw new Error(`fake postgrest: no operator ${op}`);
    };

    function run() {
      const url = `/rest/v1/${table}?select=${columns}&${filters.map((f) => f.text).join("&")}`;
      urls.push(url);
      if (url.length > maxUrl) return { data: null, error: { message: "414 URI Too Long" } };
      let out = rows.filter((row) => filters.every((f) => f.test(row)));
      for (const { column, ascending } of [...orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[column] as string | number;
          const y = b[column] as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      const [from, to] = window ?? [0, out.length - 1];
      out = out.slice(from, Math.min(to + 1, from + maxRows));
      const picked = columns === "*" ? out : out.map((row) => Object.fromEntries(columns.split(",").map((c) => [c.trim(), row[c.trim()]])));
      if (single) return { data: picked[0] ?? null, error: null };
      return { data: picked, error: null };
    }

    const chain = {
      select(cols = "*") {
        columns = cols.replace(/\s/g, "");
        return chain;
      },
      eq(column: string, value: unknown) {
        filters.push({ text: `${column}=eq.${String(value)}`, test: (row) => row[column] === value });
        return chain;
      },
      in(column: string, values: unknown[]) {
        filters.push({ text: `${column}=in.(${values.join(",")})`, test: (row) => values.includes(row[column]) });
        return chain;
      },
      or(expr: string) {
        const parts = expr.split(",").map((part) => {
          const [column, op, ...rest] = part.split(".");
          return { column, op, value: rest.join(".") };
        });
        filters.push({ text: `or=(${expr})`, test: (row) => parts.some((p) => compare(p.op, row[p.column], p.value)) });
        return chain;
      },
      order(column: string, options: { ascending?: boolean } = {}) {
        orders.push({ column, ascending: options.ascending ?? true });
        return chain;
      },
      range(from: number, to: number) {
        window = [from, to];
        return chain;
      },
      limit(n: number) {
        window = [0, n - 1];
        return chain;
      },
      maybeSingle() {
        single = true;
        return chain;
      },
      then<T>(resolve: (value: ReturnType<typeof run>) => T, reject?: (reason: unknown) => T) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return chain;
  }

  return { client: { from: query } as unknown as SupabaseClient, urls };
}
