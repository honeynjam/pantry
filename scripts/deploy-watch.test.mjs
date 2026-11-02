// Tests for deploy-watch.mjs (the decision logic of .github/workflows/deploy-watch.yml).
// Run with: node --test "scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  decide,
  issueFor,
  tagFromBranch,
  targetFromEvent,
  updateFromPulls,
} from "./deploy-watch.mjs";

const merged = "2026-10-29T10:00:00Z";
const at = (minutes) => Date.parse(merged) + minutes * 60_000;
const iso = (minutes) => new Date(at(minutes)).toISOString();
const deployment = (environment, minutes, ...states) => ({
  id: minutes,
  environment,
  created_at: iso(minutes),
  // GitHub returns statuses newest first; the order here is deliberately oldest first.
  statuses: states.map((state, i) => ({
    state,
    created_at: iso(minutes + i + 1),
    target_url: `https://vercel.com/acme/pantry/${minutes}`,
    log_url: `https://vercel.com/acme/pantry/${minutes}/logs`,
  })),
});
const verdict = (input) =>
  decide({ deployments: [], statuses: [], startedAt: merged, minutes: 30, ...input });

describe("decide", () => {
  test("success when the production deploy succeeded", () => {
    const result = verdict({
      deployments: [deployment("Production", 1, "pending", "success")],
      now: at(5),
    });
    assert.equal(result.state, "success");
  });

  test("failure when the production deploy failed or errored, with the build log link", () => {
    for (const state of ["failure", "error"]) {
      const result = verdict({
        deployments: [deployment("Production – pantry", 1, "in_progress", state)],
        now: at(5),
      });
      assert.equal(result.state, "failure");
      assert.equal(result.url, "https://vercel.com/acme/pantry/1/logs");
    }
  });

  test("a later successful redeploy of the same commit wins over an earlier failure", () => {
    const deployments = [
      deployment("Production", 1, "failure"),
      deployment("Production", 10, "success"),
    ];
    assert.equal(verdict({ deployments, now: at(12) }).state, "success");
  });

  test("preview deployments are ignored", () => {
    const result = verdict({ deployments: [deployment("Preview", 1, "failure")], now: at(5) });
    assert.equal(result.state, "pending");
  });

  test("pending while running inside the time limit, timeout after it", () => {
    const deployments = [deployment("Production", 1, "queued", "in_progress")];
    assert.equal(verdict({ deployments, now: at(29) }).state, "pending");
    const late = verdict({ deployments, now: at(30) });
    assert.equal(late.state, "timeout");
    assert.equal(late.reported, true);
  });

  test("timeout with nothing reported at all", () => {
    const result = verdict({ now: at(31) });
    assert.deepEqual([result.state, result.reported], ["timeout", false]);
  });

  test("falls back to Vercel's commit statuses", () => {
    const status = (state, minutes, context = "Vercel") => ({
      context,
      state,
      updated_at: iso(minutes),
      target_url: "https://vercel.com/acme/pantry/x",
    });
    assert.equal(verdict({ statuses: [status("success", 3)], now: at(5) }).state, "success");
    assert.equal(
      verdict({ statuses: [status("pending", 1), status("failure", 3)], now: at(5) }).state,
      "failure",
    );
    // The newest status per context counts: a retry that succeeded clears the earlier failure.
    assert.equal(
      verdict({ statuses: [status("failure", 1), status("success", 3)], now: at(5) }).state,
      "success",
    );
    // Other services' statuses don't count.
    assert.equal(
      verdict({ statuses: [status("failure", 3, "ci/circleci")], now: at(5) }).state,
      "pending",
    );
  });

  test("a successful deployment beats a failed status", () => {
    const deployments = [deployment("Production", 1, "success")];
    const statuses = [{ context: "Vercel", state: "failure", updated_at: iso(2) }];
    assert.equal(verdict({ deployments, statuses, now: at(5) }).state, "success");
  });
});

describe("which commit to watch", () => {
  test("a merged Sync upstream PR", () => {
    const event = {
      pull_request: {
        merged: true,
        head: { ref: "sync-upstream/v0.2.0" },
        merge_commit_sha: "abc",
        merged_at: merged,
      },
    };
    assert.deepEqual(targetFromEvent("pull_request", event), {
      sha: "abc",
      tag: "v0.2.0",
      startedAt: merged,
    });
  });

  test("skips closed-unmerged PRs and other branches", () => {
    const closed = { pull_request: { merged: false, head: { ref: "sync-upstream/v0.2.0" } } };
    assert.ok(targetFromEvent("pull_request", closed).skip);
    const other = { pull_request: { merged: true, head: { ref: "feature/x" } } };
    assert.ok(targetFromEvent("pull_request", other).skip);
  });

  test("a failed production deployment status", () => {
    const event = (state, environment) => ({
      deployment_status: { state },
      deployment: { sha: "def", environment, created_at: merged },
    });
    assert.deepEqual(targetFromEvent("deployment_status", event("failure", "Production")), {
      sha: "def",
      tag: null,
      startedAt: merged,
    });
    assert.ok(targetFromEvent("deployment_status", event("success", "Production")).skip);
    assert.ok(targetFromEvent("deployment_status", event("failure", "Preview")).skip);
  });

  test("only merged Sync upstream PRs count as updates", () => {
    assert.equal(tagFromBranch("sync-upstream/v1.0.0"), "v1.0.0");
    assert.equal(tagFromBranch("sync-upstream/"), null);
    assert.equal(tagFromBranch("main"), null);
    assert.deepEqual(
      updateFromPulls([
        { merged_at: null, head: { ref: "sync-upstream/v0.3.0" } },
        { merged_at: merged, head: { ref: "fix/typo" } },
        { merged_at: merged, head: { ref: "sync-upstream/v0.2.0" } },
      ]),
      { tag: "v0.2.0", mergedAt: merged },
    );
    assert.equal(updateFromPulls([{ merged_at: merged, head: { ref: "fix/typo" } }]), null);
  });
});

describe("issueFor", () => {
  test("names the release, links the build log and the migration fix", () => {
    const { title, body } = issueFor({
      repo: "kris/my-pantry",
      sha: "0123456789abcdef",
      tag: "v0.2.0",
      verdict: { state: "failure", url: "https://vercel.com/acme/pantry/1/logs" },
    });
    assert.equal(title, "Pantry v0.2.0 didn't deploy");
    assert.match(body, /https:\/\/vercel\.com\/acme\/pantry\/1\/logs/);
    assert.match(body, /scripts\/migrate\.sh --prod/);
    assert.match(body, /docs\/MIGRATIONS\.md#if-it-fails/);
    assert.match(body, /PANTRY_DEPLOY_WATCH/);
  });

  test("explains a timeout with nothing reported", () => {
    const { body } = issueFor({
      repo: "kris/my-pantry",
      sha: "0123456789abcdef",
      tag: "v0.2.0",
      verdict: { state: "timeout", reported: false, minutes: 30, url: null },
    });
    assert.match(
      body,
      /hadn't reported a production deploy for this commit 30 minutes after the merge/,
    );
  });
});
