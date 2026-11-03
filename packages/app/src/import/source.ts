import type { FoldField, Parsed, SourceId, SourceIssue } from "./engine";

/**
 * What a source adapter is: how to recognise its export, read it into `SourceIssue`s and which of its
 * fields go into the note. Everything after that (review, plan, batches, re-imports) is the engine's.
 */

export type SourceFile = { name: string; text: string };

/** Choices a source offers in the review (Asana: one space or one each; Jira: epics as projects). */
export type SourceSettings = {
  toggles: Record<string, boolean>;
  /** Other CSV only: field → column header ("" for none). */
  columns: Record<string, string>;
};

export type Toggle = { id: string; label: string; hint?: string };

export type Adapter = {
  id: SourceId;
  name: string;
  /** How notes and comments name the source ("Imported from Jira: …"). */
  noteName: string;
  /** Built from documentation and examples, not yet from customers' files. */
  beta: boolean;
  /** Takes several files in one import (Asana: one per project; Jira: one per batch of 10,000). */
  multiFile: boolean;
  /** One line: where the export is. */
  howToExport: string;
  /** What becomes a space ("team", "Asana project"…), and the review's hint for it. */
  teamTitle: string;
  teamHint: string;
  foldFields: FoldField[];
  /** A new space's key when nothing better comes from the team's name. */
  keyFallback: string;
  /** Whether a file with these headers is this source's export. */
  detect: (headers: string[]) => boolean;
  defaultSettings: (files: SourceFile[]) => SourceSettings;
  /** The toggles worth showing for these files. */
  toggles: (files: SourceFile[], parsed: Parsed) => Toggle[];
  /** Throws when a file isn't this source's export; rows it can't use go in `problems`. */
  parse: (files: SourceFile[], settings: SourceSettings) => Parsed;
};

/**
 * Issues from several files as one list: the first copy of an issue that's in two files (an Asana
 * task in two projects, overlapping Jira exports) is kept, and the others are counted.
 */
export function mergeFiles<I extends SourceIssue>(
  parts: Parsed<I>[],
): Parsed<I> & { duplicates: number } {
  const seen = new Set<string>();
  const issues: I[] = [];
  let duplicates = 0;
  for (const part of parts) {
    for (const issue of part.issues) {
      if (seen.has(issue.externalId)) {
        duplicates += 1;
        continue;
      }
      seen.add(issue.externalId);
      issues.push(issue);
    }
  }
  const dropped = new Map<string, number>();
  for (const part of parts)
    for (const row of part.dropped) dropped.set(row.column, (dropped.get(row.column) ?? 0) + row.count);
  return {
    issues,
    problems: parts.flatMap((part) => part.problems),
    warnings: [
      ...parts.flatMap((part) => part.warnings ?? []),
      ...(duplicates > 0
        ? [
            `${duplicates} ${duplicates === 1 ? "issue is" : "issues are"} in more than one file; each comes in once.`,
          ]
        : []),
    ],
    dropped: [...dropped.entries()].map(([column, count]) => ({ column, count })),
    duplicates,
  };
}

/** "Row 12 of jira-2.csv" or "Row 12" when there's one file. */
export const rowName = (row: number, file: string | undefined, many: boolean) =>
  many && file ? `Row ${row} of ${file}` : `Row ${row}`;

/** Up to `max` examples, then how many more. */
export function someOf(items: string[], max = 3): string {
  if (items.length <= max) return items.join("; ");
  return `${items.slice(0, max).join("; ")} and ${items.length - max} more`;
}

/** A short, stable hash (FNV-1a, base 36) for ids derived from content. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** "Bug" for "bug", "Story" for "story": types read better capitalised as labels. */
export const capitalise = (value: string) =>
  value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;

/** A single-line value for the note, cut to `max` characters. */
export function oneLine(value: string, max = 300): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
