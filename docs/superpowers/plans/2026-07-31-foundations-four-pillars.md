# Foundations — Four Pillars & UI Componentisation — Implementation Plan

**Status:** in progress · **Owner:** stuurps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`).

**Goal:** Pause feature work and make the four pillars of the app —
**user input**, the **routing algorithm**, the **quality score**, and the
**visual output** — each independently editable, with one obvious home to
change. No behaviour changes; this is a structural pass so future improvements
to any single pillar don't require reading the other three.

**Why this exists:** The `src/lib/` layers are already cleanly separated along
the four pillars (input → `session-input/`, routing → `engine/` + `planner/`,
quality → `engine/evaluate.ts`, output → `results/` + `export/`). The one thing
welding them together is **`src/app/planner.tsx` — a ~610-line component** that
is at once the form, the network orchestrator, the elevation-provider config,
the results screen, and the GPX downloader. It's why you can't touch one pillar
without reading all four. The repo's test setup makes the fix pointed: vitest
includes only `src/**/*.test.ts` and there's no React Testing Library, so the
norm is **logic lives in tested `.ts` modules; `.tsx` stays thin and untested**.
`planner.tsx` violates that by holding untested orchestration. This plan
extracts the presentational pieces into components and pushes the testable
logic down into `.ts` lib modules, then names a public seam per pillar so the
"where do I change X?" question has a one-line answer.

**Architecture:** No new product behaviour, no new dependencies, no engine or
domain logic rewrites. Three moves:

1. **Componentise the app layer.** `src/app/planner.tsx` becomes a thin
   `src/app/planner/` folder — a composition shell plus one presentational
   component per pillar. Components own layout and local field state only; they
   receive data and callbacks as props.

   ```
   src/app/planner/
     index.tsx            ← shell: composition + layout, owns nothing else
     use-route-search.ts  ← thin React hook: wires the run-state reducer to planRoute
     session-form.tsx     ← pillar 1 UI (type buttons + per-type fields + pace)
     start-point.tsx      ← start selection (geolocate / postcode)
     results.tsx          ← pillar 4 UI (segment list, quality, caveats, GPX button)
     fields.tsx           ← Field / SectionHead / PaceField / SearchProgress primitives
   ```

2. **Push testable logic out of the component into `.ts` lib modules** so it's
   covered by vitest:
   - **Run-state reducer** → `src/app/planner/run-state.ts` (pure
     `idle|loading|error|done` transitions) with `run-state.test.ts`. The hook
     just dispatches into it.
   - **Default elevation-provider chain** (currently the inline `sampleElevations`
     terrarium→open-elevation→open-meteo failover) → `src/lib/planner/`
     (the composition root — the one layer allowed to import engine *functions*,
     so this is its correct home per AGENTS.md Layering). Colocated test asserts
     the provider order via injected fakes, no network.
   - **GPX download trigger / filename / description assembly** → a pure builder
     in `src/lib/results/` returning `{ fileName, mime, contents }`; the
     component only creates the Blob and clicks the anchor.

3. **Name a public seam per pillar** — a barrel `index.ts` that is the pillar's
   supported entry point, plus **`docs/pillars.md`**: a one-screen map of
   pillar → files → entry point → "to change X, edit Y". Barrels must respect
   AGENTS.md Layering (engine imports domain type-only; domain never imports
   engine; planner is the only functions-both composer) — a barrel re-exports,
   it never introduces a new cross-layer import.

   | Pillar | Home | Public seam |
   |--------|------|-------------|
   | 1 User input | `src/lib/session-input/` + `src/app/planner/session-form.tsx` | `session-input/index.ts` (`parseSessionForm`, types) |
   | 2 Routing algorithm | `src/lib/planner/` + `src/lib/engine/` | `planner/index.ts` (`planRoute`, default deps) |
   | 3 Quality score | `src/lib/engine/evaluate.ts` | `engine/quality.ts` barrel (`segmentQuality`, tunable weights) |
   | 4 Visual output | `src/lib/results/` + `src/lib/export/` + `src/app/planner/results.tsx` + `route-map.tsx` | `results/index.ts` (formatters + gpx-download builder) |

**Tech Stack:** TypeScript, React 19 / Next.js (this repo's fork — read
`node_modules/next/dist/docs/` before touching app files), Vitest. No new
dependencies. No network in tests.

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test` green at **every commit**.
- No `any`; no disabled lint rules without a same-line reason.
- **No behaviour change.** The rendered form, results, map and GPX output are
  byte-for-byte equivalent before and after each slice. This is a refactor.
- Units unchanged (decisions unaffected). **No decision-of-record changes** —
  if any restructure seems to need one, stop and raise it.
- Layering (AGENTS.md) holds: `domain` imports no `engine`; `engine` imports
  `domain` type-only; `planner` is the sole functions-both composer. Barrels
  re-export only — they never add a cross-layer import.
- Keep each PR to one slice below; small and reviewable over complete.

## Tasks

### Slice 1 — Componentise the app layer (PR)
- [x] Create `src/app/planner/index.tsx` shell; move `Planner` there.
      `src/app/page.tsx` import unchanged (`./planner` now resolves to the folder).
- [x] Extract `fields.tsx` (`Field`, `SectionHead`, `kickerClass`/`inputClass`,
      `PaceField`, `SearchProgress`) — presentational, no logic.
- [x] Extract `session-form.tsx` (type buttons + per-type field blocks); it
      owns `SessionFormValues` state and calls `parseSessionForm` on submit,
      raising the parsed `Session` (or field errors) to the shell. Renders the
      start section via a `startSlot` prop so a single `<form>` and the DOM are
      preserved.
- [x] Extract `start-point.tsx` (geolocate + postcode lookup); raises the
      resolved `LatLon` (or `null` on failure) via `onStartChange`.
- [x] Extract `results.tsx` (segment list, quality/caveat display, map, GPX
      button); run/selected props in, `onSelect`/`onWiden` callbacks out.
- [x] Verified: DOM-preserving extraction (single `<form>`, byte-for-byte JSX),
      `npm run lint`/`typecheck`/`test` (226) green + `next build` prerenders.
      No manual dev eyeball — repo has no UI test infra, so behaviour parity
      rests on the mechanical extraction + build.

### Slice 2 — Push logic into tested `.ts` modules (PR)
- [x] `src/app/planner/run-state.ts`: pure run-state type + reducer; added
      `run-state.test.ts` covering each transition. Hook `use-route-search.ts`
      dispatches into it and calls `planRoute` behind injected deps.
- [x] `src/lib/planner/default-elevation-sampler.ts`: builds the
      terrarium→open-elevation→open-meteo failover sampler here (moved out of
      the component); colocated test asserts the order with injected fakes, no
      network.
- [x] `src/lib/results/gpx-download.ts`: pure `buildGpxDownload(session, points)`
      → `{ fileName, mimeType, contents }`; colocated test. Component only does
      Blob + anchor. `sessionTargetPace` also moved into `results/format.ts`
      (tested) as the shared pace selector.
- [x] `planner/index.tsx` shrinks to composition (~70 lines); lint/typecheck
      /test (244) green + `next build` prerenders.

### Slice 3 — Pillar seams + architecture note (PR)
- [ ] Add pillar barrels: `session-input/index.ts`, `planner/index.ts`,
      `engine/quality.ts`, `results/index.ts` (re-export only; no new
      cross-layer imports). Point app imports at the barrels.
- [ ] Write `docs/pillars.md`: the pillar→home→seam→"to change X, edit Y" map
      (mirror the table above, kept current). Cross-link from `AGENTS.md`.
- [ ] Tick this plan complete; lint/typecheck/test green.
