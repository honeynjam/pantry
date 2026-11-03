import { asana } from "./asana";
import { csvHeaders } from "./csv";
import type { SourceId } from "./engine";
import { jira } from "./jira";
import { linear } from "./linear";
import { other } from "./other";
import { shortcut } from "./shortcut";
import type { Adapter } from "./source";

/** Every import source, in the order Settings → Import and Export lists them. */
export const SOURCES: Adapter[] = [linear, asana, shortcut, jira, other];

export function adapterFor(id: SourceId): Adapter {
  return SOURCES.find((source) => source.id === id)!;
}

/** The source whose export a file is, from its header row; "csv" when it's none of them. */
export function detectSource(text: string): SourceId {
  const headers = csvHeaders(text);
  return SOURCES.find((source) => source.id !== "csv" && source.detect(headers))?.id ?? "csv";
}
