Bring your issues in from Linear, or download everything in your workspace. Both live in **Settings → Import
and Export**.

## Import from Linear

Only the workspace owner can import, because an import creates spaces, projects and labels for everyone.

1. In Linear, open **Settings → Import / Export** and export your issues as CSV.
2. In Pantry, open **Settings → Import and Export**, choose **Linear** and pick the file. It's read in your
   browser; nothing is written yet.
3. Review what will happen, change anything you want, then press **Import**.

### What the review shows

- **Counts**: how many spaces, projects, labels, issues and sub-issues the import makes, and how many issues it
  skips (archived, or already imported).
- **Teams**: each Linear team goes into a space. By default that's a new space named after the team, with the
  team's prefix as its key (`ENG` for `ENG-12`). You can rename it, change the key, or pick an existing space
  instead.
- **Statuses**: each Linear status is mapped to one of your six statuses, by name first and then by meaning
  (Duplicate → Canceled). Change any of them.
- **Priorities**: Linear's five priorities are the same as Pantry's, so they map one to one.
- **People**: creators and assignees are matched to members by their sign-in email. Someone who isn't a member
  leaves the issue unassigned (and created by you), and their email goes in the note at the end of the
  description. Invite them before importing to keep them.
- **Projects and labels**: projects are created inside the team's space and labels in the workspace. One with the
  same name (ignoring case) is reused instead.
- **Linear-only fields**: Pantry has no field for project milestones, initiatives, cycles, estimates or issue
  relations (related to, blocked by, duplicate of). The ones you leave checked go into a short note at the end of
  each description, with the Linear key and the date it was created. Update times, start and triage times, SLA
  status and time in status aren't imported.
- **Archived issues** are left out unless you check **Include archived issues**.

### How issues come in

- **Keys**: when the space's key is the team's prefix, issues keep their numbers, so `ENG-28` stays `ENG-28`. A
  number that's already used in that space gets the next free one. In a space with another key, issues are
  numbered from that space's counter, and the Linear key is in the note.
- **Sub-issues** stay attached to their parent. Pantry's sub-issues go one level deep, so a sub-issue of a
  sub-issue hangs off the top-level issue. A sub-issue whose parent is left out (archived, or not in the file)
  comes in as a normal issue, with a note saying whose sub-issue it was.
- **Dates**: due dates and the time an issue was completed or canceled are kept. The created date goes in the
  note: Pantry's own created time is the time of the import.
- **Timeline**: each imported issue starts with one entry, "imported the issue from Linear", tagged
  "via import", under the name of the person who ran it.

### Importing again

Every imported issue remembers its Linear id. Importing the same file again skips the issues already in Pantry
and reuses the spaces, projects and labels from last time, so nothing is duplicated. An issue you deleted in
Pantry comes back.

Issues are written in batches. If an import stops halfway (a lost connection, a closed tab), the issues written
so far stay, and the batch that failed writes nothing. Import the same file again to finish: it picks up where it
stopped.

## Export

Any member can export. **Download JSON** gives everything as stored: the workspace, members (names and roles),
statuses, labels, spaces, projects, context docs, issues with their sub-issues and comments, and every issue's
activity. **Download issues CSV** has one row per issue with names instead of ids, for spreadsheets. Both are
built in your browser, a page at a time, so large workspaces work too.
