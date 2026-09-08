# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Tickets index

Also maintain a generated index at `.scratch/<feature-slug>/tickets.md` listing,
for each ticket: number, title, one-line summary, `Status`, and `Blocked by`,
each linking to its issue file. Refresh it only when tickets are published, when
`/triage` changes a `Status`, or once after each merge in `/implement-spec`.
Never refresh it from a concurrent worker context.

The manifest is an entry point, never the source of truth. If `tickets.md` and
an issue file's `Status:` line disagree, the issue file wins; refresh the manifest.

```markdown
# Tickets: <feature-slug>

Generated index — resolves to the issue files below. Source of truth is `issues/`.

| # | Title | Summary | Status | Blocked by |
|---|---|---|---|---|
| [01](issues/01-slug.md) | Ticket title | One-line summary | ready-for-human | None |
| [02](issues/02-slug.md) | Ticket title | One-line summary | ready-for-agent | 01 |
```
