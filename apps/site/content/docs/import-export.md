Bring your issues in from Linear, Asana, Shortcut, Jira or any other CSV, or download everything in your
workspace. Both live in **Settings → Import and Export**.

## Import

Only the workspace owner can import, because an import creates spaces, projects and labels for everyone. Every
source works the same way:

1. Export your issues as CSV from the other tool (the steps for each are below).
2. In Pantry, open **Settings → Import and Export**, choose the source and pick the file (or files). It's read in
   your browser; nothing is written yet. If the file is another tool's export, Pantry says so and offers to switch.
3. Review what will happen, change anything you want, then press **Import**.

Asana, Shortcut and Jira are marked **Beta**: they're built from each tool's documentation and published sample
exports, not yet from many real files. Check the review closely, and if something looks off, open an issue with
the column headers of your file (not its rows).

### What the review shows

- **Counts**: how many spaces, projects, labels, issues and sub-issues the import makes, and how many issues it
  skips (archived, or already imported).
- **Check before importing**: things worth a look that don't stop the import, like dates Pantry couldn't read
  (they're left out) or an issue that's in two of your files (it comes in once).
- **Spaces**: whatever the source groups issues by (a Linear team, an Asana project, a Shortcut team, a Jira
  project) goes into a space. By default that's a new space named after it, with the source's key when it has one
  (`ENG` for `ENG-12`) and a short free key otherwise. You can rename it, change the key, or pick an existing space.
- **Statuses** and **Priorities**: each of the source's statuses and priorities is mapped to one of Pantry's, by
  name first and then by meaning (Duplicate → Canceled, Highest → Urgent). Change any of them.
- **People**: creators and assignees are matched to members by sign-in email, or by display name when the export
  has no emails (Jira). Someone who isn't a member leaves the issue unassigned (and created by you), and their
  name goes in the note at the end of the description. Invite them before importing to keep them.
- **Projects and labels**: projects are created inside the space and labels in the workspace. One with the same
  name (ignoring case) is reused instead. You can also add each issue's type (Bug, Story, feature…) as a label.
- **Fields Pantry has no place for** go into a short note at the end of each description, with the source's key
  and the date the issue was created. Uncheck the ones you don't want. Columns that aren't imported at all are
  listed.
- **Archived issues** are left out unless you check **Include archived issues**.

### How issues come in

- **Keys**: when the space's key is the source's prefix (Linear, Jira), issues keep their numbers, so `ENG-28`
  stays `ENG-28`. A number that's already used in that space gets the next free one. Otherwise issues are
  numbered from the space's counter, and the source's key is in the note.
- **Sub-issues** stay attached to their parent. Pantry's sub-issues go one level deep, so a sub-issue of a
  sub-issue hangs off the top-level issue. A sub-issue whose parent is left out (archived, not in the file, or
  impossible to tell apart) comes in as a normal issue, with a note saying whose sub-issue it was.
- **Dates**: due dates and the time an issue was completed or canceled are kept. The created date goes in the
  note: Pantry's own created time is the time of the import.
- **Timeline**: each imported issue starts with one entry, "imported the issue from Jira" (or Linear, Asana…),
  tagged "via import", under the name of the person who ran it. Imported comments are also tagged "via import".

### Importing again

Every imported issue remembers its id in the source. Importing the same file again skips the issues already in
Pantry and reuses the spaces, projects and labels from last time, so nothing is duplicated. An issue you deleted
in Pantry comes back. You can also import a newer export of the same tool: only what's new comes in.

Issues are written in batches. If an import stops halfway (a lost connection, a closed tab), the issues written
so far stay, and the batch that failed writes nothing. Import the same file again to finish: it picks up where it
stopped.

## Linear

In Linear, open **Settings → Import / Export** and export your issues as CSV: one file with every team.

| Linear | Pantry |
| --- | --- |
| Team | Space (keeps the issue numbers when the key is the team's prefix) |
| Status, Priority | Status, priority (same five priorities) |
| Project | Project in the team's space |
| Labels | Labels |
| Parent issue | Sub-issue |
| Creator, Assignee (emails) | Creator, assignee when they're members |
| Due date, Completed, Canceled | Due date, completion time |
| Milestone, initiatives, cycle, estimate, related / blocked by / duplicate of | The note |
| Updated, Started, Triaged, SLA status, time in status | Not imported |

## Asana (Beta)

Asana exports one project at a time: open the project, click the arrow next to its name, then **Export/Print →
CSV**. Export every project you want and add all the files to one import (**Add file** in the review). Asana's CSV
has no comments, attachments or creator.

| Asana | Pantry |
| --- | --- |
| Project (the file) | A space each, or (the default with several files) projects in one space; switch it in the review |
| Completed At | Done (the "Completed" row of the status mapping) |
| Section/Column of open tasks | Status: each section is a row of the status mapping |
| Name, Notes | Title, description |
| Assignee, Assignee Email | Assignee when they're a member |
| Tags | Labels |
| Due Date | Due date |
| Parent task | Sub-issue (see below) |
| A "Priority" custom field | Priority |
| Start Date, Blocked By / Blocking, other projects of the task, other custom fields | The note |
| Last Modified | Not imported |

Asana's export names a subtask's parent by its **name**, not its id. Pantry looks for that name in the subtask's
own project first, then in all your files. When two tasks have that name, it can't tell which is the parent, so the
subtask comes in as a normal issue with the parent's name in the note (the review tells you how many).

## Shortcut (Beta)

Export the whole workspace with **Export as CSV** on the Organization and Workspace dashboard
(`app.shortcut.com/organizations`), or one Space, Epic or Iteration with **Export as CSV** on its stories. Shortcut's
CSV has no comments and no links between stories.

| Shortcut | Pantry |
| --- | --- |
| Team | Space (or one space for everything; switch it in the review) |
| State (with its workflow when there are several) | Status |
| Type (feature, bug, chore) | Label |
| Epic | Project |
| Requester, first owner | Creator, assignee when they're members |
| Other owners | The note |
| Labels | Labels |
| Tasks | A checklist at the end of the description |
| Priority, due date | Priority, due date |
| Iteration, objective (milestone), estimate, blocked / blocker, external tickets, severity, custom fields | The note |
| Archived stories | Left out unless you include them |

## Jira (Beta)

In Jira, open **Filters → Search work items** (or a project's list), search for the issues you want (for example
`project = ENG`), then **Export → Export CSV (all fields)**. Use "all fields" so comments, sub-tasks and links come
along.

Jira stops each CSV export at a limit: 1,000 issues on the older export, 10,000 on the current one. If your search
has more, export it in batches with JQL, for example `project = ENG AND created < 2026-01-01` and then
`project = ENG AND created >= 2026-01-01`, and add every file to the same import. An issue that's in two files comes
in once, and the review warns when a file stops at exactly 1,000 or 10,000 rows.

| Jira | Pantry |
| --- | --- |
| Project | Space (keeps the issue numbers when the key is the project key) |
| Status + Resolution | Status ("Done · Won't Do" is its own row, mapped to Canceled); Jira's status category helps the guess |
| Priority: Highest, High, Medium, Low, Lowest | Urgent, High, Medium, Low, Low |
| Issue Type | Label (Story, Bug, Task…) |
| Epic | Project, and its issues go into it; or, with **Epics become projects** off, an issue with its issues as sub-issues |
| Sub-task (Parent) | Sub-issue |
| Summary, Description | Title, description (Jira's wiki markup becomes Markdown) |
| Reporter, Assignee | Creator, assignee when they match a member by name |
| Labels | Labels |
| Due date, Resolved | Due date, completion time |
| Comment | Comments, under your name, each starting with who wrote it in Jira and when |
| Sprint, story points, components and versions, issue links, attachment links, environment | The note |
| Updated, votes, watchers, time tracking, rank, other custom fields | Not imported |

Jira writes dates in your site's format and language (`03/Nov/26 10:15 AM` by default). Pantry reads the common
formats in English, German, French, Spanish, Portuguese, Italian and Dutch; a date it can't read is left out and
listed in the review. Jira's export names people by display name, so they're matched to members by name.

## Other CSV

For ClickUp, Trello, Notion, a spreadsheet or anything else with a header row. Pick the file, then say which column
is the title (the only one you need), description, status, priority, labels, assignee, due date, created date,
parent, ID, space and project. Pantry guesses from the column names; change any of them. Columns nobody picks go
into the note, one line each.

- **ID**: map one if the file has it. Re-imports match rows on it, and ids like `ABC-12` keep their numbers in a
  space with the key `ABC`. Without an ID column, rows are matched by title, so a row whose title changed comes in
  again.
- **Space**: rows go into a space per value of this column, or into one space named after the file.
- **Parent**: the parent's ID, or its title when it's unique in the file.
- **Labels and assignees** can be lists (`a, b`, `a; b`, `[a, b]`); the first assignee is used, the others go in
  the note.

## Export

Any member can export. **Download JSON** gives everything as stored: the workspace, members (names and roles),
statuses, labels, spaces, projects, context docs, issues with their sub-issues and comments, and every issue's
activity. **Download issues CSV** has one row per issue with names instead of ids, for spreadsheets. Both are
built in your browser, a page at a time, so large workspaces work too.
