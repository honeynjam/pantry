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
import { cn } from "@pantry/ui/lib/utils";
import { useConvex, useMutation } from "convex/react";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  FileUpIcon,
  PlusIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { SpaceAvatar } from "../components/space-avatar";
import { PriorityPicker, StatusPicker } from "../issues/pickers";
import { routes, useNavigation } from "../navigation";
import { describeError, FormError } from "../screens/form-error";
import { SettingsGroup, SettingsList, SettingsRow } from "../screens/settings/parts";
import type { WorkspaceData } from "../shell/app-shell";
import { Columns, parseCsvGrid } from "./csv";
import {
  carryOptions,
  defaultOptions,
  nameKey,
  planImport,
  summarize,
  targetKey,
  toBatches,
  type ImportContext,
  type ImportPlan,
  type Parsed,
  type Prepared,
  type ReviewOptions,
  type SourceId,
  type Summary,
  type TeamTarget,
  type WorkspaceInfo,
} from "./engine";
import { CSV_FIELDS } from "./other";
import type { Adapter, SourceFile, SourceSettings } from "./source";
import { adapterFor, detectSource } from "./sources";

/**
 * Import from another tracker: pick the export, review what will happen (nothing is written yet),
 * import with progress, then a summary. The same screens for every source; the adapter (linear.ts,
 * asana.ts, …) reads the file. The rules live in convex/imports.ts; this screen only proposes the
 * mapping and sends the batches. Importing the same file again is safe: what's already in is skipped.
 */

type Loaded = {
  files: SourceFile[];
  settings: SourceSettings;
  parsed: Parsed;
  summary: Summary;
  /** Other CSV only: the source the file looks like, to offer its own importer. */
  lookalike: SourceId | null;
};
type RunResult = {
  prepared: Awaited<ReturnType<ReturnType<typeof useMutation<typeof api.imports.prepare>>>>;
  created: number;
  skipped: number;
  comments: number;
  renumbered: string[];
  detached: number;
};
type Phase =
  | {
      kind: "pick";
      error: string | null;
      switchTo: { source: SourceId; files: SourceFile[] } | null;
    }
  | { kind: "review"; loaded: Loaded }
  | { kind: "running"; loaded: Loaded; plan: ImportPlan; done: number; error: string | null }
  | { kind: "done"; loaded: Loaded; plan: ImportPlan; result: RunResult };

const LOOKUP_CHUNK = 2_000;

/** Reads the files with the adapter. Throws what the adapter throws (not its export, no issues…). */
function load(adapter: Adapter, files: SourceFile[], settings: SourceSettings): Loaded {
  const parsed = adapter.parse(files, settings);
  if (parsed.issues.length === 0)
    throw new Error(
      parsed.problems[0] ??
        (files.length > 1
          ? "These files have no issues in them."
          : "This file has no issues in it."),
    );
  const lookalike =
    adapter.id === "csv"
      ? (files.map((file) => detectSource(file.text)).find((id) => id !== "csv") ?? null)
      : null;
  return { files, settings, parsed, summary: summarize(parsed, adapter.foldFields), lookalike };
}

async function readAll(list: File[]): Promise<SourceFile[]> {
  return Promise.all(list.map(async (file) => ({ name: file.name, text: await file.text() })));
}

/**
 * Files dropped on the wrong source: a known export on another source's picker, or something that
 * isn't this source's export at all (Other CSV takes anything).
 */
function wrongSource(
  adapter: Adapter,
  files: SourceFile[],
): { error: string; source: SourceId } | null {
  if (adapter.id === "csv") return null;
  for (const file of files) {
    const detected = detectSource(file.text);
    if (detected === adapter.id) continue;
    if (detected === "csv")
      return {
        error: `${file.name} doesn't look like ${adapter.name}'s CSV export. You can still import it as Other CSV and pick its columns yourself.`,
        source: "csv",
      };
    const name = adapterFor(detected).name;
    return {
      error: `${file.name} looks like a ${name} export, not ${adapter.name}'s.`,
      source: detected,
    };
  }
  return null;
}

