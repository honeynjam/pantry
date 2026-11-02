import { api } from "@pantry/backend/api";
import type { Doc } from "@pantry/backend/dataModel";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toCsv } from "./csv";

/**
 * Export (Settings → Import and Export): reads the workspace through the `exports.*` queries, a page
 * at a time, and builds the files in the browser. The JSON has every row as stored (ids included);
 * the CSV has one line per issue with names instead of ids, for spreadsheets.
 */

export type ExportMeta = FunctionReturnType<typeof api.exports.workspace>;
export type ExportIssue = Doc<"issues"> & { comments: Doc<"comments">[] };
export type WorkspaceExport = ExportMeta & { issues: ExportIssue[]; activity: Doc<"activity">[] };

const PAGE = 200;

/** Everything, with `onProgress` called after each page (issues read so far). */
export async function collectExport(
  convex: ConvexReactClient,
  onProgress: (issues: number) => void = () => {},
): Promise<WorkspaceExport> {
  const meta = await convex.query(api.exports.workspace, {});
  const issues: ExportIssue[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: FunctionReturnType<typeof api.exports.issues> = await convex.query(
      api.exports.issues,
      { paginationOpts: { numItems: PAGE, cursor } },
    );
    issues.push(...page.page);
    onProgress(issues.length);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  const activity: Doc<"activity">[] = [];
  cursor = null;
  for (;;) {
    const page: FunctionReturnType<typeof api.exports.activity> = await convex.query(
      api.exports.activity,
      { paginationOpts: { numItems: PAGE * 4, cursor } },
    );
    activity.push(...page.page);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return { ...meta, issues, activity };
}

const PRIORITY = ["No priority", "Urgent", "High", "Medium", "Low"] as const;
const iso = (ms: number | undefined) => (ms === undefined ? "" : new Date(ms).toISOString());

export const ISSUE_CSV_HEADERS = [
  "Key",
  "Space",
  "Project",
  "Title",
  "Description",
  "Status",
  "Priority",
  "Assignee",
  "Creator",
  "Labels",
  "Parent",
  "Due date",
  "Created",
  "Updated",
  "Completed",
  "Comments",
];

/** One CSV line per issue (sub-issues too), sorted by key, with names in place of ids. */
export function issuesCsv(
  data: Pick<WorkspaceExport, "issues" | "spaces" | "projects" | "statuses" | "labels" | "members">,
): string {
  const byId = <T extends { _id: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row._id as string, row]));
  const spaces = byId(data.spaces);
  const projects = byId(data.projects);
  const statuses = byId(data.statuses);
  const labels = byId(data.labels);
  const members = byId(data.members);
  const issues = byId(data.issues);
  const sorted = [...data.issues].sort(
    (a, b) => a.key.split("-")[0]!.localeCompare(b.key.split("-")[0]!) || a.number - b.number,
  );
  return toCsv(
    ISSUE_CSV_HEADERS,
    sorted.map((issue) => [
      issue.key,
      issue.spaceId ? spaces.get(issue.spaceId)?.name : "",
      issue.projectId ? projects.get(issue.projectId)?.name : "",
      issue.title,
      issue.description,
      statuses.get(issue.statusId)?.name,
      PRIORITY[issue.priority],
      issue.assigneeId ? members.get(issue.assigneeId)?.displayName : "",
      members.get(issue.creatorId)?.displayName,
      issue.labelIds
        .map((id) => labels.get(id)?.name)
        .filter(Boolean)
        .join(", "),
      issue.parentId ? issues.get(issue.parentId)?.key : "",
      issue.dueDate ?? "",
      iso(issue._creationTime),
      iso(issue.updatedAt),
      iso(issue.completedAt),
      issue.comments.length,
    ]),
  );
}

/** "pantry-acme-2026-11-02.json": the workspace's slug and today's date. */
export function exportFileName(slug: string, extension: "json" | "csv", now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return `pantry-${slug || "workspace"}-${extension === "csv" ? "issues-" : ""}${day}.${extension}`;
}

/** Saves `text` as a file through a temporary download link. */
export function downloadText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
