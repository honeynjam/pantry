"use client";

import { api } from "@pantry/backend/api";
import type { Id } from "@pantry/backend/dataModel";
import { Badge } from "@pantry/ui/components/badge";
import { Button, buttonVariants } from "@pantry/ui/components/button";
import { Checkbox } from "@pantry/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pantry/ui/components/dropdown-menu";
import { Input } from "@pantry/ui/components/input";
import { IssueKey } from "@pantry/ui/components/issue-key";
import { LabelChip } from "@pantry/ui/components/label-chip";
import { PriorityGlyph } from "@pantry/ui/components/priority-glyph";
import { PRIORITY_LABEL } from "@pantry/ui/lib/issue-meta";
import { cn } from "@pantry/ui/lib/utils";
import { useConvex, useMutation } from "convex/react";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  FileUpIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { SpaceAvatar } from "../components/space-avatar";
import { StatusPicker } from "../issues/pickers";
import { routes, useNavigation } from "../navigation";
import { describeError, FormError } from "../screens/form-error";
import { SettingsGroup, SettingsList, SettingsRow } from "../screens/settings/parts";
import type { WorkspaceData } from "../shell/app-shell";
import {
  defaultOptions,
  FOLD_FIELDS,
  nameKey,
  parseLinearCsv,
  planImport,
  summarizeLinear,
  targetKey,
  toBatches,
  type ImportContext,
  type ImportPlan,
  type LinearSummary,
  type ParsedLinear,
  type Prepared,
  type ReviewOptions,
  type TeamTarget,
  type WorkspaceInfo,
} from "./linear";

/**
 * Import from Linear: pick the CSV export, review what will happen (nothing is written yet), import
 * with progress, then a summary. The rules live in convex/imports.ts; this screen only proposes the
 * mapping and sends the batches. Importing the same file again is safe: what's already in is skipped.
 */

type Loaded = { fileName: string; parsed: ParsedLinear; summary: LinearSummary };
type RunResult = {
  prepared: Awaited<ReturnType<ReturnType<typeof useMutation<typeof api.imports.prepareLinear>>>>;
  created: number;
  skipped: number;
  renumbered: string[];
  detached: number;
};
type Phase =
  | { kind: "pick"; error: string | null }
  | { kind: "review"; loaded: Loaded }
  | { kind: "running"; loaded: Loaded; plan: ImportPlan; done: number; error: string | null }
  | { kind: "done"; loaded: Loaded; plan: ImportPlan; result: RunResult };

const LOOKUP_CHUNK = 2_000;

export function LinearImport({ data, onClose }: { data: WorkspaceData; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "pick", error: null });

  async function readFile(file: File) {
    try {
      const parsed = parseLinearCsv(await file.text());
      if (parsed.issues.length === 0) throw new Error("This file has no issues in it.");
      setPhase({
        kind: "review",
        loaded: { fileName: file.name, parsed, summary: summarizeLinear(parsed) },
      });
    } catch (err) {
      setPhase({ kind: "pick", error: describeError(err, "Couldn't read that file.") });
    }
  }

  if (phase.kind === "pick")
    return (
      <PickFile error={phase.error} onFile={(file) => void readFile(file)} onCancel={onClose} />
    );
  if (phase.kind === "review")
    return (
      <Review
        data={data}
        loaded={phase.loaded}
        onBack={() => setPhase({ kind: "pick", error: null })}
        onImport={(plan) =>
          setPhase({ kind: "running", loaded: phase.loaded, plan, done: 0, error: null })
        }
      />
    );
  if (phase.kind === "running")
    return (
      <Running
        key={phase.error === null ? "run" : "failed"}
        phase={phase}
        onProgress={(done) =>
          setPhase((current) => (current.kind === "running" ? { ...current, done } : current))
        }
        onError={(error) =>
          setPhase((current) => (current.kind === "running" ? { ...current, error } : current))
        }
        onRetry={() => setPhase({ ...phase, error: null, done: 0 })}
        onDone={(result) =>
          setPhase({ kind: "done", loaded: phase.loaded, plan: phase.plan, result })
        }
      />
    );
  return <Done phase={phase} onClose={onClose} />;
}

