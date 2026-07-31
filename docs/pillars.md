# The four pillars — where to change what

A map from the app's four pillars to the code that owns each, so a change to one
rarely means reading the other three. This is a **navigation aid**, not a source
of truth: the domain model and the numbered decisions live in
[`domain.md`](domain.md) (cited here by number), and the layering rules live in
[`AGENTS.md`](../AGENTS.md). Each pillar has one **public seam** — a barrel
`index.ts` (or named module) that is its supported entry point; import through
the seam, not at deep paths.

| Pillar | Home | Public seam | To change… |
|--------|------|-------------|-----------|
| **1 · User input** | `src/lib/session-input/` (logic) · `src/app/planner/session-form.tsx` + `start-point.tsx` (UI) | `@/lib/session-input` | what the app accepts / validates → `parse.ts`; the form UI → `session-form.tsx` |
| **2 · Routing algorithm** | `src/lib/planner/` (composition root) · `src/lib/engine/*` (OSM, graph, finder, elevation) | `@/lib/planner` | how a session becomes segments → `plan-route.ts`; graph/finder behaviour → `engine/*`; elevation providers → `default-elevation-sampler.ts` |
| **3 · Quality score** | `src/lib/engine/evaluate.ts` | `@/lib/engine/quality` | the 0–1 blend / weights, or a new signal → `evaluate.ts` (decisions 16, 7) |
| **4 · Visual output** | `src/lib/results/` + `src/lib/export/` (logic) · `src/app/planner/results.tsx` + `src/app/route-map.tsx` (UI) | `@/lib/results` | wording / formatting → `format.ts`; GPX contents → `gpx-download.ts` / `export/gpx.ts`; results/map UI → the `.tsx` |

## How the app layer is wired

`src/app/planner/` is a thin shell over the pillars — components render, logic
lives in tested `.ts` (the repo has no React test infra, so `*.test.ts` is where
behaviour is pinned):

- `index.tsx` — composition shell; owns the resolved start point, composes the pieces.
- `session-form.tsx` — pillar 1 UI; owns form values/errors, calls `parseSessionForm`.
- `start-point.tsx` — geolocate / postcode; reports the start up (decision 12).
- `results.tsx` — pillar 4 UI; the ranked list, map, and GPX button.
- `fields.tsx` — shared field/section presentation primitives.
- `run-state.ts` — pure route-search reducer (pillar 2 lifecycle); `use-route-search.ts` is the thin hook over it.

## Rules that still bind

- **Layering** (AGENTS.md): `domain` imports no `engine`; `engine` imports
  `domain` type-only; `planner` is the sole layer that composes *functions* from
  both. Barrels re-export only — they never add a cross-layer import.
- **Units** (AGENTS.md): meters, percent, seconds/km, 0–1 scores; convert at the edges.
- **Pace is metadata** (decisions 13, 17): it rides on the `Session`, shows in
  results and the GPX, and is **never** an engine input — pillar 3 and the finder
  never see it.
