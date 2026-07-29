# v1 to GitLab Pages: Client-Only Route Planner — Implementation Plan

**Status:** in progress · **Owner:** stuurps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`).

**Goal:** Ship the first user-facing product — a runner enters a session, gets a
quality route on a map, and downloads a GPX — and put it live on **GitLab Pages** as a
purely static, client-only site. This wires the already-built engine
(`src/lib/domain/` + `src/lib/engine/`) into a real UI for the first time.

**Product bar:** the USP is **ease** and **good-quality routes**. Match the guided,
minimal-input feel of training apps (Runna, Coopah): sensible defaults over knobs, a
clean confidence-inspiring results view. Session entry stays minimal and type-specific
(decision 2 — no pace input).

**Scope (decisions 3, 11):** session input → map preview of the session's **work
segment(s)** → single continuous GPX download. Account-less (decision 8 deferred).
**Out of v1:** door-to-door loop assembly + Openrouteservice connectors (decisions 5/6)
— a v1.1 follow-up, kept out so no API key ships in client JS. Also out: accounts
(Clerk/Neon), Mapillary imagery + feedback signals (decision 7), Garmin/Runna import
(decision 2).

**Architecture:** Everything runs in the browser. `next.config.ts` switches to
`output: 'export'`; `.gitlab-ci.yml` builds and publishes the export to Pages. A new
**composition layer** `src/lib/planner/` is the one place that imports *both* `domain`
(`compileSession`) and `engine` (`findWorkSegments`) — see the layering note below. A
new pure `src/lib/export/gpx.ts` turns segment geometry into a GPX track. The UI
(`src/app/`) hosts a `'use client'` session form + start-point capture, calls the
planner, and renders results on a Leaflet map with a GPX download. External calls
(Overpass, Open-Meteo, postcodes.io) go through **injected functions** so tests pass
fakes and no network is hit (`AGENTS.md`).

**Tech Stack:** TypeScript, Next.js 16 (App Router, static export), React 19, Tailwind
v4, Vitest. New runtime deps: a map library (**Leaflet + react-leaflet** recommended;
MapLibre GL the alternative) with keyless OSM raster tiles. No auth/db/routing SDKs.

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test` pass at **every commit**. No `any`;
  no unexplained `@ts-expect-error`/lint-disable.
- Units fixed: distances meters, gradients percent, quietness/scores 0–1. Convert at
  edges only.
- **No network in tests.** Overpass/Open-Meteo/geocoding reached via injected
  functions; fixtures in `src/lib/engine/__fixtures__/`. Pure logic (GPX writer,
  planner core) stays pure and colocated-tested.
- **Layering (resolved):** `src/lib/planner/` is a deliberate **composition layer**
  permitted to import both `domain` and `engine` (functions, not just types). It must
  remain the *only* such place — `domain` and `engine` stay as `AGENTS.md` mandates
  (`domain` imports nothing from `engine`; `engine` imports `domain` type-only). The
  Slice 4 PR that introduces `src/lib/planner/` also adds a one-line acknowledgement of
  this layer to `AGENTS.md`'s Layering section.
- **Static-export discipline:** no server actions, API routes, `cookies()`/`headers()`,
  middleware, or request-time fetching. Components that touch `window` (map) load via
  `next/dynamic` with `ssr: false`.
- One plan slice per PR, with the `.github/pull_request_template.md` scorecard filled
  in. Conventional commits ending with a `Co-Authored-By:` trailer naming the assisting
  model. Never commit to `main`.

## Slice 0 — Docs (this PR)

- [x] Amend `docs/domain.md` decision 8 (accounts deferred post-v1) and add decision 11
      (client-only static GitLab Pages v1; work-segments only; ORS/loop out of v1).
- [x] Add this plan of record and claim it (`Status: in progress`).

## Slice 1 — Static export + GitLab Pages pipeline

- [ ] `next.config.ts`: `output: 'export'`, `images: { unoptimized: true }`,
      `trailingSlash: true`, env-driven `basePath`/`assetPrefix` for the project
      sub-path. **Confirm the final Pages path** before hard-coding.
- [ ] Replace the create-next-app `src/app/page.tsx` with a minimal real shell; remove
      the `next/image` usage so export is clean.
- [ ] Add `.gitlab-ci.yml` (mirror `.github/workflows/ci.yml`: lint → typecheck → test
      → build) with a `pages` job publishing the export (`pages.publish: out` on GitLab
      ≥17, else `rm -rf public && mv out public` before `artifacts.paths: [public]`).

## Slice 2 — GPX writer (pure)

- [ ] `src/lib/export/gpx.ts` + test: pure `LatLon[] → GPX track string`, one
      continuous track (decision 4). Fixture-based test. Browser download helper lives
      in the UI layer, not here.

## Slice 3 — Session form + start point (client)

- [ ] `'use client'` form for all five `Session` types with type-specific fields
      (`src/lib/domain/types.ts`); friendly validation at the boundary (decision 10).
- [ ] Start point: browser Geolocation with UK-postcode fallback via postcodes.io
      (keyless, CORS) → `LatLon`, behind an injected/testable geocode function.

## Slice 4 — Orchestrator (`src/lib/planner/`)

- [ ] `planRoute` + test: `compileSession` → work-phase `TerrainRequirements` →
      `findWorkSegments` with **injected** `fetchWays` and `sampleElevations`
      (fixtures; no network). Returns ranked `WorkSegment[]` + session metadata.
- [ ] Add the one-line composition-layer note to `AGENTS.md` Layering (see Global
      Constraints).

## Slice 5 — Map preview + results (integration)

- [ ] Add the map library; render a Leaflet map with OSM raster tiles via
      `next/dynamic` (`ssr: false`), with OSM/ODbL attribution.
- [ ] Results view: ranked segments with stats (length, `minQuietness`,
      `avgAbsGradientPercent`); select one → draw its polyline → **Download GPX**.
- [ ] Wire form → `planRoute` → results end to end.
