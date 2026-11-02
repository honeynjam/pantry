Every space has a context doc: Markdown your agents read before they start work on any of its issues. Agents get
it with `get_space_context`, and the MCP server tells them to read it first, so it's the best place for anything
you'd otherwise repeat in every prompt.

Edit it in the space's settings. Agents can rewrite it with `update_space_context`, which replaces the whole doc,
so they're told to read it first and keep what still holds.

## What to put in it

- **What the space is:** the product or client, who it's for, what matters right now.
- **Where the code lives:** repos, the main folders, how to run it and how to run the tests.
- **Conventions:** naming, style, how you want commits, PRs and comments written.
- **What not to touch:** generated files, migrations to leave alone, anything that needs a person.
- **How to finish:** what "done" means here, and which status to move the issue to.

## Example

```markdown
# Website

Marketing site for Acme. Next.js on Vercel, repo acme/website.

## Working here
- `pnpm dev` runs it on :3000; `pnpm check` before you finish.
- Copy lives in content/*.md. Never edit the generated sitemap.
- Small commits; one PR per issue, titled with the issue key.

## Done
Move the issue to In Review and comment with the PR link and anything you couldn't check.
```

Keep it short. Agents read the whole doc for every issue, and a page they follow beats ten they skim.
