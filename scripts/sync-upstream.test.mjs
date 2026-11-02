// Runs scripts/test-sync-upstream.sh (the local dry run of .github/workflows/sync-upstream.yml) as part of
// `pnpm test:scripts`. Needs bash, git 2.38+ and ruby, which GitHub's Ubuntu runners have.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "test-sync-upstream.sh");
const hasRuby = spawnSync("ruby", ["--version"]).status === 0;

test(
  "sync-upstream workflow: every scenario in test-sync-upstream.sh",
  { skip: !hasRuby && "ruby isn't installed" },
  () => {
    const run = spawnSync("bash", [script], { encoding: "utf8", timeout: 120_000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /All sync-upstream checks passed\./);
  },
);
