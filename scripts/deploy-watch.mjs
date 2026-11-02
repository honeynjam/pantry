#!/usr/bin/env node
// Watches the production deploy of a merged Pantry update and opens an issue "Pantry vX.Y.Z didn't deploy" when
// Vercel reports a failure or never finishes. Run by .github/workflows/deploy-watch.yml in self-hosted copies;
// it talks to GitHub through the `gh` CLI with the workflow's built-in token.
//
// Vercel's build runs `convex deploy` and then the data migration (scripts/migrate.sh). If the migration fails,
// the new backend is already live while Vercel keeps serving the previous web app, so the owner needs to hear
// about it. The decision functions are pure and tested in deploy-watch.test.mjs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const UPSTREAM_REPO = "honeynjam/pantry";
export const BRANCH_PREFIX = "sync-upstream/";
export const DEFAULT_MINUTES = 30;

const FAILED = new Set(["failure", "error"]);
const newestFirst = (a, b) =>
  Date.parse(b.created_at ?? b.updated_at ?? 0) - Date.parse(a.created_at ?? a.updated_at ?? 0);
const isProduction = (environment) => /production/i.test(environment ?? "");

/** The release tag of a Sync upstream branch (`sync-upstream/v0.2.0` → `v0.2.0`), or null for any other branch. */
export function tagFromBranch(ref) {
  return typeof ref === "string" &&
    ref.startsWith(BRANCH_PREFIX) &&
    ref.length > BRANCH_PREFIX.length
    ? ref.slice(BRANCH_PREFIX.length)
    : null;
}

/** The merged Sync upstream PR among a commit's PRs (GET /repos/{repo}/commits/{sha}/pulls), or null. */
export function updateFromPulls(pulls) {
  const pr = (pulls ?? []).find((p) => p.merged_at && tagFromBranch(p.head?.ref));
  return pr ? { tag: tagFromBranch(pr.head.ref), mergedAt: pr.merged_at } : null;
}

/**
 * What to watch for this workflow event, or { skip: reason }.
 * - pull_request (closed): a merged Sync upstream PR → its merge commit, from the merge time.
 * - deployment_status: a failed production deploy → its commit (whether it's an update is checked via the API).
 * - workflow_dispatch: the given commit, or (sha empty) the last merged update, looked up via the API.
 */
export function targetFromEvent(eventName, event, input = {}) {
  if (eventName === "pull_request") {
    const pr = event.pull_request ?? {};
    const tag = tagFromBranch(pr.head?.ref);
    if (!pr.merged || !tag) return { skip: "not a merged Sync upstream PR" };
    return { sha: pr.merge_commit_sha, tag, startedAt: pr.merged_at };
  }
  if (eventName === "deployment_status") {
    const state = event.deployment_status?.state;
    const deployment = event.deployment ?? {};
    if (!FAILED.has(state)) return { skip: `deployment state is ${state}` };
    if (!isProduction(deployment.environment))
      return { skip: `not a production deploy (${deployment.environment})` };
    return { sha: deployment.sha, tag: null, startedAt: deployment.created_at };
  }
  if (eventName === "workflow_dispatch") {
    return { sha: input.sha || null, tag: null, startedAt: null };
  }
  return { skip: `unsupported event ${eventName}` };
}

/** The newest production deployment's latest status: success | failure | pending | none (+ its link). */
export function deploymentVerdict(deployments) {
  const production = (deployments ?? [])
    .filter((d) => isProduction(d.environment))
    .sort(newestFirst);
  const newest = production[0];
  if (!newest) return { state: "none" };
  const latest = [...(newest.statuses ?? [])].sort(newestFirst)[0];
  const url = latest?.log_url || latest?.target_url || latest?.environment_url || null;
  if (!latest) return { state: "pending", url };
  if (latest.state === "success") return { state: "success", url };
  if (FAILED.has(latest.state)) return { state: "failure", url, description: latest.description };
  return { state: "pending", url };
}

/** Vercel's commit statuses (context contains "vercel"), newest per context: success | failure | pending | none. */
export function statusVerdict(statuses) {
  const latestByContext = new Map();
  for (const status of [...(statuses ?? [])]
    .filter((s) => /vercel/i.test(s.context ?? ""))
    .sort(newestFirst)) {
    if (!latestByContext.has(status.context)) latestByContext.set(status.context, status);
  }
  const latest = [...latestByContext.values()];
  if (latest.length === 0) return { state: "none" };
  const failed = latest.find((s) => FAILED.has(s.state));
  if (failed)
    return { state: "failure", url: failed.target_url ?? null, description: failed.description };
  if (latest.every((s) => s.state === "success"))
    return { state: "success", url: latest[0].target_url ?? null };
  return { state: "pending", url: latest[0].target_url ?? null };
}

/**
 * The verdict on one commit's production deploy:
 * - success: the newest production deployment succeeded (or, without deployments, Vercel's commit status did);
 * - failure: it failed or errored (a later successful redeploy of the same commit wins);
 * - timeout: nothing final `minutes` after `startedAt` (no deploy reported, or still running);
 * - pending: nothing final yet, still inside the time limit.
 */
export function decide({ deployments, statuses, startedAt, now, minutes = DEFAULT_MINUTES }) {
  const deployment = deploymentVerdict(deployments);
  const status = statusVerdict(statuses);
  if (deployment.state === "success") return { state: "success", url: deployment.url };
  if (deployment.state === "failure") return deployment;
  if (deployment.state === "none" && status.state === "success")
    return { state: "success", url: status.url };
  if (status.state === "failure") return status;
  const url = deployment.url ?? status.url ?? null;
  const elapsed = (now - Date.parse(startedAt ?? new Date(now).toISOString())) / 60000;
  if (elapsed >= minutes) {
    const reported = deployment.state !== "none" || status.state !== "none";
    return { state: "timeout", url, reported, minutes };
  }
  return { state: "pending", url };
}

