# v1.1: Door-to-Door Loops — Implementation Plan

**Status:** proposed · **Owner:** unassigned

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`). **Do not start until the v1 stack (`docs/…-v1-github-pages-client-app.md`) has landed on `main`.**

**Why this exists (end-user review of v1):** v1 ships the engine and the flow, but its
output is a **work stretch, not a runnable route**. Two gaps make it fall short of the
founding promise — "the session drives the route; you get a loop from your door"
(decisions 1, 3, 5):

1. **Fragments, not loops.** v1 hands back a single stretch that may start up to ~2 km
   from the door, with no way to get to it and back. A runner can't run a lone line.
2. **Continuous sessions ignore the distance.** For easy and long,
   `terrainRequirementsFor` sets `minUninterruptedMeters: null`, so the finder returns
   *any* quiet stretch of *any* length near the start — an 8 km easy request can yield a
   400 m stretch. The distance input barely touches the output. (Intervals/hills fare
   better: `minUninterruptedMeters = rep/hill length`. Tempo got a floor on `main`
   —`min(tempoMeters, 1500)`, decision 11 — but still isn't a full distance-matched
   loop.) Loop assembly is what makes any of these hit the requested distance.

**Goal:** Make every result a **door-to-door loop matching the session** — assembled and
exported as one continuous GPX (decision 4) — so the output is something a runner can
actually run. Stay client-only and **keyless** (v1 host is GitHub Pages, decision 12).

**Architecture (the key idea):** we already fetch and build a scored `RunGraph` around
the start (`src/lib/engine/graph.ts`). Connectors and loops are **routing on that graph**
— shortest/quiet paths between nodes — which we can do **client-side with no API key**,
rather than calling Openrouteservice. This deviates from decision 6 ("hosted A→B routing
for connectors, Openrouteservice"), so **amend decision 6 first** (its own commit) to
allow keyless, graph-based connectors for the static v1.x, keeping ORS as a post-static
option. Connectors carry `requirements: null` already (any runnable terrain — see the
`Phase` model), so the graph is the right substrate.

**Tech Stack:** TypeScript, Next.js 16 static export, Vitest. New engine routing code;
no new runtime services, **no API keys**. Reuse `geo.ts`, `chains.ts`, `finder.ts`,
`compiler.ts`, `planner/`, `export/gpx.ts`.

## Global Constraints

- Same non-negotiables as v1: `lint`/`typecheck`/`test` green every commit; no `any`;
  units meters/percent/0–1; **no network in tests** (inject + fixtures); pure routing
  logic stays pure and colocated-tested.
- **Keyless only** while the host is GitHub Pages — no secret ever ships in client JS.
- Loop assembly composes `domain` + `engine` through the existing `planner/`
  composition layer; don't reach across `domain`/`engine` elsewhere.
- New quality inputs stay **signals** — do not rewrite the scorer.
- One slice per PR with the scorecard; conventional commits + model trailer.

## Slice A — Amend decision 6 (docs, own commit)

- [ ] Amend `docs/domain.md` decision 6: connectors and loop assembly for the static
      v1.x run on our **own `RunGraph` (keyless)**; Openrouteservice returns as an option
      only if/when a backend host exists. Land as its own commit.

## Slice B — Keyless connector routing on the graph

- [ ] `src/lib/engine/route.ts` (+ tests): shortest/quiet path between two graph nodes
      (Dijkstra/A* over `RunEdge` weights, favouring quietness). Pure; fixtures, no
      network. Snap an arbitrary `LatLon` (the door, a stretch end) to the nearest graph
      node.

## Slice C — Lap-session loops (intervals / hills)

- [ ] In `planner/`, assemble a continuous loop: door → connector → work stretch →
      (laps) → connector → door, as one ordered `LatLon[]`. Honour the compiled phases
      and `connectorMeters`. Return it alongside the ranked stretches.
- [ ] Export the assembled loop as one continuous GPX (decision 4); update the UI to
      draw and download the **loop**, not just the stretch.

## Slice D — Distance-correct continuous loops (easy / long / tempo)

- [ ] Generate a loop of ~target distance (± tolerance) from quiet ground for
      easy/long/tempo, so an 8 km ask yields an ~8 km loop. Likely a new finder mode
      (quiet-loop search on the graph) rather than the single-stretch finder. Decide the
      approach and, if it forces a scorer/interface change, **stop and raise it** per
      `AGENTS.md` rather than reshaping unilaterally.
- [ ] Revisit `terrainRequirementsFor` for continuous types now that distance is
      honoured by assembly (the `minUninterruptedMeters: null` gap).

## Slice E — Polish

- [ ] Once results are real loops, revert the v1 wording from "stretch" back to "route"
      and show total loop distance vs target.
- [ ] Optional: enrich the GPX with elevation (one Open-Meteo call for the final loop).

## Out of scope (still)

Accounts (Clerk/Neon, decision 8), Mapillary imagery + feedback signals (decision 7),
Garmin/Runna import (decision 2), in-run navigation (decision 3).
