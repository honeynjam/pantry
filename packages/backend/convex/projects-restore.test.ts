import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { isProject } from "./lib/model";
import { messageOf, setUp } from "./mcp.fixtures";

const partner = { subject: "user-partner", name: "Partner", email: "partner@example.com" };

/** Names of PAN's active projects, in the app's order. */
const active = async (s: Awaited<ReturnType<typeof setUp>>) =>
  (await s.as.query(api.workspace.current, {})).projects
    .filter((project) => project.spaceId === s.spaceId)
    .map((project) => project.name);

describe("projects.restore (un-archive)", () => {
  it("brings the project back at the end of the order; its old issues stay without a project", async () => {
    const s = await setUp();
    const marketing = await s.as.mutation(api.projects.create, {
      spaceId: s.spaceId,
      name: "Marketing",
    });
    const { issueId } = await s.as.mutation(api.issues.create, {
      spaceId: s.spaceId,
      projectId: s.launchId,
      title: "In Launch",
    });
    await s.as.mutation(api.projects.archive, { projectId: s.launchId });
    expect(await active(s)).toEqual(["Marketing"]);
    expect(
      (await s.as.query(api.projects.listArchived, { spaceId: s.spaceId })).map((p) => p.name),
    ).toEqual(["Launch"]);

    await s.as.mutation(api.projects.restore, { projectId: s.launchId });
    expect(await active(s)).toEqual(["Marketing", "Launch"]);
    expect(await s.as.query(api.projects.listArchived, { spaceId: s.spaceId })).toEqual([]);
    const issue = await s.t.run((ctx) => ctx.db.get("issues", issueId));
    expect(issue!.projectId).toBeUndefined();
    // Restoring an active project is a no-op.
    await s.as.mutation(api.projects.restore, { projectId: marketing });
    expect(await active(s)).toEqual(["Marketing", "Launch"]);
  });

  it("refuses a name an active project now has; renaming the archived one first works", async () => {
    const s = await setUp();
    await s.as.mutation(api.projects.archive, { projectId: s.launchId });
    await s.as.mutation(api.projects.create, { spaceId: s.spaceId, name: "launch" });
    expect(await messageOf(s.as.mutation(api.projects.restore, { projectId: s.launchId }))).toBe(
      "There's already an active project called launch in Pantry. Rename one of them first, then restore.",
    );
    // The settings screen renames the archived row inline (projects.update allows it), then restores.
    await s.as.mutation(api.projects.update, { projectId: s.launchId, name: "Launch 2025" });
    await s.as.mutation(api.projects.restore, { projectId: s.launchId });
    expect(await active(s)).toEqual(["launch", "Launch 2025"]);
  });

  it("can restore under a new name in one step, still checked for clashes", async () => {
    const s = await setUp();
    await s.as.mutation(api.projects.archive, { projectId: s.launchId });
    await s.as.mutation(api.projects.create, { spaceId: s.spaceId, name: "Launch" });
    expect(
      await messageOf(
        s.as.mutation(api.projects.restore, { projectId: s.launchId, name: "LAUNCH" }),
      ),
    ).toMatch(/already an active project called Launch/);
    await s.as.mutation(api.projects.restore, { projectId: s.launchId, name: "Old launch" });
    expect(await active(s)).toEqual(["Launch", "Old launch"]);
  });

  it("is refused in an archived space", async () => {
    const s = await setUp();
    await s.as.mutation(api.projects.archive, { projectId: s.launchId });
    await s.as.mutation(api.spaces.archive, { spaceId: s.spaceId });
    expect(await messageOf(s.as.mutation(api.projects.restore, { projectId: s.launchId }))).toBe(
      "Pantry is archived.",
    );
  });

  it("is open to any member, like archive; never to another workspace", async () => {
    const s = await setUp();
    await s.as.mutation(api.projects.archive, { projectId: s.launchId });
    await s.t.withIdentity(partner).mutation(api.projects.restore, { projectId: s.launchId });
    expect(await active(s)).toEqual(["Launch"]);

    const theirs = await s.t.run(async (ctx) => {
      const project = (await ctx.db.query("projects").collect())
        .filter(isProject)
        .find((p) => p.name === "Secret")!;
      await ctx.db.patch("projects", project._id, { archivedAt: 1 });
      return { projectId: project._id, spaceId: project.spaceId };
    });
    expect(
      await messageOf(s.as.mutation(api.projects.restore, { projectId: theirs.projectId })),
    ).toBe("Project not found.");
    expect(
      await messageOf(s.as.query(api.projects.listArchived, { spaceId: theirs.spaceId })),
    ).toBe("Space not found.");
    await expect(
      s.t
        .withIdentity({ subject: "stranger" })
        .mutation(api.projects.restore, { projectId: s.launchId }),
    ).rejects.toThrow(/not a member/);
  });
});
