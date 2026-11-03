"use client";

import { api } from "@pantry/backend/api";
import type { Doc } from "@pantry/backend/dataModel";
import { PersonAvatar } from "@pantry/ui/components/avatar-stack";
import { Badge } from "@pantry/ui/components/badge";
import { Button } from "@pantry/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pantry/ui/components/dropdown-menu";
import { Keycap } from "@pantry/ui/components/keycap";
import { PRIORITY_LABEL, type Priority } from "@pantry/ui/lib/issue-meta";
import { cn } from "@pantry/ui/lib/utils";
import { useMutation } from "convex/react";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../components/confirm-dialog";
import { formatDay, fullDate, timeAgo } from "../lib/format";
import { describeError } from "../screens/form-error";
import type { Lookups } from "./lookups";
import { MarkdownEditor, type MarkdownEditorHandle } from "../components/markdown-editor";
import { isOptimisticId, optimisticComment } from "./optimistic";

type Activity = Doc<"activity">;
type Comment = Doc<"comments">;

/** Agent writes show as the token's owner plus this tag (spec §6). */
export function ViaMcp() {
  return (
    <Badge
      variant="outline"
      className="text-2xs h-4 px-1.5"
      title="Made by an agent through MCP, acting as this person"
    >
      via MCP
    </Badge>
  );
}

/** Rows an import wrote (Settings → Import and Export), so they don't read as typed in by hand. */
export function ViaImport() {
  return (
    <Badge
      variant="outline"
      className="text-2xs h-4 px-1.5"
      title="Brought in by an import, run by this person"
    >
      via import
    </Badge>
  );
}

const Value = ({ children }: { children: ReactNode }) => (
  <span className="text-foreground font-medium">{children}</span>
);

const names = (list: string | undefined) => (list ? list.split(", ").filter(Boolean) : []);

/** One activity row as a sentence ("changed status from Todo to In Progress"). */
export function describeActivity(row: Activity): ReactNode {
  switch (row.type) {
    case "created":
      // An imported issue's `created` row names where it came from ("Linear").
      return row.via === "import" ? (
        <>
          imported the issue from <Value>{row.from ?? "another tracker"}</Value>
        </>
      ) : (
        "created the issue"
      );
    case "status_changed":
      return (
        <>
          changed status
          {row.from ? (
            <>
              {" "}
              from <Value>{row.from}</Value>
            </>
          ) : null}{" "}
          to <Value>{row.to}</Value>
        </>
      );
    case "priority_changed":
      return (
        <>
          set priority to <Value>{PRIORITY_LABEL[Number(row.to) as Priority] ?? row.to}</Value>
        </>
      );
    case "assigned":
      if (!row.to)
        return (
          <>
            removed the assignee <Value>{row.from}</Value>
          </>
        );
      return row.from ? (
        <>
          reassigned from <Value>{row.from}</Value> to <Value>{row.to}</Value>
        </>
      ) : (
        <>
          assigned <Value>{row.to}</Value>
        </>
      );
    case "labels_changed": {
      const before = names(row.from);
      const after = names(row.to);
      const added = after.filter((name) => !before.includes(name));
      const removed = before.filter((name) => !after.includes(name));
      const parts: ReactNode[] = [];
      if (added.length)
        parts.push(
          <span key="a">
            added {added.length > 1 ? "labels" : "label"} <Value>{added.join(", ")}</Value>
          </span>,
        );
      if (removed.length)
        parts.push(
          <span key="r">
            removed {removed.length > 1 ? "labels" : "label"} <Value>{removed.join(", ")}</Value>
          </span>,
        );
      return parts.length === 2 ? (
        <>
          {parts[0]} and {parts[1]}
        </>
      ) : (
        (parts[0] ?? "changed the labels")
      );
    }
    case "title_changed":
      return (
        <>
          renamed the issue to <Value>“{row.to}”</Value>
        </>
      );
    case "description_changed":
      return "updated the description";
    case "parent_changed":
      if (!row.to)
        return (
          <>
            removed it from <Value>{row.from}</Value>
          </>
        );
      return (
        <>
          made it a sub-issue of <Value>{row.to}</Value>
        </>
      );
    case "due_date_changed":
      return row.to ? (
        <>
          set the due date to <Value>{formatDay(row.to)}</Value>
        </>
      ) : (
        "removed the due date"
      );
    case "project_changed":
      if (!row.to)
        return (
          <>
            removed it from the project <Value>{row.from}</Value>
          </>
        );
      return row.from ? (
        <>
          moved it from <Value>{row.from}</Value> to the project <Value>{row.to}</Value>
        </>
      ) : (
        <>
          added it to the project <Value>{row.to}</Value>
        </>
      );
    case "commented":
      return "commented";
  }
}

/**
 * Activity and comments in one chronological stream. `commented` rows are left out because the
 * comment itself is shown.
 */
export function Timeline({
  activity,
  comments,
  lookups,
}: {
  activity: Activity[];
  comments: Comment[];
  lookups: Lookups;
}) {
  const items = [
    ...activity
      .filter((row) => row.type !== "commented")
      .map((row) => ({ kind: "activity" as const, row })),
    ...comments.map((row) => ({ kind: "comment" as const, row })),
  ].sort((a, b) => a.row._creationTime - b.row._creationTime);

  return (
    <ol className="flex flex-col gap-1" aria-label="Activity and comments">
      {items.map((item) =>
        item.kind === "activity" ? (
          <ActivityItem key={item.row._id} row={item.row} lookups={lookups} />
        ) : (
          <CommentItem key={item.row._id} comment={item.row} lookups={lookups} />
        ),
      )}
    </ol>
  );
}

