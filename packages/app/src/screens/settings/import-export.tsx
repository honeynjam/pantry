"use client";

import { Button } from "@pantry/ui/components/button";
import { useConvex } from "convex/react";
import { ChevronRightIcon, DownloadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { collectExport, downloadText, exportFileName, issuesCsv } from "../../import/export";
import { LinearImport } from "../../import/linear-import";
import type { WorkspaceData } from "../../shell/app-shell";
import { describeError } from "../form-error";
import { SettingsGroup, SettingsList, SettingsPanel } from "./parts";

/**
 * Settings → Import and Export. Importing is owner only (it creates spaces and labels for everyone;
 * convex/imports.ts enforces it). Any member can export, since they can read all of it anyway.
 */
export function ImportExportSettings({ data }: { data: WorkspaceData }) {
  const isOwner = data.me.role === "owner";
  const [importing, setImporting] = useState(false);
  return (
    <SettingsPanel
      title="Import and Export"
      description="Bring your issues in from another tracker, or download everything in this workspace."
    >
      {importing ? (
        <LinearImport data={data} onClose={() => setImporting(false)} />
      ) : (
        <SettingsGroup title="Import">
          {isOwner ? (
            <SettingsList>
              <li>
                <button
                  type="button"
                  onClick={() => setImporting(true)}
                  className="group hover:bg-accent flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors duration-(--duration-instant)"
                >
                  <LinearMark />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-foreground">Linear</span>
                    <span className="text-muted-foreground text-xs">
                      From Linear&apos;s CSV export: teams, issues, sub-issues, projects, labels and
                      statuses. You review everything before it&apos;s written.
                    </span>
                  </span>
                  <ChevronRightIcon
                    className="text-faint-foreground group-hover:text-muted-foreground size-3.5"
                    aria-hidden
                  />
                </button>
              </li>
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

/** A monochrome stand-in for the source's logo: settings stay colourless. */
function LinearMark() {
  return (
    <span
      aria-hidden
      className="border-border bg-gray-2 text-foreground flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs"
    >
      L
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
