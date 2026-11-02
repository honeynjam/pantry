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
