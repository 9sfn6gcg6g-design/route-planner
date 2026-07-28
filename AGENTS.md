<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Route Planner — working agreements

An app that generates running routes **from the planned session**. The session
drives the route, not the other way round.

More than one person works in this repo, each with their own agent. These are
the rules that keep the two halves of the codebase looking like one codebase.
They are binding on humans and agents alike.

## Read before writing code

**`docs/domain.md` is the single source of truth** for the domain model and for
the numbered **decisions of record**. Read it before touching anything under
`src/lib/`. Do not restate its rules here or in plans — cite them by number
(e.g. "decision 10") so there is only ever one copy to keep current.

Use its ubiquitous language in code, tests, comments and commit messages:
Session, SessionPlan, Phase, TerrainRequirements, WorkPattern, Quietness,
Signal, Chain. If you find yourself inventing a synonym for one of those, use
the existing term instead — or change `docs/domain.md` deliberately, in its own
commit, and say why.

If a decision of record turns out to be wrong, **amend `docs/domain.md` first**
and land that as its own commit. Never let code silently contradict it; a
divergence between the doc and `src/` is the one thing guaranteed to send two
agents in different directions.

## Non-negotiables

These hold at **every commit**, not just at the end of a branch:

- `npm run lint`, `npm run typecheck` and `npm test` all pass.
- **No `any` types.** No `@ts-expect-error` or disabled lint rules without a
  comment on the same line explaining why.
- **Units are fixed:** distances in **meters**, gradients in **percent**,
  quietness and other scores **0–1**. Never store a mix; convert at the edges.
- **No network in tests.** External services (Overpass, Open-Meteo,
  Openrouteservice) are reached through injected functions so tests pass fakes.
  Fixtures live in `src/lib/engine/__fixtures__/`.
- Pure logic stays pure. Fetching, parsing and scoring are separate modules.

## Layering

```
src/lib/domain/   ← session model + compiler. Knows nothing about maps or OSM.
src/lib/engine/   ← OSM, graph, signals, elevation, segment finding.
src/app/          ← Next.js routes and UI.
```

- `engine` may import from `domain` **type-only and one-directional**:
  `import type { TerrainRequirements } from '@/lib/domain/types'`.
- `engine` must never import a domain *function*.
- `domain` must never import from `engine` at all.
- New quality inputs arrive as **signals** (decision 7) and must slot into the
  scorer without rewriting it. If a change forces a scorer rewrite, stop and
  raise it rather than reshaping the interface unilaterally.

## Tests

Every module under `src/lib/` has a colocated `*.test.ts`. New behaviour lands
with tests in the same commit — not a follow-up. Prefer tests that pin
behaviour described in `docs/domain.md` over tests that mirror the
implementation.

## Branches, commits and PRs

- **Never commit directly to `main`.** Branch, open a PR, let CI go green.
- Branch names: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- **Conventional commits**, imperative mood, lowercase subject.
- Every agent-assisted commit ends with a `Co-Authored-By:` trailer naming the
  model that did the work, e.g.:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

  Human authorship comes from the git author field; the trailer records which
  model assisted. (Plans written before this file hardcode `Claude Fable 5` —
  use your own model name, not that one.)
- Keep PRs to one plan slice. Small and reviewable beats complete.

## Knowing what the other person is working on

`docs/superpowers/plans/` holds the **plans of record**. Each has a status
header naming its owner and state. Before starting work:

1. Read the plan headers. If a plan is `in progress` and owned by someone else,
   pick a different one — do not work the same plan in parallel.
2. **Claim a plan by committing the header change** (`Status: in progress`,
   `Owner: …`) before writing code. That commit is the signal to the other
   contributor; `git log docs/` is the answer to "what's going on".
3. Split work by **plan**, not by file. The plans are sequential slices of one
   engine and share types — two people in different files of the same plan will
   still collide in `src/lib/engine/types.ts`.

Tick step checkboxes (`- [ ]` → `- [x]`) as you land each one, so a plan's
progress is legible without reading the diff.

Substantial new work gets a plan committed **before** implementation, following
the shape of the existing ones (Goal, Architecture, Global Constraints, then
tasks with checkboxes).

## Tooling

- The plans require the **superpowers** plugin
  (`superpowers:subagent-driven-development`, `superpowers:executing-plans`).
  Install it before executing a plan, or the instructions won't resolve.
- Shared agent config is committed in `.claude/settings.json`. Put personal
  overrides in `.claude/settings.local.json`, which is gitignored — do not edit
  the shared file for a preference only you want.

## Scope discipline

This is a planning tool, not a tracking app (decision 3). Map preview and GPX
export are in; in-run navigation is not. Street imagery is post-MVP and
Mapillary-only (decision 7). When a change would cross one of those lines, say
so and stop rather than quietly widening the product.

---

Map data in test fixtures © OpenStreetMap contributors, licensed under ODbL
(openstreetmap.org/copyright).
