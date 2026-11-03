"use client";

import { Button } from "@pantry/ui/components/button";
import { cn } from "@pantry/ui/lib/utils";
import { useConvex } from "convex/react";
import { ChevronRightIcon, DownloadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { collectExport, downloadText, exportFileName, issuesCsv } from "../../import/export";
import type { SourceId } from "../../import/engine";
import { BetaBadge, ImportFlow } from "../../import/import-flow";
import { SOURCES } from "../../import/sources";
import type { WorkspaceData } from "../../shell/app-shell";
import { describeError } from "../form-error";
import { SettingsGroup, SettingsList, SettingsPanel } from "./parts";

/**
 * Settings → Import and Export. Importing is owner only (it creates spaces and labels for everyone;
 * convex/imports.ts enforces it). Any member can export, since they can read all of it anyway.
 */
export function ImportExportSettings({ data }: { data: WorkspaceData }) {
  const isOwner = data.me.role === "owner";
  const [importing, setImporting] = useState<SourceId | null>(null);
  return (
    <SettingsPanel
      title="Import and Export"
      description="Bring your issues in from another tracker or a spreadsheet, or download everything in this workspace."
    >
      {importing ? (
        <ImportFlow
          key={importing}
          data={data}
          source={importing}
          onClose={() => setImporting(null)}
        />
      ) : (
        <SettingsGroup title="Import">
          {isOwner ? (
            <SettingsList>
              {SOURCES.map((source) => (
                <li key={source.id}>
                  <button
                    type="button"
                    onClick={() => setImporting(source.id)}
                    className="group hover:bg-accent flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors duration-(--duration-instant)"
                  >
                    <SourceMark letter={MARKS[source.id]} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-foreground flex items-center gap-2">
                        {source.name}
                        {source.beta && <BetaBadge />}
                      </span>
                      <span className="text-muted-foreground text-xs">{source.howToExport}</span>
                    </span>
                    <ChevronRightIcon
                      className="text-faint-foreground group-hover:text-muted-foreground size-3.5"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </SettingsList>
          ) : (
            <p className="text-muted-foreground text-sm">
              Only the workspace owner can import, since an import creates spaces and labels for
              everyone.
            </p>
          )}
        </SettingsGroup>
      )}
      {!importing && <ExportGroup slug={data.workspace.slug} />}
    </SettingsPanel>
  );
}

const MARKS: Record<SourceId, string> = {
  linear: "L",
  asana: "A",
  shortcut: "S",
  jira: "J",
  csv: "CSV",
};

/** A monochrome stand-in for the source's logo: settings stay colourless. */
function SourceMark({ letter }: { letter: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "border-border bg-gray-2 text-foreground flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border px-1 font-mono text-xs",
        letter.length > 1 && "text-2xs",
      )}
    >
      {letter}
    </span>
  );
}

function ExportGroup({ slug }: { slug: string }) {
  const convex = useConvex();
  const [busy, setBusy] = useState<null | "json" | "csv">(null);
  const [read, setRead] = useState(0);

  async function run(kind: "json" | "csv") {
    if (busy) return;
    setBusy(kind);
    setRead(0);
    try {
      const data = await collectExport(convex, setRead);
      if (kind === "json") {
        downloadText(
          `${JSON.stringify(data, null, 2)}\n`,
          exportFileName(slug, "json"),
          "application/json",
        );
      } else {
        downloadText(issuesCsv(data), exportFileName(slug, "csv"), "text/csv;charset=utf-8");
      }
      toast.success(
        `Exported ${data.issues.length} ${data.issues.length === 1 ? "issue" : "issues"}.`,
      );
    } catch (err) {
      toast.error(describeError(err, "Couldn't export the workspace."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsGroup title="Export">
      <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground">JSON</span> has everything as stored: spaces, projects,
          labels, statuses, members, context docs, issues with their sub-issues and comments, and
          activity. <span className="text-foreground">CSV</span> has one row per issue, for
          spreadsheets.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void run("json")}
            data-icon="inline-start"
          >
            <DownloadIcon />
            {busy === "json" ? "Exporting…" : "Download JSON"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void run("csv")}
            data-icon="inline-start"
          >
            <DownloadIcon />
            {busy === "csv" ? "Exporting…" : "Download issues CSV"}
          </Button>
          {busy && (
            <span className="text-muted-foreground tabular text-xs" aria-live="polite">
              {read} issues read
            </span>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}
