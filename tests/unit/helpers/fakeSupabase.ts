/* eslint-disable @typescript-eslint/no-explicit-any */
// A minimal in-memory stand-in for the Supabase query builder.
//
// It supports exactly the surface the attendance runners use
// (select/update/insert + eq/is/not/gte/in/order/limit/maybeSingle), which is
// enough to exercise the REAL write and audit paths — in particular the guarded
// `.is("clock_out_at", null)` updates that are what actually prevent duplicate
// attendance records. Rows are mutated in place, so a test can assert against
// the object it handed in.

export type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

class Builder {
  private filters: Filter[] = [];
  private mode: "select" | "update" | "insert" = "select";
  private payload: Row | null = null;
  private limitN: number | null = null;
  private orderCol: string | null = null;
  private orderAsc = true;
  private tables: Record<string, Row[]>;
  private table: string;

  constructor(tables: Record<string, Row[]>, table: string) {
    this.tables = tables;
    this.table = table;
  }

  private rows(): Row[] {
    return (this.tables[this.table] ??= []);
  }

  select() {
    return this;
  }
  update(payload: Row) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  insert(payload: Row) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => String(r[col] ?? "") === String(value ?? ""));
    return this;
  }
  is(col: string, value: null) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  // Only ever called as .not(col, "is", null); the operator args are ignored.
  not(col: string) {
    this.filters.push((r) => (r[col] ?? null) !== null);
    return this;
  }
  gte(col: string, value: string) {
    this.filters.push((r) => String(r[col] ?? "") >= value);
    return this;
  }
  in(col: string, values: unknown[]) {
    const set = new Set(values.map(String));
    this.filters.push((r) => set.has(String(r[col])));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  private matched(): Row[] {
    let out = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      const col = this.orderCol;
      out = out.slice().sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        return this.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  private run(): { data: Row[]; error: null } {
    if (this.mode === "insert") {
      const inserted = { id: `row-${this.rows().length + 1}`, ...(this.payload as Row) };
      this.rows().push(inserted);
      return { data: [inserted], error: null };
    }
    const matched = this.matched();
    if (this.mode === "update") {
      for (const row of matched) Object.assign(row, this.payload);
    }
    return { data: matched, error: null };
  }

  async maybeSingle() {
    const { data } = this.run();
    return { data: data[0] ?? null, error: null };
  }

  then(resolve: (value: { data: Row[]; error: null }) => unknown) {
    return Promise.resolve(this.run()).then(resolve);
  }
}

export function makeDb(tables: Record<string, Row[]>) {
  return {
    tables,
    from(table: string) {
      return new Builder(tables, table);
    },
  };
}

/** The audit event types written to jobsite_timecard_events, in insert order. */
export function eventTypes(db: ReturnType<typeof makeDb>): string[] {
  return (db.tables.jobsite_timecard_events ?? []).map((e) => String(e.event_type));
}
