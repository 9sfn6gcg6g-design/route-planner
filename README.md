# Route Planner

Session-aware route generation for runners — the session drives the route,
not the other way round.

See [`docs/domain.md`](docs/domain.md) for the domain model and product
decisions.

## Getting started

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view it.

## Checks

All three must pass before every commit, and CI runs them on every PR:

```bash
npm run lint
npm run typecheck
npm test
```

## Contributing

More than one person works in this repo. Read
[`AGENTS.md`](AGENTS.md) first — it holds the working agreements
(layering rules, commit and branch conventions, and how to claim a plan so two
people don't work the same slice). Agents load it automatically; humans should
read it too.

Work is tracked as **plans of record** in
[`docs/superpowers/plans/`](docs/superpowers/plans/). Each plan's status header
says who owns it and whether it's in progress.
