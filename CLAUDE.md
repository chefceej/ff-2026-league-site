# ff-2026-league-site

Static GitHub Pages site showing cumulative ranking-point standings for a
12-team ESPN fantasy football league. `docs/` is production. See `README.md`.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature-slug>/`, one file
per ticket, with a generated `tickets.md` index. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, created
lazily. See `docs/agents/domain.md`.
