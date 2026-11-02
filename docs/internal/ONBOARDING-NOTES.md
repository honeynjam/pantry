# Onboarding and workspace modes: notes for Kris

Branch `feat/onboarding` (from `origin/main` f8be5de). What shipped is in the spec (§3, §4, §5, §10 "First run",
§10b "Onboarding and workspace modes"); this file lists the calls I made that you may want to change.

## Decisions to check

1. **Everyone without `onboardedAt` sees onboarding once**, including you and your partner on the live instance
   after this deploys. You get the owner flow (your spaces are listed, nothing is offered for renaming because
   PAN has issues); your partner gets the short member flow. "Skip setup" / "Skip" ends it at once and marks it
   done. If you'd rather existing members skip it, a one-off migration can set `onboardedAt` for rows created
   before the deploy.
2. **Missing mode means product**, so existing workspaces look exactly as before ("Products" instead of
   "Spaces" in the sidebar) until the owner picks something in onboarding or Settings → General.
3. **One kind, but spaces of the other kind exist:** they still show, under their own heading (e.g. a product
   workspace with one client shows "Products" and "Clients"). Hiding them felt like data loss.
4. **The sample is renamed, not replaced:** offered only while it's untouched (still `Pantry`/`PAN`, never had
   an issue or a project, template context doc). To allow the key change, `spaces.update` now takes `key`
   while a space has never had an issue; the key is fixed after the first issue, as before. Space settings
   doesn't expose the key edit (it still says the key is fixed); only onboarding uses it.
5. **The one-line description** fills the "What this space is" placeholder of the context doc, only while the
   placeholder is still there, so re-runs never overwrite a doc you wrote.
6. **Suggested keys are three letters** (same rule as the new-space dialog): "Acme Ltd" → `ACM`. Editable.
7. **Enter to continue** is a page-local key handler (like a dialog's), not a registry shortcut: the app's
   shortcut listener isn't mounted on `/welcome`, so `C`, `J`/`K` and the palette don't fire there. Enter in a
   text field submits that field's form (the step, or "Create invite link" / "Create token").
8. **"Products" wording for spaces** is applied to headings, buttons, dialogs, settings, Home, the palette and
   the space settings title; longer sentences elsewhere (e.g. "Agents read this before working in this space")
   still say "space". The MCP tools keep "space" everywhere, as asked.
9. **Impeccable's font and colour rules** (no Inter/Geist, tinted neutrals, a bold aesthetic) conflict with the
   approved Pantry system (monochrome, Geist/Inter, §9c), so I followed the project's system and used the
   skills for structure, copy, forms and motion.

## Not verified

- The desktop (Tauri) app: `/welcome` is routed in the spike's memory router and it typechecks, but I didn't run
  the Mac app.
- Touch devices: autofocus is skipped on coarse pointers by design; not tried on a phone.
