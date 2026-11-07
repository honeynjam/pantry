"use client";

import { api } from "@pantry/backend/api";
import type { Doc, Id } from "@pantry/backend/dataModel";
import type { Project } from "@pantry/backend/model";
import { Button } from "@pantry/ui/components/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  skipContextMenu,
} from "@pantry/ui/components/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pantry/ui/components/dialog";
import { Input } from "@pantry/ui/components/input";
import { LABEL_COLORS, resolveLabelColor } from "@pantry/ui/lib/issue-meta";
import { useMutation } from "convex/react";
import {
  ArchiveIcon,
  ExternalLinkIcon,
  KanbanIcon,
  LinkIcon,
  ListIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../components/confirm-dialog";
import { slug } from "../issues/filters";
import { absoluteUrl, copyText, openInNewTab } from "../lib/clipboard";
import { kindOf, KIND_LABEL } from "../lib/vocabulary";
import { routes, useNavigation } from "../navigation";
import { describeError } from "../screens/form-error";
import { useShortcutScope } from "../use-shortcuts";
import { useAppCommands } from "./app-commands";
import type { WorkspaceData } from "./app-shell";

type Target = { kind: "space"; id: Id<"spaces"> } | { kind: "project"; id: Id<"projects"> };

/** Projects take the label palette minus grey (grey is "no colour"), as in space settings. */
const PROJECT_COLORS = LABEL_COLORS.filter((color) => color !== "gray");
const colorName = (color: string) => color[0]!.toUpperCase() + color.slice(1);

/**
 * Right-click menus for the sidebar's spaces and projects. Items carry `data-space-id` or
 * `data-project-id`; one menu serves them all. Every member can do everything offered here (the
 * backend allows any member to edit, archive and restore spaces and projects); nothing here is new
 * on the server.
 */
export function SidebarContextMenu({
  data,
  children,
}: {
  data: WorkspaceData;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [archivingSpace, setArchivingSpace] = useState<Doc<"spaces"> | null>(null);
  const [archivingProject, setArchivingProject] = useState<Project | null>(null);
  const highlighted = useRef<Element | null>(null);
  useShortcutScope("overlay", open);

  function onContextMenu(event: React.MouseEvent) {
    const element = (event.target as Element).closest<HTMLElement>(
      "[data-space-id], [data-project-id]",
    );
    if (!element) return skipContextMenu(event);
    highlighted.current?.removeAttribute("data-menu-open");
    element.setAttribute("data-menu-open", "");
    highlighted.current = element;
    setTarget(
      element.dataset.projectId
        ? { kind: "project", id: element.dataset.projectId as Id<"projects"> }
        : { kind: "space", id: element.dataset.spaceId as Id<"spaces"> },
    );
  }

  const space =
    target?.kind === "space" ? data.spaces.find((row) => row._id === target.id) : undefined;
  const project =
    target?.kind === "project" ? data.projects.find((row) => row._id === target.id) : undefined;

  return (
    <>
      <ContextMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            highlighted.current?.removeAttribute("data-menu-open");
            highlighted.current = null;
          }
        }}
      >
        <ContextMenuTrigger className="contents" onContextMenu={onContextMenu}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {space && <SpaceItems space={space} onArchive={() => setArchivingSpace(space)} />}
          {project && (
            <ProjectItems
              project={project}
              space={data.spaces.find((row) => row._id === project.spaceId)}
              onRename={() => setRenaming(project)}
              onArchive={() => setArchivingProject(project)}
            />
          )}
        </ContextMenuContent>
      </ContextMenu>
      <RenameProject project={renaming} onDone={() => setRenaming(null)} />
      <ArchiveSpace space={archivingSpace} onDone={() => setArchivingSpace(null)} />
      <ArchiveProject project={archivingProject} onDone={() => setArchivingProject(null)} />
    </>
  );
}

function SpaceItems({ space, onArchive }: { space: Doc<"spaces">; onArchive: () => void }) {
  const { navigate } = useNavigation();
  const commands = useAppCommands();
  const noun = KIND_LABEL[kindOf(space)].one;
  return (
    <>
      <ContextMenuGroup>
        <ContextMenuLabel className="truncate">{space.name}</ContextMenuLabel>
        <ContextMenuItem onClick={() => navigate(routes.space(space.key))}>
          <ListIcon />
          Open list
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigate(routes.board(space.key))}>
          <KanbanIcon />
          Open board
        </ContextMenuItem>
        <ContextMenuItem onClick={() => openInNewTab(routes.space(space.key))}>
          <ExternalLinkIcon />
          Open in new tab
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem onClick={() => commands.newIssue({ space })}>
          <PlusIcon />
          New issue in {space.key}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => void copyText(absoluteUrl(routes.space(space.key)), "link")}
        >
          <LinkIcon />
          Copy link
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigate(routes.spaceSettings(space.key))}>
          <SettingsIcon />
          {noun} settings
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onArchive}>
        <ArchiveIcon />
        Archive {noun.toLowerCase()}…
      </ContextMenuItem>
    </>
  );
}