export function ImportFlow({
  data,
  source: initialSource,
  onClose,
}: {
  data: WorkspaceData;
  source: SourceId;
  onClose: () => void;
}) {
  const [sourceId, setSourceId] = useState(initialSource);
  const adapter = adapterFor(sourceId);
  const [phase, setPhase] = useState<Phase>({ kind: "pick", error: null, switchTo: null });

  function open(target: Adapter, files: SourceFile[]) {
    try {
      const loaded = load(target, files, target.defaultSettings(files));
      setSourceId(target.id);
      setPhase({ kind: "review", loaded });
    } catch (err) {
      setPhase({
        kind: "pick",
        error: describeError(err, "Couldn't read that file."),
        switchTo: null,
      });
    }
  }

  async function readFiles(list: File[]) {
    try {
      if (list.length > 1 && !adapter.multiFile)
        throw new Error(`${adapter.name} exports everything in one file: pick just that one.`);
      const files = await readAll(list);
      const wrong = wrongSource(adapter, files);
      if (wrong) {
        setPhase({ kind: "pick", error: wrong.error, switchTo: { source: wrong.source, files } });
        return;
      }
      open(adapter, files);
    } catch (err) {
      setPhase({
        kind: "pick",
        error: describeError(err, "Couldn't read that file."),
        switchTo: null,
      });
    }
  }

  if (phase.kind === "pick")
    return (
      <PickFile
        adapter={adapter}
        error={phase.error}
        switchTo={phase.switchTo}
        onSwitch={(target) => open(adapterFor(target.source), target.files)}
        onFiles={(files) => void readFiles(files)}
        onCancel={onClose}
      />
    );
  if (phase.kind === "review")
    return (
      <Review
        key={adapter.id}
        data={data}
        adapter={adapter}
        loaded={phase.loaded}
        onChange={(loaded) => setPhase({ kind: "review", loaded })}
        onSwitch={(target) => open(adapterFor(target), phase.loaded.files)}
        onBack={() => setPhase({ kind: "pick", error: null, switchTo: null })}
        onImport={(plan) =>
          setPhase({ kind: "running", loaded: phase.loaded, plan, done: 0, error: null })
        }
      />
    );
  if (phase.kind === "running")
    return (
      <Running
        key={phase.error === null ? "run" : "failed"}
        adapter={adapter}
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
  return <Done adapter={adapter} phase={phase} onClose={onClose} />;
}

export function BetaBadge() {
  return (
    <Badge
      variant="outline"
      className="text-2xs h-4 px-1.5"
      title="Built from the source's documentation and sample exports, not yet from many real files. Check the review closely, and tell us what looks off."
    >
      Beta
    </Badge>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Pick the file(s)
// ---------------------------------------------------------------------------------------------

function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length) onFiles(files);
      },
    },
  };
}

function FileInput({
  adapter,
  inputRef,
  onFiles,
}: {
  adapter: Adapter;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
      multiple={adapter.multiFile}
      className="sr-only"
      aria-label={`${adapter.name} CSV export`}
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = "";
        if (files.length) onFiles(files);
      }}
    />
  );
}