// ---------------------------------------------------------------------------------------------
// 1. Pick the file
// ---------------------------------------------------------------------------------------------

function PickFile({
  error,
  onFile,
  onCancel,
}: {
  error: string | null;
  onFile: (file: File) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  }
  return (
    <SettingsGroup
      title="Import from Linear"
      actions={
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      }
    >
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center transition-colors duration-(--duration-instant)",
          over && "border-gray-8 bg-accent",
        )}
      >
        <FileUpIcon className="text-muted-foreground size-5" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-foreground text-sm">Drop Linear&apos;s CSV export here</p>
          <p className="text-muted-foreground text-xs">
            In Linear: Settings → Import / Export → Export CSV. The file is read in this browser;
            nothing is written until you review it and press Import.
          </p>
        </div>
        <Button variant="secondary" onClick={() => input.current?.click()} data-icon="inline-start">
          <FileUpIcon />
          Choose CSV file
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Linear CSV export"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />
      </div>
      <FormError message={error} />
    </SettingsGroup>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Review: what Import will do, with the mapping to change
// ---------------------------------------------------------------------------------------------

function workspaceInfo(data: WorkspaceData): WorkspaceInfo {
  return {
    statuses: data.statuses,
    spaces: data.spaces,
    labels: data.labels,
    projects: data.projects,
    members: data.members,
  };
}

/** imports.linearContext, in chunks of issue ids (a big file has more than one query may look up). */
function useImportContext(summary: LinearSummary, parsed: ParsedLinear) {
  const convex = useConvex();
  const [context, setContext] = useState<ImportContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const ids = parsed.issues.map((issue) => issue.externalId);
      const merged: ImportContext = { teams: {}, people: {}, imported: {} };
      for (let start = 0; start === 0 || start < ids.length; start += LOOKUP_CHUNK) {
        const first = start === 0;
        const part = await convex.query(api.imports.linearContext, {
          teams: first ? summary.teams.map((team) => team.name) : [],
          emails: first
            ? summary.people.map((row) => row.value).filter((value) => value.includes("@"))
            : [],
          externalIds: ids.slice(start, start + LOOKUP_CHUNK),
        });
        Object.assign(merged.teams, part.teams);
        Object.assign(merged.people, part.people);
        Object.assign(merged.imported, part.imported);
      }
      if (live) setContext(merged);
    })().catch(
      (err: unknown) => live && setError(describeError(err, "Couldn't check the workspace.")),
    );
    return () => {
      live = false;
    };
  }, [convex, parsed, summary]);
  return { context, error };
}

function Review({
  data,
  loaded,
  onBack,
  onImport,
}: {
  data: WorkspaceData;
  loaded: Loaded;
  onBack: () => void;
  onImport: (plan: ImportPlan) => void;
}) {
  const { context, error } = useImportContext(loaded.summary, loaded.parsed);
  const header = (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-foreground min-w-0 truncate font-medium">{loaded.fileName}</span>
      <span className="text-muted-foreground tabular shrink-0 text-xs">
        {loaded.parsed.issues.length} issues
      </span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onBack}>
        Choose another file
      </Button>
    </div>
  );
  if (error || !context)
    return (
      <div className="flex flex-col gap-3">
        {header}
        {error ? (
          <FormError message={error} />
        ) : (
          <p className="text-muted-foreground text-sm">Checking the workspace…</p>
        )}
      </div>
    );
  return (
    <ReviewForm
      data={data}
      loaded={loaded}
      context={context}
      header={header}
      onBack={onBack}
      onImport={onImport}
    />
  );
}