/** The issue to open for a failed or timed-out update. */
export function issueFor({ repo, sha, tag, verdict }) {
  const name = tag ? `Pantry ${tag}` : `Pantry update ${sha.slice(0, 7)}`;
  const release = tag ? `[${name}](https://github.com/${UPSTREAM_REPO}/releases/tag/${tag})` : name;
  const commit = `[\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})`;
  const link = verdict.url
    ? `[the Vercel deployment](${verdict.url})`
    : "the deployment in your Vercel dashboard";
  const what =
    verdict.state === "failure"
      ? `Vercel reported that the production deploy **failed** (${link}).` +
        (verdict.description ? ` It said: "${verdict.description}".` : "")
      : verdict.reported
        ? `Vercel hadn't finished the production deploy ${verdict.minutes} minutes after the merge (${link}).`
        : `Vercel hadn't reported a production deploy for this commit ${verdict.minutes} minutes after the merge. ` +
          "Check that your Vercel project is connected to this repo and deploys its default branch.";
  const body = `The update to ${release} merged in ${commit}, but it isn't live. ${what}

**Why it matters.** The Vercel build pushes the new Convex functions first and runs the data migration
(\`scripts/migrate.sh\`) after them. If the build stopped after that point, your instance is running the new backend
with the previous web app until a build succeeds.

**What to do**

1. Open ${link} and read the end of the build log.
2. If the migration failed, its error names the rows it couldn't place. Fix or delete them in the Convex dashboard
   (Data), then redeploy in Vercel (Deployments → ⋯ → Redeploy), or run \`bash scripts/migrate.sh --prod\` from a
   clone with \`CONVEX_DEPLOY_KEY\` set. Re-running the migration is always safe. Details:
   [docs/MIGRATIONS.md → If it fails](https://github.com/${repo}/blob/${sha}/docs/MIGRATIONS.md#if-it-fails).
3. For other build errors, see the README's troubleshooting list.

Close this issue once a deploy succeeds.

Opened by the \`Watch update deploys\` workflow (\`.github/workflows/deploy-watch.yml\`). To turn it off, set the
repository variable \`PANTRY_DEPLOY_WATCH\` to \`false\`.
`;
  return { title: `${name} didn't deploy`, body };
}

// ---- CLI (GitHub Actions) ------------------------------------------------------------------------------------------

function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: [input ? "pipe" : "ignore", "pipe", "inherit"],
  });
}
const api = (path) => JSON.parse(gh(["api", path]));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchState(repo, sha) {
  const deployments = api(`repos/${repo}/deployments?sha=${sha}&per_page=100`).map((d) => ({
    ...d,
    statuses: api(`repos/${repo}/deployments/${d.id}/statuses?per_page=100`),
  }));
  const statuses = api(`repos/${repo}/commits/${sha}/status`).statuses ?? [];
  return { deployments, statuses };
}

function lastMergedUpdate(repo) {
  const prs = JSON.parse(
    gh([
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "merged",
      "--limit",
      "50",
      "--json",
      "headRefName,mergeCommit,mergedAt",
    ]),
  )
    .filter((pr) => tagFromBranch(pr.headRefName) && pr.mergeCommit?.oid)
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
  const pr = prs[0];
  return pr
    ? { sha: pr.mergeCommit.oid, tag: tagFromBranch(pr.headRefName), startedAt: pr.mergedAt }
    : null;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  if (repo.toLowerCase() === UPSTREAM_REPO)
    return console.log(`This is ${UPSTREAM_REPO} itself; nothing to watch.`);
  const minutes = Number(process.env.WATCH_MINUTES) || DEFAULT_MINUTES;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
    : {};

  let target = targetFromEvent(eventName, event, { sha: process.env.INPUT_SHA });
  if (target.skip) return console.log(`Nothing to watch: ${target.skip}.`);
  if (!target.sha) {
    const last = lastMergedUpdate(repo);
    if (!last) return console.log("No merged Sync upstream PR found; nothing to watch.");
    target = { ...target, ...last };
  }
  if (!target.tag || !target.startedAt) {
    const update = updateFromPulls(api(`repos/${repo}/commits/${target.sha}/pulls`));
    if (!update)
      return console.log(`${target.sha} isn't a merged Pantry update; nothing to watch.`);
    target = {
      ...target,
      tag: target.tag ?? update.tag,
      startedAt: target.startedAt ?? update.mergedAt,
    };
  }

  console.log(
    `Watching the production deploy of ${target.tag} (${target.sha}) for up to ${minutes} minutes.`,
  );
  let verdict;
  for (;;) {
    verdict = decide({
      ...fetchState(repo, target.sha),
      startedAt: target.startedAt,
      now: Date.now(),
      minutes,
    });
    console.log(`→ ${verdict.state}${verdict.url ? ` (${verdict.url})` : ""}`);
    if (verdict.state !== "pending") break;
    await sleep(30_000);
  }
  if (verdict.state === "success") return console.log(`${target.tag} deployed.`);

  const issue = issueFor({ repo, sha: target.sha, tag: target.tag, verdict });
  const open = JSON.parse(
    gh([
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--search",
      `"${issue.title}" in:title`,
      "--json",
      "title,url",
    ]),
  ).find((i) => i.title === issue.title);
  if (open) return console.log(`An issue is already open: ${open.url}`);
  const url = gh(
    ["issue", "create", "--repo", repo, "--title", issue.title, "--body-file", "-"],
    issue.body,
  ).trim();
  console.log(`::warning::${issue.title}: ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
