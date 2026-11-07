An issue has a title, a Markdown description, a status, a priority, an assignee, labels, a due date and comments.
Each one keeps a timeline of every change, and changes made by agents are tagged "via MCP". Issues brought in
by an [import](/docs/import-export) start with one entry tagged "via import".

## Statuses

Every workspace has six statuses: **Backlog, Todo, In Progress, In Review, Done** and **Canceled**. Rename,
recolour and reorder them in Settings; they can't be added or removed. Nothing changes status automatically:
you (or your agent) move an issue when work starts and when it's done.

## Priority and labels

Priorities are Urgent, High, Medium, Low or none. Urgent is the only one shown in colour, so it stands out in a
list. Labels belong to the workspace: add, rename, recolour and delete them in Settings.

## Sub-issues

Split work with sub-issues. They go one level deep, and always stay in their parent's space and project.

## Views

- **List** groups a space's issues by status or by project.
- **Board** shows a column per status, or a row of columns per project when grouped by project.
- **My issues** shows everything assigned to you, across spaces.

Lists filter by status, assignee, priority and label. Filters live in the URL, so you can bookmark or share them.

### The board

Each column shows its status, how many issues it has, and **+** to add an issue there. Cards show the key and
assignee, the title, then priority, project, labels, due date and sub-issue progress.

Empty columns start hidden, in **Hidden columns** at the end of the board. Hide any column with the eye icon in its
header (it shows on hover); click a hidden column to show it again. Pantry remembers which columns you hid, per space,
on that device. You can drop a card on a hidden column to move it there.

### Drag and drop

Drag issues to reorder them or move them on:

- **On the board**, drag a card within its column to reorder it, or to another column to change its status. When
  the board is grouped by project, dragging to another project's row changes the project too.
- **In a list grouped by status**, drag a row up or down to reorder it, or into another group to change its status.
  The list and the board share one order, so a reorder in one shows in the other.
- **In a list grouped by project**, drag a row into another project's group to move it there. The status stays the
  same, and the drop line stays among the issues with that status.
- **In My issues**, which is sorted by last update, drag a row to another status group to change its status. There
  is no reordering there; the group you can drop into lights up and says "Drop to move here".

The whole row or card is the handle: it lifts after a few pixels of movement, so a click still opens the issue. A
line shows where it will land. **Esc** cancels. If you selected issues with `X`, dragging one of them moves them
all, in their order. From the keyboard, focus an issue, press **Space** to pick it up, the arrow keys to move it, and
**Space** or **Enter** to drop it. Sub-issues always stay in their parent's project: drop one on another project and it
stays put, with a note saying why.

## Right-click menus

Right-click an issue (in a list, on the board, in My issues or in an issue's sub-issues) for its menu:

- **Status, Priority, Assignee, Labels, Project** and **Due date**, each a submenu with the current value ticked;
- **Open in new tab** and **Add sub-issue**;
- **Copy link**, **Copy key** and **Copy title**;
- **Delete issue…**, after the same confirmation as on the issue page.

If you right-click an issue you've selected, the menu acts on the whole selection and says how many issues
("3 issues"). Right-click any other issue and it acts on that issue only. With the menu open, the letter keys
work as they do in a list: `S` opens the status picker, `P` priority, `A` assignee, `L` labels, `D` due date and
`I` assigns to you.

From the keyboard, press `Shift+F10` (or the menu key) on the focused issue. Text fields and selected text keep
your browser's own menu.

## Editing fast

Changes show at once and sync in the background, and everyone else sees them without a reload. In lists and on
the board, select issues with `X` and change status, assignee, priority, labels, project or due date for all of
them at once. See [Keyboard shortcuts](/docs/keyboard-shortcuts).

Descriptions and comments use a Markdown editor that keeps your agents' Markdown as written: tables, HTML, task
lists and links survive a round trip, and blocks you don't edit are saved exactly as they were.