function PickFile({
  adapter,
  error,
  switchTo,
  onSwitch,
  onFiles,
  onCancel,
}: {
  adapter: Adapter;
  error: string | null;
  switchTo: { source: SourceId; files: SourceFile[] } | null;
  onSwitch: (target: { source: SourceId; files: SourceFile[] }) => void;
  onFiles: (files: File[]) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { over, handlers } = useFileDrop(onFiles);
  const what =
    adapter.id === "csv"
      ? "a CSV file"
      : `${adapter.name}'s CSV export${adapter.multiFile ? " (one file or several)" : ""}`;
  return (
    <SettingsGroup
      title={adapter.id === "csv" ? "Import a CSV file" : `Import from ${adapter.name}`}
      hint={adapter.beta ? <BetaBadge /> : undefined}
      actions={
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      }
    >
      <div
        {...handlers}
        className={cn(
          "border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center transition-colors duration-(--duration-instant)",
          over && "border-gray-8 bg-accent",
        )}
      >
        <FileUpIcon className="text-muted-foreground size-5" aria-hidden />
        <div className="flex max-w-md flex-col gap-1">
          <p className="text-foreground text-sm">Drop {what} here</p>
          <p className="text-muted-foreground text-xs">{adapter.howToExport}</p>
          {adapter.exportNote && (
            <p className="text-muted-foreground text-xs">{adapter.exportNote}</p>
          )}
          <p className="text-muted-foreground text-xs">
            The file is read in this browser; nothing is written until you review it and press
            Import.
          </p>
        </div>
        <Button variant="secondary" onClick={() => input.current?.click()} data-icon="inline-start">
          <FileUpIcon />
          {adapter.multiFile ? "Choose CSV files" : "Choose CSV file"}
        </Button>
        <FileInput adapter={adapter} inputRef={input} onFiles={onFiles} />
      </div>
      <FormError message={error} />
      {switchTo && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => onSwitch(switchTo)}>
            Import as {adapterFor(switchTo.source).name}
          </Button>
        </div>
      )}
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

/** imports.context, in chunks of issue ids (a big file has more than one query may look up). */
function useImportContext(source: SourceId, summary: Summary, parsed: Parsed) {
  const convex = useConvex();
  const [state, setState] = useState<{
    for: Parsed;
    context: ImportContext | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const ids = parsed.issues.map((issue) => issue.externalId);
      const merged: ImportContext = { teams: {}, people: {}, imported: {} };
      const emails = [
        ...new Set(
          summary.people
            .map((row) => /[^\s<>(),;"']+@[^\s<>(),;"']+/.exec(row.value)?.[0]?.toLowerCase())
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      for (let start = 0; start === 0 || start < ids.length; start += LOOKUP_CHUNK) {
        const first = start === 0;
        const part = await convex.query(api.imports.context, {
          source,
          teams: first ? summary.teams.map((team) => team.name) : [],
          emails: first ? emails : [],
          externalIds: ids.slice(start, start + LOOKUP_CHUNK),
        });
        Object.assign(merged.teams, part.teams);
        Object.assign(merged.people, part.people);
        Object.assign(merged.imported, part.imported);
      }
      if (live) setState({ for: parsed, context: merged, error: null });
    })().catch(
      (err: unknown) =>
        live &&
        setState({
          for: parsed,
          context: null,
          error: describeError(err, "Couldn't check the workspace."),
        }),
    );
    return () => {
      live = false;
    };
  }, [convex, source, parsed, summary]);
  return state;
}

function Review({
  data,
  adapter,
  loaded,
  onChange,
  onSwitch,
  onBack,
  onImport,
}: {
  data: WorkspaceData;
  adapter: Adapter;
  loaded: Loaded;
  onChange: (loaded: Loaded) => void;
  onSwitch: (source: SourceId) => void;
  onBack: () => void;
  onImport: (plan: ImportPlan) => void;
}) {
  const workspace = useMemo(() => workspaceInfo(data), [data]);
  const state = useImportContext(adapter.id, loaded.summary, loaded.parsed);
  // The owner's last choices; on a new parse (files, settings), whatever still applies is kept.
  const [edited, setOptions] = useState<ReviewOptions | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);

  const context = state?.for === loaded.parsed ? state.context : null;
  const options = useMemo(() => {
    if (!context) return null;
    const fresh = defaultOptions(
      loaded.parsed,
      loaded.summary,
      workspace,
      context,
      adapter.keyFallback,
    );
    return edited ? carryOptions(edited, fresh) : fresh;
  }, [context, loaded, workspace, adapter.keyFallback, edited]);

  function reload(files: SourceFile[], settings: SourceSettings) {
    try {
      onChange(load(adapter, files, settings));
      setFileError(null);
    } catch (err) {
      setFileError(describeError(err, "Couldn't read that file."));
    }
  }

  async function addFiles(list: File[]) {
    const added = await readAll(list);
    const wrong = wrongSource(adapter, added);
    if (wrong) {
      setFileError(wrong.error);
      return;
    }
    const known = new Set(loaded.files.map((file) => file.text));
    reload([...loaded.files, ...added.filter((file) => !known.has(file.text))], loaded.settings);
  }

  const header = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-foreground min-w-0 truncate font-medium">
          {loaded.files.length === 1 ? loaded.files[0]!.name : `${loaded.files.length} files`}
        </span>
        <span className="text-muted-foreground tabular shrink-0 text-xs">
          {loaded.parsed.issues.length} issues
        </span>
        {adapter.beta && <BetaBadge />}
        <div className="ml-auto flex items-center gap-1">
          {adapter.multiFile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => addInput.current?.click()}
              data-icon="inline-start"
            >
              <PlusIcon />
              Add file
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onBack}>
            Choose other files
          </Button>
        </div>
        <FileInput
          adapter={adapter}
          inputRef={addInput}
          onFiles={(files) => void addFiles(files)}
        />
      </div>
      {loaded.files.length > 1 && (
        <ul className="flex flex-wrap gap-1.5">
          {loaded.files.map((file) => (
            <li key={file.name + file.text.length}>
              <Badge variant="outline" className="gap-1 pr-0.5">
                {file.name}
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  className="text-muted-foreground hover:text-foreground rounded-sm p-0.5"
                  onClick={() =>
                    reload(
                      loaded.files.filter((other) => other !== file),
                      loaded.settings,
                    )
                  }
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <FormError message={fileError} />
      {loaded.lookalike && (
        <div className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1">
            This looks like a {adapterFor(loaded.lookalike).name} export. Its own importer maps more
            of it for you.
          </span>
          <Button variant="secondary" size="sm" onClick={() => onSwitch(loaded.lookalike!)}>
            Import as {adapterFor(loaded.lookalike).name}
          </Button>
        </div>
      )}
    </div>
  );
  if (!state || state.error || !context || !options)
    return (
      <div className="flex flex-col gap-3">
        {header}
        {state?.error ? (
          <FormError message={state.error} />
        ) : (
          <p className="text-muted-foreground text-sm">Checking the workspace…</p>
        )}
      </div>
    );
  return (
    <ReviewForm
      data={data}
      adapter={adapter}
      loaded={loaded}
      context={context}
      options={options}
      setOptions={setOptions}
      header={header}
      onSettings={(settings) => reload(loaded.files, settings)}
      onBack={onBack}
      onImport={onImport}
    />
  );
}

function ReviewForm({
  data,
  adapter,
  loaded,
  context,
  options,
  setOptions,
  header,
  onSettings,
  onBack,
  onImport,
}: {
  data: WorkspaceData;
  adapter: Adapter;
  loaded: Loaded;
  context: ImportContext;
  options: ReviewOptions;
  setOptions: (options: ReviewOptions) => void;
  header: ReactNode;
  onSettings: (settings: SourceSettings) => void;
  onBack: () => void;
  onImport: (plan: ImportPlan) => void;
}) {
  const workspace = useMemo(() => workspaceInfo(data), [data]);
  const plan = useMemo(
    () => planImport(loaded.parsed, loaded.summary, options, workspace, context, adapter.noteName),
    [context, options, loaded, workspace, adapter.noteName],
  );
  const toggles = useMemo(
    () => adapter.toggles(loaded.files, loaded.parsed),
    [adapter, loaded.files, loaded.parsed],
  );
  const set = (patch: Partial<ReviewOptions>) => setOptions({ ...options, ...patch });
  const blocked = plan.problems.length > 0 || plan.counts.issues === 0;
  const { summary } = loaded;
  const warnings = loaded.parsed.warnings ?? [];
  return (
    <div className="flex flex-col gap-8">
      {header}

      {adapter.id === "csv" && (
        <ColumnMapper
          file={loaded.files[0]!}
          columns={loaded.settings.columns}
          onChange={(columns) => onSettings({ ...loaded.settings, columns })}
        />
      )}

      <Counts plan={plan} />

      {warnings.length > 0 && (
        <SettingsGroup title="Check before importing">
          <ul className="border-border flex flex-col gap-1.5 rounded-lg border p-3">
            {warnings.map((warning) => (
              <li key={warning} className="text-muted-foreground flex gap-2 text-xs">
                <TriangleAlertIcon className="text-warning mt-px size-3.5 shrink-0" aria-hidden />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </SettingsGroup>
      )}

      {toggles.length > 0 && (
        <SettingsGroup title={`How ${adapter.name} maps`}>
          <div className="border-border flex flex-col gap-2.5 rounded-lg border p-3">
            {toggles.map((toggle) => (
              <label key={toggle.id} className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={loaded.settings.toggles[toggle.id] === true}
                  onCheckedChange={(checked) =>
                    onSettings({
                      ...loaded.settings,
                      toggles: { ...loaded.settings.toggles, [toggle.id]: checked === true },
                    })
                  }
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-foreground">{toggle.label}</span>
                  {toggle.hint && (
                    <span className="text-muted-foreground text-xs">{toggle.hint}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </SettingsGroup>
      )}

      <SettingsGroup title={adapter.teamTitle} hint={adapter.teamHint}>
        <SettingsList>
          {summary.teams.map((team) => (
            <TeamRow
              key={team.name}
              adapter={adapter}
              team={team}
              data={data}
              workspace={workspace}
              target={options.teams[team.name]!}
              onChange={(target) => set({ teams: { ...options.teams, [team.name]: target } })}
            />
          ))}
        </SettingsList>
      </SettingsGroup>

      <SettingsGroup title="Statuses" hint={statusHint(adapter)}>
        <SettingsList>
          {summary.statuses.map((status) => (
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

      <SettingsGroup title="Priorities" hint={`${adapter.name} priority → Pantry priority.`}>
        <SettingsList>
          {summary.priorities.map((row) => (
            <SettingsRow key={row.key}>
              <span className="text-foreground min-w-0 flex-1 truncate">{row.name}</span>
              <Count value={row.count} />
              <ArrowRightIcon className="text-faint-foreground size-3.5 shrink-0" aria-hidden />
              <div className="w-44 shrink-0">
                <PriorityPicker
                  variant="full"
                  value={options.priorities[row.key] ?? row.priority}
                  onChange={(priority) =>
                    set({ priorities: { ...options.priorities, [row.key]: priority } })
                  }
                />
              </div>
            </SettingsRow>
          ))}
        </SettingsList>
      </SettingsGroup>

      <SettingsGroup
        title="People"
        hint={
          adapter.id === "linear"
            ? "Matched to members by sign-in email."
            : "Matched to members by sign-in email, else by display name."
        }
      >
        {plan.people.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nobody is named in the file.</p>
        ) : (
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
        )}
        {plan.people.some((person) => !person.member) && (
          <p className="text-muted-foreground text-xs">
            Issues of people who aren&apos;t members come in unassigned (created by you), with their
            name in the note at the end of the description. Invite them first to keep them.
          </p>
        )}
      </SettingsGroup>

      <ProjectsAndLabels plan={plan} data={data} workspace={workspace} options={options} />

      {(summary.types.length > 0 || summary.comments > 0) && (
        <SettingsGroup title="Also">
          <div className="border-border flex flex-col gap-2.5 rounded-lg border p-3">
            {summary.types.length > 0 && (
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={options.typeLabels}
                  onCheckedChange={(checked) => set({ typeLabels: checked === true })}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-foreground">Add the issue type as a label</span>
                  <span className="text-muted-foreground text-xs">
                    {summary.types.map((type) => `${type.name} (${type.count})`).join(", ")}
                  </span>
                </span>
              </label>
            )}
            {summary.comments > 0 && (
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={options.comments}
                  onCheckedChange={(checked) => set({ comments: checked === true })}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-foreground">
                    Import {summary.comments} {summary.comments === 1 ? "comment" : "comments"}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Under your name, tagged “via import”, each starting with who wrote it in{" "}
                    {adapter.name} and when.
                  </span>
                </span>
              </label>
            )}
          </div>
        </SettingsGroup>
      )}

      <SettingsGroup title={`${adapter.name}-only fields`} hint="Pantry has no field for these.">
        <div className="border-border flex flex-col gap-2.5 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            Checked fields go into a short note at the end of each issue&apos;s description.
          </p>
          {adapter.foldFields
            .filter((field) => field.id === "dates" || (summary.folded[field.id] ?? 0) > 0)
            .map((field) => (
              <label key={field.id} className="text-foreground flex items-center gap-2.5 text-sm">
                <Checkbox
                  checked={options.fold[field.id] ?? true}
                  onCheckedChange={(checked) =>
                    set({ fold: { ...options.fold, [field.id]: checked === true } })
                  }
                />
                <span className="min-w-0 flex-1">{field.label}</span>
                <Count value={summary.folded[field.id] ?? 0} />
              </label>
            ))}
          {summary.dropped.some((row) => row.count > 0) && (
            <p className="text-muted-foreground border-border border-t pt-2.5 text-xs">
              Not imported:{" "}
              {summary.dropped
                .filter((row) => row.count > 0)
                .map((row) => `${row.column} (${row.count})`)
                .join(", ")}
              . Pantry keeps its own update times.
            </p>
          )}
        </div>
      </SettingsGroup>

      {summary.archived > 0 && (
        <SettingsGroup title={`Archived in ${adapter.name}`}>
          <label className="text-foreground flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={options.includeArchived}
              onCheckedChange={(checked) => set({ includeArchived: checked === true })}
            />
            Include {summary.archived} archived {summary.archived === 1 ? "issue" : "issues"}
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

function statusHint(adapter: Adapter): string {
  if (adapter.id === "asana")
    return "Open tasks by section, completed tasks as Completed → Pantry status.";
  if (adapter.id === "jira") return "Jira status (with its resolution) → Pantry status.";
  return `${adapter.id === "csv" ? "Status in the file" : `${adapter.name} status`} → Pantry status.`;
}

const Count = ({ value }: { value: number }) => (
  <span className="text-muted-foreground tabular shrink-0 font-mono text-xs">{value}</span>
);

/** Other CSV: which column is the title, the status, the assignee… with a value from the file. */
function ColumnMapper({
  file,
  columns,
  onChange,
}: {
  file: SourceFile;
  columns: Record<string, string>;
  onChange: (columns: Record<string, string>) => void;
}) {
  const { headers, sample } = useMemo(() => {
    const grid = parseCsvGrid(file.text);
    const c = new Columns(grid.headers);
    const unique = grid.headers.filter(
      (header, index) => header && grid.headers.indexOf(header) === index,
    );
    return {
      headers: unique,
      sample: (header: string) =>
        grid.rows
          .map((row) => c.get(row, header))
          .find(Boolean)
          ?.replace(/\s+/g, " ") ?? "",
    };
  }, [file]);
  return (
    <SettingsGroup
      title="Columns"
      hint="Which column has what. Columns nobody picks go into the note."
    >
      <SettingsList>
        {CSV_FIELDS.map((field) => {
          const value = columns[field.id] ?? "";
          return (
            <SettingsRow key={field.id}>
              <span className="text-foreground w-48 shrink-0 truncate">
                {field.label}
                {"required" in field && <span className="text-muted-foreground"> (required)</span>}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-48 justify-start"
                      data-icon="inline-end"
                    />
                  }
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-left",
                      !value && "text-muted-foreground",
                    )}
                  >
                    {value || "None"}
                  </span>
                  <ChevronDownIcon className="text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-80 w-56 overflow-y-auto">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{field.label}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={value || "__none"}
                      onValueChange={(next) =>
                        onChange({ ...columns, [field.id]: next === "__none" ? "" : String(next) })
                      }
                    >
                      <DropdownMenuRadioItem value="__none" closeOnClick>
                        None
                      </DropdownMenuRadioItem>
                      <DropdownMenuSeparator />
                      {headers.map((header) => (
                        <DropdownMenuRadioItem key={header} value={header} closeOnClick>
                          <span className="min-w-0 flex-1 truncate">{header}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <span
                className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
                title={value ? sample(value) : undefined}
              >
                {value ? sample(value) : ""}
              </span>
            </SettingsRow>
          );
        })}
      </SettingsList>
    </SettingsGroup>
  );
}

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
  adapter,
  team,
  data,
  workspace,
  target,
  onChange,
}: {
  adapter: Adapter;
  team: Summary["teams"][number];
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
  const keeps = team.prefix !== "" && key === team.prefix;
  const whose = adapter.id === "csv" ? "the file's" : `${adapter.name}'s`;
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
        {team.prefix === "" ? (
          <>
            Numbered from <IssueKey value={`${key || "KEY"}-…`} />, in the file&apos;s order.
          </>
        ) : keeps ? (
          <>
            Keeps {whose} numbers: <IssueKey value={`${team.prefix}-${team.maxNumber}`} /> stays{" "}
            <IssueKey value={`${team.prefix}-${team.maxNumber}`} />. A number already used in Pantry
            gets the next free one.
          </>
        ) : (
          <>
            New numbers: <IssueKey value={`${team.prefix}-${team.maxNumber}`} /> becomes{" "}
            <IssueKey value={`${key || "KEY"}-…`} />. The {adapter.noteName} key goes in the note.
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
  if (plan.labels.length === 0 && plan.teams.every((team) => team.projects.length === 0))
    return null;
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
  adapter,
  phase,
  onProgress,
  onError,
  onRetry,
  onDone,
}: {
  adapter: Adapter;
  phase: Extract<Phase, { kind: "running" }>;
  onProgress: (done: number) => void;
  onError: (error: string) => void;
  onRetry: () => void;
  onDone: (result: RunResult) => void;
}) {
  const prepare = useMutation(api.imports.prepare);
  const importIssues = useMutation(api.imports.importIssues);
  const started = useRef(false);
  const { plan } = phase;
  const total = plan.drafts.length;
  const source = adapter.id;

  useEffect(() => {
    if (started.current || phase.error) return;
    started.current = true;
    (async () => {
      const prepared = await prepare({
        source,
        teams: plan.teams.map((team) => ({
          ...team,
          target:
            "spaceId" in team.target
              ? { spaceId: team.target.spaceId as Id<"spaces"> }
              : team.target,
        })),
        labels: plan.labels,
      });
      const result: RunResult = {
        prepared,
        created: 0,
        skipped: 0,
        comments: 0,
        renumbered: [],
        detached: 0,
      };
      const commentsOf = new Map(
        plan.drafts.map((draft) => [draft.externalId, draft.comments?.length ?? 0]),
      );
      let done = 0;
      for (const batch of toBatches(plan.drafts, prepared as Prepared)) {
        const rows = await importIssues({
          source,
          issues: batch as Parameters<typeof importIssues>[0]["issues"],
        });
        for (const row of rows) {
          if (row.outcome === "created") {
            result.created += 1;
            result.comments += commentsOf.get(row.externalId) ?? 0;
          } else result.skipped += 1;
          if (row.renumbered) result.renumbered.push(row.key);
          if (row.parentMissing) result.detached += 1;
        }
        done += batch.length;
        onProgress(done);
      }
      onDone(result);
    })().catch((err: unknown) => onError(describeError(err, "The import stopped.")));
  }, [phase.error, plan, prepare, importIssues, onProgress, onError, onDone, source]);

  const share = total === 0 ? 1 : phase.done / total;
  return (
    <SettingsGroup title={`Importing from ${adapter.id === "csv" ? "CSV" : adapter.name}`}>
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
  adapter,
  phase,
  onClose,
}: {
  adapter: Adapter;
  phase: Extract<Phase, { kind: "done" }>;
  onClose: () => void;
}) {
  const { Link } = useNavigation();
  const { result, plan } = phase;
  const { created } = result.prepared;
  const from = adapter.id === "csv" ? "the file" : adapter.name;
  const lines: ReactNode[] = [
    `${result.created} ${result.created === 1 ? "issue" : "issues"} imported${plan.counts.subIssues ? `, ${plan.counts.subIssues} of them sub-issues` : ""}.`,
    `${created.spaces} new ${created.spaces === 1 ? "space" : "spaces"}, ${created.projects} new ${created.projects === 1 ? "project" : "projects"}, ${created.labels} new ${created.labels === 1 ? "label" : "labels"}.`,
  ];
  if (result.comments)
    lines.push(
      `${result.comments} ${result.comments === 1 ? "comment" : "comments"} brought over.`,
    );
  const skipped = result.skipped + plan.counts.alreadyImported;
  if (skipped) lines.push(`${skipped} already in Pantry, skipped.`);
  if (plan.counts.archivedSkipped)
    lines.push(`${plan.counts.archivedSkipped} archived in ${from}, left out.`);
  if (result.renumbered.length)
    lines.push(
      `${result.renumbered.length} got a new number because theirs was taken: ${result.renumbered.join(", ")}.`,
    );
  const detached = plan.counts.detached + result.detached;
  if (detached)
    lines.push(
      `${detached} ${detached === 1 ? "sub-issue" : "sub-issues"} came in top-level (parent left out, not found or ambiguous); the note at the end says whose it was.`,
    );
  return (
    <SettingsGroup title={`Imported from ${adapter.id === "csv" ? "CSV" : adapter.name}`}>
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
          {result.prepared.teams
            .filter(
              (team, index, all) =>
                all.findIndex((other) => other.spaceId === team.spaceId) === index,
            )
            .map((team) => (
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
