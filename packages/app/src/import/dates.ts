/**
 * Dates as other trackers export them. Jira writes them in the exporter's own format and language
 * ("03/Nov/26 10:15 AM" by default, "03/Okt/26 10:15" for a German profile), Asana and Shortcut use
 * ISO-like dates, spreadsheets anything. Pure, so it's tested without a browser. A value we can't
 * read gives `undefined`, and the adapter lists it in the review instead of guessing.
 */

export type DayOrder = "dmy" | "mdy";

/** Month names and abbreviations (English, German, French, Spanish, Portuguese, Italian, Dutch). */
const MONTHS: [number, string[]][] = [
  [1, ["jan", "janv", "ene", "gen", "januar", "janeiro", "enero"]],
  [2, ["feb", "fev", "fév", "févr", "fevr", "fevereiro", "febrero"]],
  [3, ["mar", "mär", "mrt", "mars", "marzo", "março"]],
  [4, ["apr", "avr", "abr", "avril", "abril", "aprile"]],
  [5, ["may", "mai", "mei", "mag", "mayo", "maio", "maggio"]],
  [6, ["jun", "juin", "giu", "juni", "junio", "junho", "giugno"]],
  [7, ["jul", "juil", "lug", "juli", "julio", "julho", "luglio"]],
  [8, ["aug", "aoû", "aou", "ago", "août", "aout", "agosto", "augustus"]],
  [9, ["sep", "sept", "set", "septembre", "settembre", "setembro", "septiembre"]],
  [10, ["oct", "okt", "out", "ott", "octobre", "octubre", "outubro", "ottobre", "oktober"]],
  [11, ["nov", "novembre", "noviembre", "novembro", "november"]],
  [12, ["dec", "dez", "déc", "dic", "décembre", "decembre", "dezember", "diciembre", "dezembro"]],
];
const ENGLISH = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function monthOf(name: string): number | undefined {
  const word = name.toLowerCase().replace(/\.$/, "");
  const english = ENGLISH.indexOf(word);
  if (english >= 0) return english + 1;
  for (const [month, names] of MONTHS) if (names.includes(word)) return month;
  // "Sept", "Febr", "Janu": the first three letters, when only one month starts that way.
  const start = word.slice(0, 3);
  const matches = MONTHS.filter(([, names]) => names.some((known) => known.startsWith(start)));
  return matches.length === 1 && start.length === 3 ? matches[0]![0] : undefined;
}

const fullYear = (year: number) => (year < 100 ? (year < 70 ? 2000 + year : 1900 + year) : year);

const pad = (value: number) => String(value).padStart(2, "0");

type Parts = { year: number; month: number; day: number; time?: [number, number, number] };

function valid({ year, month, day }: Parts) {
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "10:15 AM", "22:15", "10:15:30 pm", "10.15" → [hours, minutes, seconds]. */
function timeOf(rest: string): [number, number, number] | undefined | null {
  const text = rest.trim();
  if (!text) return undefined;
  const match = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:[.,]\d+)?\s*([ap]\.?m\.?)?$/i.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  const meridiem = match[4]?.toLowerCase().replace(/\./g, "");
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return [hours, minutes, seconds];
}

/**
 * The calendar parts of a date as exporters write it, or undefined. ISO strings with a time zone are
 * left to `Date.parse` by `parseDateTime`; this reads the local-time formats.
 */
function partsOf(value: string, order: DayOrder): Parts | undefined {
  const text = value.trim().replace(/\s+/g, " ");
  // 2026-11-03, 2026/11/03, 2026-11-03 10:15, 2026-11-03T10:15:00
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](.*))?$/.exec(text);
  if (match) return withTime(Number(match[1]), Number(match[2]), Number(match[3]), match[4]);
  // 03/Nov/26 10:15 AM, 3-Nov-2026, 03 Nov 2026 10:15, 3. Okt. 2026
  match = /^(\d{1,2})\.?[-/ ]([\p{L}]+)\.?[-/ ,]+(\d{2}|\d{4})(?:,?\s+(.*))?$/u.exec(text);
  if (match) {
    const month = monthOf(match[2]!);
    return month
      ? withTime(fullYear(Number(match[3])), month, Number(match[1]), match[4])
      : undefined;
  }
  // Nov 3, 2026 10:15 AM; November 3 2026
  match = /^([\p{L}]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})(?:,?\s+(.*))?$/u.exec(text);
  if (match) {
    const month = monthOf(match[1]!);
    return month ? withTime(Number(match[3]), month, Number(match[2]), match[4]) : undefined;
  }
  // 03/11/2026, 11/03/26 10:15, 03.11.2026
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:,?\s+(.*))?$/.exec(text);
  if (match) {
    const [first, second] = [Number(match[1]), Number(match[2])];
    const dayFirst = first > 12 ? true : second > 12 ? false : order === "dmy";
    return withTime(
      fullYear(Number(match[3])),
      dayFirst ? second : first,
      dayFirst ? first : second,
      match[4],
    );
  }
  return undefined;
}

function withTime(year: number, month: number, day: number, rest?: string): Parts | undefined {
  const parts: Parts = { year, month, day };
  if (!valid(parts)) return undefined;
  const time = timeOf(rest ?? "");
  if (time === null) return undefined;
  return time ? { ...parts, time } : parts;
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * A point in time, in ms. ISO strings with a zone are exact; other times are read as the
 * importer's local time (exports don't say which zone they're in); a date alone is noon UTC.
 */
export function parseDateTime(
  value: string | undefined,
  order: DayOrder = "dmy",
): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (ISO_WITH_ZONE.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : undefined;
  }
  const parts = partsOf(text, order);
  if (!parts) return undefined;
  // A day without a time is that day wherever you are: noon UTC keeps it on the same calendar day.
  if (!parts.time) return Date.UTC(parts.year, parts.month - 1, parts.day, 12);
  const [hours, minutes, seconds] = parts.time;
  return new Date(parts.year, parts.month - 1, parts.day, hours, minutes, seconds).getTime();
}

/** A calendar day ("2026-11-03") for a due date, without moving it across time zones. */
export function parseDay(value: string | undefined, order: DayOrder = "dmy"): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const parts = partsOf(text, order);
  if (parts) return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  if (ISO_WITH_ZONE.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined;
  }
  return undefined;
}

/**
 * Whether numeric dates in these values are day-first (03/11/2026 is 3 November) or month-first: a
 * first number above 12 means day-first, a second one above 12 month-first; otherwise `fallback`.
 */
export function guessDayOrder(values: string[], fallback: DayOrder = "dmy"): DayOrder {
  let dmy = 0;
  let mdy = 0;
  for (const value of values) {
    const match = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}\b/.exec(value.trim());
    if (!match) continue;
    if (Number(match[1]) > 12) dmy += 1;
    else if (Number(match[2]) > 12) mdy += 1;
  }
  if (dmy === mdy) return fallback;
  return dmy > mdy ? "dmy" : "mdy";
}

/** The (UTC) calendar day of a timestamp, for notes ("created 2026-11-03"). */
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
