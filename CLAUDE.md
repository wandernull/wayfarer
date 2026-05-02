# Claude Code instructions

**Before you do anything in this repo, read [`AGENTS.md`](./AGENTS.md) end-to-end.** It is the source of truth for architecture, design decisions, current production status, conventions, and open work. Don't re-derive any of that from the code — it's faster and safer to read the doc.

## Keep AGENTS.md in sync

`AGENTS.md` is a living document. Whenever you make a change that future-you (or another agent) would need to know about, **update the relevant section in the same commit**. The bar is *"would skipping this update cost the next session more than 30 seconds of confusion?"* — if yes, update.

Specifically, update AGENTS.md when you:

- **Ship a new feature** → add a brief note to the pipeline diagram, the relevant "key state shape" / "endpoints" section, and (if shipped + verified) move it from "Open work" to a status line.
- **Make a design decision** → add a numbered entry to "Design decisions worth knowing (the *why*)". Capture both the decision AND the reasoning, because the *why* is what gets lost first.
- **Change architecture** → update the pipeline diagram, the state shape, and any affected endpoint table rows. Don't just edit code and assume the doc is "obviously" stale.
- **Complete an open-work item** → either delete it from "Open work" / "Known sharp edges" / "Worth doing soon" or move it under "Status" with a verification date.
- **Discover a new sharp edge or limitation** → add it to "Known sharp edges" with one line on what's wrong and one line on what would fix it.
- **Change conventions** → update "Conventions" (i18n keys, CSS naming, console log prefixes, etc.).
- **Rotate or change env vars / secrets / bindings** → reflect in "Stack" and the Stripe ops cheatsheet under "Status".

## Don't

- Don't let AGENTS.md drift. A doc that's wrong in places is worse than no doc, because it costs trust.
- Don't pad it. Tight bullets > long paragraphs. The current doc fits in one read; keep it that way.
- Don't move sensitive values (API keys, webhook secrets, customer PII) into AGENTS.md. It's tracked in git.
- Don't skip the update because "the commit is small." Small undocumented changes compound into a stale doc fastest.

## Workflow

1. Read AGENTS.md.
2. Do the work.
3. Update AGENTS.md if any of the bullets above apply.
4. Commit code change + AGENTS.md edit together.
