import Papa from "papaparse";

/**
 * CSV in and out, RFC 4180 (quoted fields with commas, quotes and line breaks inside), via PapaParse.
 * Pure functions, so the import's parsing is tested without a browser.
 */

export type CsvTable = { headers: string[]; rows: Record<string, string>[] };

/** Parses CSV text with a header row. A UTF-8 byte order mark and blank lines are ignored. */
export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const fatal = result.errors.find(
    (error) => error.type === "Quotes" || error.code === "UndetectableDelimiter",
  );
  if (fatal) {
    throw new Error(
      `This file isn't valid CSV (row ${(fatal.row ?? 0) + 2}: ${fatal.message.toLowerCase()}).`,
    );
  }
  return { headers: result.meta.fields ?? [], rows: result.data };
}

/** CSV text for `rows` with `headers` as the first line. Every value is a string or empty. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return Papa.unparse(
    {
      fields: headers,
      data: rows.map((row) =>
        row.map((value) => (value === null || value === undefined ? "" : String(value))),
      ),
    },
    { newline: "\r\n" },
  );
}

/**
 * CSV text as a header row and rows of cells, by position. Jira repeats column names (one "Labels"
 * column per label, one "Comment" per comment…), so a header-keyed object would keep only the last
 * one; `Grid` reads them all.
 */
export type Grid = {
  headers: string[];
  rows: string[][];
};

export function parseCsvGrid(text: string): Grid {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    header: false,
    skipEmptyLines: "greedy",
  });
  const fatal = result.errors.find(
    (error) => error.type === "Quotes" || error.code === "UndetectableDelimiter",
  );
  if (fatal) {
    throw new Error(
      `This file isn't valid CSV (row ${(fatal.row ?? 0) + 1}: ${fatal.message.toLowerCase()}).`,
    );
  }
  const [head = [], ...rows] = result.data;
  return { headers: head.map((header) => header.trim()), rows };
}

/** Reads cells of a `Grid` row by column name, case-insensitively; repeated columns give every value. */
export class Columns {
  private readonly index = new Map<string, number[]>();

  constructor(readonly headers: string[]) {
    headers.forEach((header, position) => {
      const key = header.trim().toLowerCase();
      this.index.set(key, [...(this.index.get(key) ?? []), position]);
    });
  }

  has(name: string): boolean {
    return this.index.has(name.toLowerCase());
  }

  /** The first column of these names that the file has. */
  pick(...names: string[]): string | undefined {
    return names.find((name) => this.has(name));
  }

  /** The first non-empty value of the column (trimmed), or "". */
  get(row: string[], ...names: string[]): string {
    for (const name of names) {
      for (const position of this.index.get(name.toLowerCase()) ?? []) {
        const value = (row[position] ?? "").trim();
        if (value) return value;
      }
    }
    return "";
  }

  /** The raw value (line breaks kept) of the first non-empty column of these names. */
  raw(row: string[], ...names: string[]): string {
    for (const name of names) {
      for (const position of this.index.get(name.toLowerCase()) ?? []) {
        const value = row[position] ?? "";
        if (value.trim()) return value.replace(/\r\n?/g, "\n");
      }
    }
    return "";
  }

  /** Every non-empty value of a (possibly repeated) column, in file order. */
  all(row: string[], name: string): string[] {
    return (this.index.get(name.toLowerCase()) ?? [])
      .map((position) => (row[position] ?? "").replace(/\r\n?/g, "\n").trim())
      .filter(Boolean);
  }

  /** How many rows have a value in the column. */
  count(rows: string[][], name: string): number {
    return rows.filter((row) => this.all(row, name).length > 0).length;
  }
}

/** Just the header row (trimmed), or [] when the text isn't CSV. */
export function csvHeaders(text: string): string[] {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    header: false,
    preview: 1,
    skipEmptyLines: "greedy",
  });
  return (result.data[0] ?? []).map((header) => String(header).trim());
}