function ReviewForm({
  data,
  loaded,
  context,
  header,
  onBack,
  onImport,
}: {
  data: WorkspaceData;
  loaded: Loaded;
  context: ImportContext;
  header: ReactNode;
  onBack: () => void;
  onImport: (plan: ImportPlan) => void;
}) {
  const workspace = useMemo(() => workspaceInfo(data), [data]);
  const [options, setOptions] = useState<ReviewOptions>(() =>
    defaultOptions(loaded.parsed, loaded.summary, workspace, context),
  );
  const plan = useMemo(
    () => planImport(loaded.parsed, loaded.summary, options, workspace, context),
    [context, options, loaded, workspace],
  );

  const set = (patch: Partial<ReviewOptions>) => setOptions({ ...options, ...patch });
  const blocked = plan.problems.length > 0 || plan.counts.issues === 0;
  return (
    <div className="flex flex-col gap-8">
      {header}
      <Counts plan={plan} />

      <SettingsGroup title="Teams" hint="Each Linear team goes into a space.">
        <SettingsList>
          {loaded.summary.teams.map((team) => (
            <TeamRow
              key={team.name}
              team={team}
              data={data}
              workspace={workspace}
              target={options.teams[team.name]!}
              onChange={(target) => set({ teams: { ...options.teams, [team.name]: target } })}
            />
          ))}
        </SettingsList>
      </SettingsGroup>

      <SettingsGroup title="Statuses" hint="Linear status → Pantry status.">
        <SettingsList>
          {loaded.summary.statuses.map((status) => (
            <SettingsRow key={status.name}>
              <span className="text-foreground min-w-0 flex-1 truncate">{status.name}</span>
              <Count value={status.count} />
              <ArrowRightIcon className="text-faint-foreground size-3.5 shrink-0" aria-hidden />
              <div className="w-44 shrink-0">
                <StatusPicker
                  variant="full"
                  statuses={data.statuses}
                  value={options.statuses[nameKey(status.name)] as Id<"statuses">}
                  onChange={(statusId) =>
                    set({ statuses: { ...options.statuses, [nameKey(status.name)]: statusId } })
                  }
                />
              </div>
            </SettingsRow>
          ))}
        </SettingsList>
      </SettingsGroup>

      <SettingsGroup title="Priorities" hint="Same five as Linear.">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {loaded.summary.priorities
            .filter((row) => row.count > 0)
            .map((row) => (
              <span key={row.priority} className="text-foreground inline-flex items-center gap-1.5">
                <PriorityGlyph priority={row.priority} />
                {PRIORITY_LABEL[row.priority]}
                <Count value={row.count} />
              </span>
            ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="People" hint="Matched to members by sign-in email.">
        <SettingsList>
          {plan.people.map((person) => (
            <SettingsRow key={person.value}>
              <span className="text-foreground min-w-0 flex-1 truncate">{person.value}</span>
              <Count value={person.count} />
              <ArrowRightIcon className="text-faint-foreground size-3.5 shrink-0" aria-hidden />
              <span
                className={cn(
                  "w-44 shrink-0 truncate text-sm",
                  !person.member && "text-muted-foreground",
                )}
              >
                {person.member ? person.member.displayName : "Not a member"}
              </span>
            </SettingsRow>
          ))}
        </SettingsList>
        {plan.people.some((person) => !person.member) && (
          <p className="text-muted-foreground text-xs">
            Issues of people who aren&apos;t members come in unassigned (created by you), with their
            email in the note at the end of the description. Invite them first to keep them.
          </p>
        )}
      </SettingsGroup>

      <ProjectsAndLabels plan={plan} data={data} workspace={workspace} options={options} />

      <SettingsGroup title="Linear-only fields" hint="Pantry has no field for these.">
        <div className="border-border flex flex-col gap-2.5 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            Checked fields go into a short note at the end of each issue&apos;s description.
          </p>
          {FOLD_FIELDS.filter(
            (field) => field.id === "dates" || loaded.summary.folded[field.id] > 0,
          ).map((field) => (
            <label key={field.id} className="text-foreground flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={options.fold[field.id]}
                onCheckedChange={(checked) =>
                  set({ fold: { ...options.fold, [field.id]: checked === true } })
                }
              />
              <span className="min-w-0 flex-1">{field.label}</span>
              <Count value={loaded.summary.folded[field.id]} />
            </label>
          ))}
          {loaded.summary.dropped.some((row) => row.count > 0) && (
            <p className="text-muted-foreground border-border border-t pt-2.5 text-xs">
              Not imported:{" "}
              {loaded.summary.dropped
                .filter((row) => row.count > 0)
                .map((row) => `${row.column} (${row.count})`)
                .join(", ")}
              . Pantry keeps its own update times.
            </p>
          )}
        </div>
      </SettingsGroup>

      {loaded.summary.archived > 0 && (
        <SettingsGroup title="Archived in Linear">
          <label className="text-foreground flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={options.includeArchived}
              onCheckedChange={(checked) => set({ includeArchived: checked === true })}
            />
            Include {loaded.summary.archived} archived{" "}
            {loaded.summary.archived === 1 ? "issue" : "issues"}
          </label>
        </SettingsGroup>
      )}

      {plan.problems.length > 0 && (
        <div className="flex flex-col gap-1" role="alert">
          {plan.problems.map((problem) => (
            <FormError key={problem} message={problem} />
          ))}
        </div>
      )}

      <div className="border-border flex items-center gap-3 border-t pt-4">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs">
          {plan.counts.issues === 0
            ? "Everything in this file is already in Pantry."
            : "Safe to run again: issues already imported are skipped."}
        </p>
        <Button variant="ghost" onClick={onBack}>
          Cancel
        </Button>
        <Button disabled={blocked} onClick={() => onImport(plan)}>
          Import {plan.counts.issues} {plan.counts.issues === 1 ? "issue" : "issues"}
        </Button>
      </div>
    </div>
  );
}

const Count = ({ value }: { value: number }) => (
  <span className="text-muted-foreground tabular shrink-0 font-mono text-xs">{value}</span>
);

function Counts({ plan }: { plan: ImportPlan }) {
  const { counts } = plan;
  const spaces = counts.newSpaces + counts.existingSpaces;
  const items: { label: string; value: number; hint?: string }[] = [
    {
      label: "Spaces",
      value: spaces,
      hint: counts.newSpaces ? `${counts.newSpaces} new` : "existing",
    },
    {
      label: "Projects",
      value: plan.teams.reduce((sum, team) => sum + team.projects.length, 0),
      hint: `${counts.newProjects} new`,
    },
    { label: "Labels", value: plan.labels.length, hint: `${counts.newLabels} new` },
    { label: "Issues", value: counts.issues, hint: `${counts.subIssues} sub-issues` },
    {
      label: "Skipped",
      value: counts.archivedSkipped + counts.alreadyImported,
      hint:
        [
          counts.archivedSkipped ? `${counts.archivedSkipped} archived` : "",
          counts.alreadyImported ? `${counts.alreadyImported} already in` : "",
        ]
          .filter(Boolean)
          .join(", ") || "none",
    },
  ];
  return (
    <dl className="border-border divide-border grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border sm:grid-cols-5 sm:divide-y-0">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5 px-3 py-2.5">
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd className="text-foreground tabular font-mono text-lg leading-6">{item.value}</dd>
          <dd className="text-muted-foreground truncate text-xs">{item.hint}</dd>
        </div>
      ))}
    </dl>
  );
}

