# Routing: Flow Family & Ground Refinements — Implementation Plan

**Status:** in progress · **Owner:** stuurps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`).

**Goal:** Teach the finder to judge a route by two families, not one — the
**ground** it covers (quietness, gradient) and the **flow** of running it
(crossing-freeness, turn-smoothness, turn-density, non-repetition) — with the
blend **weighted per session type** (decision 18). Plus two ground refinements:
gradient becomes **shape-aware** (decision 19) and the graph **excludes hard
obstacles** (decision 20). This lands **before** loop assembly
(`…door-to-door-loops.md`); it improves the current single-stretch finder on its
own, and puts the weight profile + non-repetition dimension in place for loops to
fill in.

**Why this exists:** Today `segmentQuality` (decision 16) blends quietness 0.45 /
gradient 0.25 / crossing-free 0.30 with **one global constant set** — an easy run
and a rep session pay the same crossing cost, which is wrong. Nothing penalises a
pace-killing **hairpin** (assembly treats every turn as free, decision 15) or a
route that makes **thirty gentle turns** through an estate. Gradient is a single
**average**, blind to whether a "hill" is one sustained climb or rolling ground
that averages to target. And the Overpass query fetches no **node barriers**, so a
stretch can be routed straight through a kissing gate.

**Architecture:** The weight vector moves from a module constant in
`engine/evaluate.ts` to a **profile on `TerrainRequirements`**, set per session in
`domain/profiles.ts` (`terrainRequirementsFor`). The `domain` compiler already
chooses these requirements per session, so it picks the flow profile too — the
`engine` reads it type-only and **still never sees pace** (decisions 13, 17).
`segmentQuality` takes the profile + the new sub-score inputs;
`assembleStretches` carries the turns it took so the finder can score
smoothness/density; `elevation.ts` gains shape measures; `overpass.ts` +
`graph.ts` gain barrier awareness. No scorer rewrite — new dimensions slot in as
weighted terms (decision 7).

**Tech Stack:** TypeScript, Vitest. No new dependencies. No network in tests
(inject + `__fixtures__`).

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test` green at **every** commit.
- No `any`; units unchanged (quietness/quality/flow sub-scores 0–1, gradient %,
  distance m). Weight profiles **sum to 1** so quality stays in [0, 1].
- Layering: weights are chosen in `domain`, consumed in `engine` type-only; the
  engine never learns session type or pace, only the profile.
- Decisions 18/19/20 already landed (own commit). Each slice below is one PR with
  the scorecard; conventional commits + model trailer.
- Pure logic stays pure and colocated-tested.

## Slice A — Session-weighted quality profile

- [x] `domain/types.ts`: add `qualityWeights` to `TerrainRequirements` — a profile
      `{ quietness, gradient, crossingFree, turnSmoothness, turnDensity,
      nonRepetition }`, all ≥ 0, summing to 1.
- [x] `domain/profiles.ts`: set `qualityWeights` per session in
      `terrainRequirementsFor` — structured (tempo/intervals/hills) weight
      crossingFree + turnSmoothness/density high and nonRepetition ~0 (laps repeat
      by design, decision 21); easy/long weight those low and nonRepetition high.
      Constants, tunable.
- [x] `engine/evaluate.ts`: `segmentQuality` takes the `qualityWeights` profile and
      the new inputs (`turnSmoothness`, `turnDensity`, `nonRepetition`); drop the
      module-const `QUALITY_WEIGHTS`. Until later slices/loops feed real values,
      pass `turnSmoothness = 1`, `turnDensity = 1`, `nonRepetition = 1` (a single
      stretch repeats nothing) so behaviour is unchanged.
- [x] `engine/finder.ts`: read `requirements.qualityWeights`; thread it + the new
      inputs into `segmentQuality`.
- [x] Tests: profile ordering (a crossing costs a rep session more than an easy
      run); weights sum to 1 for every session; quality stays in [0, 1].

## Slice B — Turn-smoothness (assembly + score)

- [x] `engine/geo.ts`: `turnSmoothness(signedTurnDegrees)` → 0–1 (1 up to a gentle
      threshold, decaying to 0 by the hairpin bound). Thresholds are tunable
      constants.
- [x] `engine/stretches.ts`: replace `CLASS_RANK` (left→right→straight) with
      **gentlest non-crossing continuation first** (decision 18): non-crossing
      turns before a straight-across crossing; among turns, gentler wins;
      left-before-right only as a tiebreak at comparable sharpness; then quietness;
      then `corridorKey`. Carry the turns taken on `Stretch` (angles or per-hop
      classes) so the finder can score them.
- [x] `engine/finder.ts` / `evaluate.ts`: derive the stretch's `turnSmoothness`
      sub-score from its turns; feed `segmentQuality`.
- [x] Tests: gentle-turn stretch outranks an equal one with a hairpin; assembly
      still prefers a turn over a crossing; left-before-right tiebreak holds.

## Slice C — Turn-density

- [x] Compute **turns per km taken** (real direction changes from Slice B's turn
      data, not `maxJunctionsPerKm`'s minor joins) → 0–1 `turnDensity` sub-score
      (fewer turns = higher). Feed `segmentQuality`.
- [x] Tests: a straight stretch beats a zig-zag of equal length/quietness for
      structured profiles; easy/long barely care.

## Slice D — Gradient shape (decision 19)

- [x] `engine/elevation.ts`: add shape measures alongside `avgAbsGradientPercent` —
      a **sustained-climb** measure (longest continuous rise vs rep length, for
      hills) and a **gradient-variance** measure (for tempo). Pure; fixtures.
- [x] Signal which mode a session wants without leaking pace: extend the gradient
      side of `TerrainRequirements` (e.g. a `gradientShape: 'sustained' |
      'even' | 'any'`) set in `profiles.ts` — hills `sustained`, tempo `even`,
      easy/long `any`.
- [x] `engine/evaluate.ts`: `gradientFit` reads the shape mode so a rolling stretch
      that averages to target scores worse for hills/tempo. Keep easy/long on the
      average.
- [x] Tests: rolling-but-on-average stretch loses to a steady one for hills and
      tempo; unchanged for easy/long.

## Slice E — Obstacle gate: node barriers (decision 20)

- [x] `engine/overpass.ts`: additionally fetch `node["barrier"]` within the radius
      (`gate`, `stile`, `kissing_gate`, `turnstile`, …). Keep `steps` excluded
      (already not a runnable highway).
- [x] `engine/types.ts` / `graph.ts`: record barrier nodes; an edge passing through
      a **blocking** barrier node is not runnable (respect obvious access-tag
      exceptions, e.g. `foot=yes` / `access=yes`). Barrier list + exceptions are
      constants.
- [x] Tests: a way threaded through a gate node is not traversable; a barrier with
      `foot=yes` still is; non-barrier graphs are unchanged.

## Open questions / hand-offs

- **Non-repetition** is *defined and weighted* here but only computes a non-trivial
  value once routes retrace — that input is wired by the loops plan
  (`…door-to-door-loops.md`), which passes real `repeatedDistance/totalDistance`.
- If any slice would force a **scorer/interface rewrite** rather than a new
  weighted term, **stop and raise it** (AGENTS.md) rather than reshaping
  unilaterally.

## Out of scope

Loop/connector assembly (its own plan), accounts (decision 8), Mapillary/feedback
signals (decision 7), Garmin/Runna import (decision 2), in-run navigation
(decision 3).