function ActivityItem({ row, lookups }: { row: Activity; lookups: Lookups }) {
  const actor = lookups.member(row.actorId);
  return (
    <li className="text-muted-foreground flex min-h-7 items-center gap-2 py-0.5 pl-1 text-xs">
      <PersonAvatar
        person={{ name: actor?.displayName ?? "?", avatarUrl: actor?.avatarUrl }}
        size="xs"
      />
      <span className="min-w-0">
        <span className="text-foreground font-medium">{actor?.displayName ?? "Someone"}</span>{" "}
        {describeActivity(row)}
      </span>
      {row.via === "mcp" && <ViaMcp />}
      {row.via === "import" && <ViaImport />}
      <span aria-hidden>·</span>
      <time
        dateTime={new Date(row._creationTime).toISOString()}
        title={fullDate(row._creationTime)}
        className="shrink-0"
      >
        {timeAgo(row._creationTime)}
      </time>
    </li>
  );
}

function CommentItem({ comment, lookups }: { comment: Comment; lookups: Lookups }) {
  const author = lookups.member(comment.authorId);
  const mine = comment.authorId === lookups.data.me._id;
  const sending = isOptimisticId(comment._id);
  const edit = useMutation(api.comments.edit);
  const remove = useMutation(api.comments.remove);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);
  const anchor = `comment-${comment._id}`;
  const item = useRef<HTMLLIElement>(null);

  // Links from MCP add_comment end in #comment-<id>; the thread loads after the page, so scroll here.
  useEffect(() => {
    if (window.location.hash === `#${anchor}`) item.current?.scrollIntoView({ block: "center" });
  }, [anchor]);

  async function saveEdit(body: string) {
    if (!body.trim()) return;
    try {
      await edit({ commentId: comment._id, body });
      setEditing(false);
    } catch (err) {
      toast.error(describeError(err, "Couldn't save the comment."));
    }
  }

  return (
    <li
      id={anchor}
      ref={item}
      className={cn(
        "border-border bg-background my-1.5 scroll-mt-16 rounded-lg border transition-opacity duration-(--duration-fast)",
        sending && "opacity-70",
      )}
      aria-busy={sending || undefined}
    >
      <div className="flex h-9 items-center gap-2 px-3 text-xs">
        <PersonAvatar
          person={{ name: author?.displayName ?? "?", avatarUrl: author?.avatarUrl }}
          size="xs"
        />
        <span className="text-foreground font-medium">{author?.displayName ?? "Someone"}</span>
        {comment.via === "mcp" && <ViaMcp />}
        {comment.via === "import" && <ViaImport />}
        <time
          dateTime={new Date(comment._creationTime).toISOString()}
          title={fullDate(comment._creationTime)}
          className="text-muted-foreground"
        >
          {timeAgo(comment._creationTime)}
        </time>
        {comment.editedAt && (
          <span className="text-muted-foreground" title={`Edited ${fullDate(comment.editedAt)}`}>
            (edited)
          </span>
        )}
        {sending && <span className="text-muted-foreground">Sending…</span>}
        {mine && !editing && !sending && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  aria-label="Comment actions"
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleting(true)}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2 px-3 pb-2.5">
          <MarkdownEditor
            ref={editor}
            value={comment.body}
            autoFocus
            aria-label="Edit comment"
            onSubmit={(body) => void saveEdit(body)}
            onEscape={() => setEditing(false)}
            className="border-border rounded-md border"
            contentClassName="min-h-16 px-3 py-2"
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void saveEdit(editor.current?.getMarkdown() ?? comment.body)}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <MarkdownEditor value={comment.body} editable={false} contentClassName="px-3 pb-2.5" />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this comment?"
        description="It's removed for everyone. This can't be undone."
        confirmLabel="Delete comment"
        destructive
        onConfirm={async () => {
          try {
            await remove({ commentId: comment._id });
          } catch (err) {
            toast.error(describeError(err, "Couldn't delete the comment."));
          }
        }}
      />
    </li>
  );
}

/**
 * New comment: markdown, Cmd/Ctrl+Enter posts it. Optimistic: the comment shows in the thread and
 * the editor empties at once; if the server refuses it, it leaves the thread and the text comes
 * back into the editor.
 */
export function CommentComposer({ issueId }: { issueId: Doc<"issues">["_id"] }) {
  const add = useMutation(api.comments.add).withOptimisticUpdate((store, args) =>
    optimisticComment(store, args),
  );
  const editor = useRef<MarkdownEditorHandle>(null);

  async function post(body: string) {
    if (!body.trim()) return;
    editor.current?.clear();
    try {
      await add({ issueId, body });
    } catch (err) {
      toast.error(describeError(err, "Couldn't post the comment."));
      if (editor.current?.isEmpty()) editor.current.setMarkdown(body);
    }
  }

  return (
    <div className="border-border bg-background focus-within:border-border-strong mt-2 rounded-lg border transition-colors duration-(--duration-instant)">
      <MarkdownEditor
        ref={editor}
        value=""
        placeholder="Leave a comment…"
        aria-label="New comment"
        onSubmit={(body) => void post(body)}
        contentClassName="min-h-16 px-3 pt-2.5 pb-1"
      />
      <div className="flex items-center justify-end gap-2 px-2 pb-2">
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <Keycap keys="mod+enter" />
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void post(editor.current?.getMarkdown() ?? "")}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}