function TeamRow({
  team,
  data,
  workspace,
  target,
  onChange,
}: {
  team: LinearSummary["teams"][number];
  data: WorkspaceData;
  workspace: WorkspaceInfo;
  target: TeamTarget;
  onChange: (target: TeamTarget) => void;
}) {
  const [draft, setDraft] = useState<{ name: string; key: string }>(
    target.kind === "new"
      ? { name: target.name, key: target.key }
      : { name: team.name, key: team.prefix },
  );
  const space =
    target.kind === "existing" ? data.spaces.find((row) => row._id === target.spaceId) : undefined;
  const key = targetKey(target, workspace);
  const keeps = key === team.prefix;
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <span className="text-foreground min-w-0 flex-1 truncate">{team.name}</span>
        <Count value={team.count} />
        <ArrowRightIcon className="text-faint-foreground size-3.5 shrink-0" aria-hidden />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" className="w-44 justify-start" data-icon="inline-end" />
            }
          >
            {space ? (
              <SpaceAvatar space={space} size="xs" />
            ) : (
              <PlusIcon className="text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-left">
              {space ? space.name : "New space"}
            </span>
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Import {team.name} into</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={target.kind === "new" ? "new" : target.spaceId}
                onValueChange={(value) =>
                  onChange(
                    value === "new"
                      ? { kind: "new", ...draft }
                      : { kind: "existing", spaceId: String(value) },
                  )
                }
              >
                <DropdownMenuRadioItem value="new" closeOnClick>
                  <PlusIcon />
                  New space
                </DropdownMenuRadioItem>
                {data.spaces.length > 0 && <DropdownMenuSeparator />}
                {data.spaces.map((row) => (
                  <DropdownMenuRadioItem key={row._id} value={row._id} closeOnClick>
                    <SpaceAvatar space={row} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">{row.key}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {target.kind === "new" && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Name of ${team.name}'s new space`}
            value={target.name}
            maxLength={80}
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value });
              onChange({ ...target, name: event.target.value });
            }}
            className="min-w-0 flex-1"
          />
          <Input
            aria-label={`Key of ${team.name}'s new space`}
            value={target.key}
            maxLength={10}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setDraft({ ...draft, key: next });
              onChange({ ...target, key: next });
            }}
            className="w-24 font-mono uppercase"
          />
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {keeps ? (
          <>
            Keeps Linear&apos;s numbers: <IssueKey value={`${team.prefix}-${team.maxNumber}`} />{" "}
            stays <IssueKey value={`${team.prefix}-${team.maxNumber}`} />. A number already used in
            Pantry gets the next free one.
          </>
        ) : (
          <>
            New numbers: <IssueKey value={`${team.prefix}-${team.maxNumber}`} /> becomes{" "}
            <IssueKey value={`${key || "KEY"}-…`} />. The Linear key goes in the note.
          </>
        )}
      </p>
    </li>
  );
}

