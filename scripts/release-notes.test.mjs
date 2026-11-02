// Tests for release-notes.mjs. Run with: node --test "scripts/*.test.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { releaseNotes } from "./release-notes.mjs";

const changelog = `# Changelog

## [Unreleased]

- Not out yet.

## [1.1.0] - 2026-11-02

<!-- a note for the maintainer -->

### Fixed

- The board scrolls.

## [1.0.0] - 2026-10-30

### Added

- Everything.

[Unreleased]: https://github.com/honeynjam/pantry/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/honeynjam/pantry/releases/tag/v1.1.0
`;

describe("release-notes", () => {
  test("returns one version's section without comments or link definitions", () => {
    assert.equal(releaseNotes(changelog, "1.1.0"), "### Fixed\n\n- The board scrolls.\n");
    assert.equal(releaseNotes(changelog, "1.0.0"), "### Added\n\n- Everything.\n");
  });

  test("fails for a missing version", () => {
    assert.throws(() => releaseNotes(changelog, "2.0.0"), /no "## \[2\.0\.0\]" section/);
  });

  test("fails for a section without a date", () => {
    const undated = changelog.replace("## [1.1.0] - 2026-11-02", "## [1.1.0] - Unreleased");
    assert.throws(() => releaseNotes(undated, "1.1.0"), /needs a release date/);
  });

  test("fails for an empty section", () => {
    const empty =
      "## [1.0.0] - 2026-10-30\n\n<!-- nothing yet -->\n\n## [0.9.0] - 2026-10-01\n\n- Old.\n";
    assert.throws(() => releaseNotes(empty, "1.0.0"), /section is empty/);
  });

  test("treats dots in the version literally", () => {
    assert.throws(() => releaseNotes(changelog, "1x1x0"), /no "## \[1x1x0\]" section/);
  });

  test("keeps a Pantry-Review marker line, which Sync upstream reads from the release notes", () => {
    const marked = changelog.replace(
      "<!-- a note for the maintainer -->",
      "Pantry-Review: manual\n\n**Review this update before merging.**",
    );
    // The same pattern as .github/workflows/sync-upstream.yml (grep -Ei).
    assert.match(releaseNotes(marked, "1.1.0"), /^[ \t]*Pantry-Review:[ \t]*manual[ \t]*$/im);
    assert.doesNotMatch(releaseNotes(changelog, "1.1.0"), /Pantry-Review/);
  });

  test("the real changelog has a section for the repo's version that can be extracted once it's dated", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const real = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const heading = new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\] - Unreleased$`, "m");
    const dated = real.replace(heading, `## [${version}] - 2026-10-26`);
    const notes = releaseNotes(dated, version);
    assert.match(notes, /^### (Added|Changed|Deprecated|Removed|Fixed|Security)$/m);
    assert.doesNotMatch(notes, /TODO|\[Unreleased\]/);
  });
});