function ProjectItems({
  project,
  space,
  onRename,
  onArchive,
}: {
  project: Project;
  space: Doc<"spaces"> | undefined;
  onRename: () => void;
  onArchive: () => void;
}) {
  const { navigate } = useNavigation();
  const commands = useAppCommands();
  const update = useMutation(api.projects.update);
  if (!space) return null;
  const filter = `?project=${encodeURIComponent(slug(project.name))}`;
  const recolor = async (color: string) => {
    try {
      await update({ projectId: project._id, color });
    } catch (err) {
      toast.error(describeError(err, "Couldn't recolour the project."));
    }
  };
  return (
    <>
      <ContextMenuGroup>
        <ContextMenuLabel className="truncate">{project.name}</ContextMenuLabel>
        <ContextMenuItem onClick={() => navigate(routes.space(space.key) + filter)}>
          <ListIcon />
          Open list
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigate(routes.board(space.key) + filter)}>
          <KanbanIcon />
          Open board
        </ContextMenuItem>
        <ContextMenuItem onClick={() => openInNewTab(routes.space(space.key) + filter)}>
          <ExternalLinkIcon />
          Open in new tab
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem onClick={() => commands.newIssue({ space, projectId: project._id })}>
          <PlusIcon />
          New issue in {project.name}
        </ContextMenuItem>
        <ContextMenuItem onClick={onRename}>
          <PencilIcon />
          Rename…
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <PaletteIcon />
            Colour
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            {PROJECT_COLORS.map((color) => (
              <ContextMenuCheckboxItem
                key={color}
                checked={project.color === color}
                closeOnClick
                onCheckedChange={() => void recolor(color)}
              >
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: resolveLabelColor(color) }}
                  aria-hidden
                />
                {colorName(color)}
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem
          onClick={() => void copyText(absoluteUrl(routes.space(space.key) + filter), "link")}
        >
          <LinkIcon />
          Copy link
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onArchive}>
        <ArchiveIcon />
        Archive project…
      </ContextMenuItem>
    </>
  );
}

function RenameProject({ project, onDone }: { project: Project | null; onDone: () => void }) {
  const update = useMutation(api.projects.update);
  const [pending, setPending] = useState(false);
  useShortcutScope("overlay", project !== null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    const next = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!next || next === project.name) return onDone();
    setPending(true);
    try {
      await update({ projectId: project._id, name: next });
      onDone();
    } catch (err) {
      toast.error(describeError(err, "Couldn't rename the project."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && onDone()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              Agents find projects by name, so tell them if you rename one they use.
            </DialogDescription>
          </DialogHeader>
          <Input
            // Keyed so the field starts from the project's name each time it opens.
            key={project?._id}
            name="name"
            defaultValue={project?.name}
            aria-label="Project name"
            maxLength={60}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveSpace({ space, onDone }: { space: Doc<"spaces"> | null; onDone: () => void }) {
  const archive = useMutation(api.spaces.archive);
  const { pathname, navigate } = useNavigation();
  const noun = space ? KIND_LABEL[kindOf(space)].one.toLowerCase() : "space";
  return (
    <ConfirmDialog
      open={space !== null}
      onOpenChange={(open) => !open && onDone()}
      title={`Archive ${space?.name ?? noun}?`}
      description={`It disappears from the sidebar and space lists. Its issues keep their ${space?.key ?? ""} keys.`}
      confirmLabel={`Archive ${noun}`}
      onConfirm={async () => {
        if (!space) return;
        try {
          await archive({ spaceId: space._id });
          toast(`Archived ${space.name}`);
          if (pathname.startsWith(routes.space(space.key))) navigate(routes.home);
        } catch (err) {
          toast.error(describeError(err, `Couldn't archive the ${noun}.`));
        }
      }}
    />
  );
}

/** Archive, with Undo in the toast (restore puts it back at the end of the space's order). */
function ArchiveProject({ project, onDone }: { project: Project | null; onDone: () => void }) {
  const archive = useMutation(api.projects.archive);
  const restore = useMutation(api.projects.restore);
  return (
    <ConfirmDialog
      open={project !== null}
      onOpenChange={(open) => !open && onDone()}
      title={`Archive ${project?.name ?? "project"}?`}
      description="Its issues stay in the space with no project, and each gets an activity entry. You can restore the project later from Archived in space settings; its issues won't move back."
      confirmLabel="Archive project"
      onConfirm={async () => {
        if (!project) return;
        try {
          await archive({ projectId: project._id });
          toast(`Archived ${project.name}`, {
            description: "Its issues are in the space with no project now.",
            action: {
              label: "Restore",
              onClick: () =>
                void restore({ projectId: project._id }).catch((err: unknown) =>
                  toast.error(describeError(err, "Couldn't restore the project.")),
                ),
            },
          });
        } catch (err) {
          toast.error(describeError(err, "Couldn't archive the project."));
        }
      }}
    />
  );
}