function ProjectsAndLabels({
  plan,
  data,
  workspace,
  options,
}: {
  plan: ImportPlan;
  data: WorkspaceData;
  workspace: WorkspaceInfo;
  options: ReviewOptions;
}) {
  const existing = new Map(data.labels.map((label) => [nameKey(label.name), label]));
  return (
    <SettingsGroup title="Projects and labels" hint="Reused when one with the same name exists.">
      <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
        {plan.teams
          .filter((team) => team.projects.length > 0)
          .map((team) => (
            <div key={team.team} className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">
                Projects in {targetKey(options.teams[team.team]!, workspace) ?? team.team}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {team.projects.map((project) => (
                  <Badge key={project.externalId} variant="outline">
                    {project.name}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        {plan.labels.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">Labels (workspace-wide)</span>
            <div className="flex flex-wrap gap-1.5">
              {plan.labels.map((label) => {
                const match = existing.get(nameKey(label));
                return (
                  <LabelChip
                    key={label}
                    name={match?.name ?? label}
                    color={match?.color ?? "gray"}
                    title={match ? "Already in Pantry" : "New label"}
                  >
                    {!match && <span className="text-faint-foreground">new</span>}
                  </LabelChip>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Import, batch by batch
// ---------------------------------------------------------------------------------------------

function Running({
  phase,
  onProgress,
  onError,
  onRetry,
  onDone,
}: {
  phase: Extract<Phase, { kind: "running" }>;
  onProgress: (done: number) => void;
  onError: (error: string) => void;
  onRetry: () => void;
  onDone: (result: RunResult) => void;
}) {
  const prepare = useMutation(api.imports.prepareLinear);
  const importIssues = useMutation(api.imports.importLinearIssues);
  const started = useRef(false);
  const { plan } = phase;
  const total = plan.drafts.length;

  useEffect(() => {
    if (started.current || phase.error) return;
    started.current = true;
    (async () => {
      const prepared = await prepare({
        teams: plan.teams.map((team) => ({
          ...team,
          target:
            "spaceId" in team.target
              ? { spaceId: team.target.spaceId as Id<"spaces"> }
              : team.target,
        })),
        labels: plan.labels,
      });
      const result: RunResult = { prepared, created: 0, skipped: 0, renumbered: [], detached: 0 };
      let done = 0;
      for (const batch of toBatches(plan.drafts, prepared as Prepared)) {
        const rows = await importIssues({
          issues: batch as Parameters<typeof importIssues>[0]["issues"],
        });
        for (const row of rows) {
          if (row.outcome === "created") result.created += 1;
          else result.skipped += 1;
          if (row.renumbered) result.renumbered.push(row.key);
          if (row.parentMissing) result.detached += 1;
        }
        done += batch.length;
        onProgress(done);
      }
      onDone(result);
    })().catch((err: unknown) => onError(describeError(err, "The import stopped.")));
  }, [phase.error, plan, prepare, importIssues, onProgress, onError, onDone]);

  const share = total === 0 ? 1 : phase.done / total;
  return (
    <SettingsGroup title="Importing from Linear">
      <div className="border-border flex flex-col gap-3 rounded-lg border p-4" aria-live="polite">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-foreground flex-1">
            {phase.error
              ? "The import stopped"
              : phase.done === 0
                ? "Making spaces, projects and labels…"
                : "Importing issues…"}
          </span>
          <span className="text-muted-foreground tabular font-mono text-xs">
            {phase.done} / {total}
          </span>
        </div>
        <div
          className="bg-gray-4 h-1 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={phase.done}
        >
          <div
            className="bg-primary h-full origin-left rounded-full transition-transform duration-(--duration-standard) ease-(--ease-out) motion-reduce:transition-none"
            style={{ transform: `scaleX(${share})` }}
          />
        </div>
        {phase.error && (
          <>
            <FormError message={phase.error} />
            <p className="text-muted-foreground text-xs">
              Issues imported before it stopped are in Pantry; the batch that failed wrote nothing.
              Importing again carries on from there and skips what&apos;s already in.
            </p>
            <div>
              <Button variant="secondary" onClick={onRetry} data-icon="inline-start">
                <RotateCcwIcon />
                Import again
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsGroup>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Done
// ---------------------------------------------------------------------------------------------

function Done({
  phase,
  onClose,
}: {
  phase: Extract<Phase, { kind: "done" }>;
  onClose: () => void;
}) {
  const { Link } = useNavigation();
  const { result, plan } = phase;
  const { created } = result.prepared;
  const lines: ReactNode[] = [
    `${result.created} ${result.created === 1 ? "issue" : "issues"} imported${plan.counts.subIssues ? `, ${plan.counts.subIssues} of them sub-issues` : ""}.`,
    `${created.spaces} new ${created.spaces === 1 ? "space" : "spaces"}, ${created.projects} new ${created.projects === 1 ? "project" : "projects"}, ${created.labels} new ${created.labels === 1 ? "label" : "labels"}.`,
  ];
  const skipped = result.skipped + plan.counts.alreadyImported;
  if (skipped) lines.push(`${skipped} already in Pantry, skipped.`);
  if (plan.counts.archivedSkipped)
    lines.push(`${plan.counts.archivedSkipped} archived in Linear, left out.`);
  if (result.renumbered.length)
    lines.push(
      `${result.renumbered.length} got a new number because theirs was taken: ${result.renumbered.join(", ")}.`,
    );
  const detached = plan.counts.detached + result.detached;
  if (detached)
    lines.push(`${detached} sub-issues came in top-level (their parent isn't in Pantry).`);
  return (
    <SettingsGroup title="Imported from Linear">
      <div className="border-border flex flex-col gap-3 rounded-lg border p-4" role="status">
        <div className="text-foreground flex items-center gap-2 text-sm font-medium">
          <CheckIcon className="text-success size-4" aria-hidden />
          Import finished
        </div>
        <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {result.prepared.teams.map((team) => (
            <Link
              key={team.spaceId}
              href={routes.space(team.key)}
              className={buttonVariants({ variant: "secondary" })}
              data-icon="inline-end"
            >
              Open {team.name}
              <ArrowRightIcon />
            </Link>
          ))}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
}
