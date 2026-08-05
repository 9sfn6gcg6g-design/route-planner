# v1: Door-to-Door Loops — Implementation Plan

**Status:** in progress · **Owner:** stuurps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`). **Depends on** the flow/ground plan (`…-routing-flow-and-ground-refinements.md`) — it defines and weights the **non-repetition** dimension this plan feeds — and on the v1 app stack landing on `main`.

**Progress (2026-07-31):** the headline is delivered — the app now assembles and
shows a **keyless door-to-door loop** per stretch (Slice A `route.ts` reused from
PR #21; Slice B `planner/assemble-loop.ts`; hill recovery is the descent pass;
loop drawn + exported + wording updated). **Deferred to follow-ups:** retiring the
dead ORS code (`engine/plan.ts`, `connectors.ts`) — the live app path is already
keyless (Slice A, 2nd bullet); the distance-correct **quiet-loop search** and the
`minUninterruptedMeters: null` revisit for easy/long (Slice C — interim uses
out-and-back passes on the best quiet stretch); the **tempo-shape** decision
(Slice C); and **non-repetition input** + loop compactness (Slice D — the
dimension is weighted but still reads 1).

**Why this exists (end-user review of v1):** the engine and the flow ship, but the
output is a **work stretch, not a runnable route**. Two gaps miss the founding
promise — "the session drives the route; you get a loop from your door"
(decisions 1, 3, 5):

1. **Fragments, not loops.** A single stretch may start ~2 km from the door with no
   way there and back. A runner can't run a lone line.
2. **Continuous sessions ignore distance.** For easy/long, `terrainRequirementsFor`
   sets `minUninterruptedMeters: null`, so the finder returns *any* quiet stretch of
   *any* length — an 8 km easy ask can yield a 400 m stretch. Loop assembly is what
   makes any session hit the requested distance.

**Goal:** Make every result a **door-to-door loop matching the session** —
assembled and exported as one continuous GPX (decision 4) — so the output is
something a runner can actually run. Stay client-only and **keyless** (GitHub
Pages, decision 12).

**Architecture (the key idea, now a decision):** we already fetch and build a
scored `RunGraph` around the start (`engine/graph.ts`). Connectors and loops are
**routing on that graph** — shortest/quiet paths between nodes — done
**client-side with no API key**, not via Openrouteservice. **Decision 21 records
this** (superseding decision 6's ORS connectors and amending decision 12 to bring
door-to-door into v1); the doc change has landed, so no doc slice remains here.

**This is a rework, not a green field.** Route assembly already exists in the
engine but is **ORS-coupled**: `engine/plan.ts` (`generateRoute`) is the front
door — easy/long call `fetchRoundTrip` (ORS), tempo/intervals/hills lap a work
segment and connect it with `fetchFootRoute` (ORS) — over the pure helpers in
`engine/assemble.ts` (`buildWorkGeometry`, `assembleRoute`, `assembleLoopRoute`,
`rotateRingToNearest`). The pure helpers **stay**; the ORS **source** is swapped
for graph routing, and `connectors.ts` (the ORS client) is **retired**. Connectors
carry `requirements: null` (any runnable terrain — the `Phase` model), so the graph
is the right substrate.

**Tech Stack:** TypeScript, Next.js 16 static export, Vitest. New engine routing
code; **no new runtime services, no API keys**. Reuse `geo.ts`, `chains.ts`,
`finder.ts`, `evaluate.ts`, `compiler.ts`, `planner/`, `export/gpx.ts`.

## Global Constraints

- Same non-negotiables: `lint`/`typecheck`/`test` green every commit; no `any`;
  units meters/percent/0–1; **no network in tests** (inject + fixtures); pure
  routing logic stays pure and colocated-tested.
- **Keyless only** while the host is GitHub Pages — no secret ever ships in client JS.
- Loop assembly composes `domain` + `engine` through the existing `planner/`
  layer; don't reach across `domain`/`engine` elsewhere.
- New quality inputs stay **signals** — do not rewrite the scorer.
- One slice per PR with the scorecard; conventional commits + model trailer.

## Slice A — Keyless connector routing on the graph

- [x] `engine/route.ts` (+ tests): shortest/quiet path between two graph nodes
      (Dijkstra/A* over `RunEdge` weights, favouring quietness). Pure; fixtures, no
      network. Snap an arbitrary `LatLon` (the door, a stretch end) to the nearest
      graph node.
- [ ] Rewire `engine/plan.ts` `generateRoute`: replace the `fetchFootRoute`
      (warmup/cooldown) connector calls with `route.ts` over the graph it already
      builds; keep the `assemble.ts` helpers. Retire `engine/connectors.ts` (ORS)
      and the `RoutePlanDeps` fields that inject it — nothing keyed remains. The
      conformance plan's keyless guard flips to a hard assertion in this PR.

## Slice B — Lap-session loops (intervals / hills)

- [x] In `planner/`, assemble a continuous loop: door → connector → work stretch →
      (laps) → connector → door, as one ordered `LatLon[]`. Honour the compiled
      phases and `connectorMeters`. Return it alongside the ranked stretches.
- [x] **Hill-rep structure (decision 21):** a hill lap is a sustained climb whose
      recovery is the **descent of the same climb** — assemble it as an intended
      out-and-back on the hill; **suspend non-repetition and the `back`-U-turn
      avoidance for the hill lap** (they apply to the surrounding loop, not the rep).
- [x] Export the assembled loop as one continuous GPX (decision 4); update the UI to
      draw and download the **loop**, not just the stretch.

## Slice C — Distance-correct continuous loops (easy / long / tempo)

- [ ] Replace the ORS `fetchRoundTrip` easy/long branch in `generateRoute` with a
      **quiet-loop search on the graph** — a loop of ~target distance (± tolerance)
      from quiet ground, so an 8 km ask yields an ~8 km signal-shaped loop (closes
      the decision-1 violation the round trip left open). Likely a new finder mode
      rather than the single-stretch finder. If it forces a scorer/interface change,
      **stop and raise it** (AGENTS.md).
- [ ] Revisit `terrainRequirementsFor` for continuous types now distance is honoured
      by assembly (the `minUninterruptedMeters: null` gap).
- [ ] **Resolve the tempo shape (decision 11 vs 21, deferred to this plan):** does
      tempo stay an out-and-back on one continuous stretch, or become a door loop
      like easy/long with non-repetition applied? Decide, record the choice in the
      plan header note, and amend decision 11 in `docs/domain.md` (own commit) if it
      changes.

## Slice D — Feed non-repetition; loop compactness

- [ ] Compute `repeatedDistance / totalDistance` over each assembled loop and pass
      `nonRepetition = 1 − that` into `segmentQuality` (the flow plan defined and
      weighted the dimension; this supplies its real input). Penalise pokey
      out-and-backs and self-overlap so easy/long loops vary the ground.
- [ ] Keep loops **compact** — an envelope around the door (analogous to the
      finder's `maxDistanceFromStartMeters`) so a loop doesn't excurse far then crawl
      back.

## Slice E — Polish

- [x] Once results are real loops, revert v1 wording from "stretch" back to "route";
      show total loop distance vs target.
- [ ] Optional: enrich the GPX with elevation (one sampler call for the final loop).

## Out of scope (still)

Accounts (Clerk/Neon, decision 8), Mapillary imagery + feedback signals
(decision 7), Garmin/Runna import (decision 2), in-run navigation (decision 3).
