# Algorithm–Principle Conformance — Plan

**Status:** proposed · **Owner:** unassigned

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`).

**Goal:** A **principle-first, behaviour-pinning** conformance layer that fails
whenever the routing algorithm drifts from its decisions of record (1, 11, 15, 16,
18–21). Each test **names its decision**, so `npm test` doubles as a live
alignment report. This layer (a) **audits** where the code stands today, (b)
**guards** the behaviour that is already correct against the coming refactors, and
(c) **pins the cross-cutting invariants no single feature slice owns** — keyless,
engine-never-sees-pace, session-shaped output, determinism, 0–1 bounds.

**Why this exists:** AGENTS.md prefers tests that "pin behaviour described in
`docs/domain.md` over tests that mirror the implementation." The per-slice tests in
the flow and loops plans prove each *feature* works, but nothing guarantees every
*principle* has an owning guard — and today the engine **actively violates two
decisions** (see audit). Without this layer, a green build can still contradict the
domain model, which AGENTS.md calls "the one thing guaranteed to send two agents in
different directions."

## Current-alignment audit (2026-07-31)

| Decision | Invariant | Status | Where |
|---|---|---|---|
| **1** session drives route | the route is shaped by the session's own signals | ⚠️ **violated for easy/long** — the ORS round-trip ignores quietness/surface (own code comment admits it) | `plan.ts:64,81`, `assemble.ts:92` |
| **11** minor-join tolerance | a major crossing cuts a stretch; minor joins tolerated to `maxJunctionsPerKm` | ✅ held | `chains.ts`, `evaluate.ts` |
| **15** turn over crossing; degrade | assembly extends by turning; crossings tallied; finder returns caveated best, never nothing | ✅ held (in its *pre-18* form) | `stretches.ts`, `finder.ts` |
| **16** single 0–1 quality | one calibrated score in [0,1]; crossings weighted in | ✅ held (global weights) | `evaluate.ts` |
| **18** flow is session-weighted | per-session weight profile; turn-smoothness/density; gentlest-non-crossing assembly | ❌ not implemented (weights global; assembly is class-rank) | flow plan A/B/C |
| **19** gradient shape-aware | sustained (hills) / low-variance (tempo), not just average | ❌ average only | flow plan D |
| **20** obstacle gate | node barriers excluded from the graph | ❌ not fetched (`steps` already excluded ✅) | `overpass.ts`, `graph.ts` → flow plan E |
| **21** keyless own-graph loops | connectors/loops route on our `RunGraph`; **no API key** | ❌ **violated** — assembly is ORS-keyed | `connectors.ts`, `plan.ts:15,81,118`, `assemble.ts:2` → loops plan |

Two of these (**1**, **21**) are live violations, not just gaps: `generateRoute`
builds routes through a keyed service, and the easy/long loop is ORS-shaped rather
than signal-shaped. The loops plan retires that code; **this plan makes the
violation fail a test until it does.**

## Architecture

A new `src/lib/engine/conformance.test.ts` (cross-layer invariants may live in
`src/lib/planner/conformance.test.ts`) holds the **cross-cutting** guards and the
**regression** guards. Dimension-specific pins (turn-smoothness ordering, gradient
shape, barrier exclusion, non-repetition) are authored **in their implementing
slice** (flow/loops plans) — this plan **indexes** them, it does not duplicate
them. Convention: every behaviour-pinning test is `describe('decision NN: …')` so
`grep "decision "` over `*.test.ts` is the coverage report.

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test` green at **every** commit.
- No `any`; no network (invisible fixtures only). Tests pin **domain behaviour**,
  not implementation shape — a test that would pass a wrong-but-plausible
  implementation is not a conformance test.
- This plan adds **tests and one meta-guard only**; it never changes algorithm
  behaviour. Behaviour changes belong to the flow/loops plans.
- One slice per PR with the scorecard; conventional commits + model trailer.

## Slice 0 — Baseline: audit + guards for what already holds

- [ ] Add `conformance.test.ts` with **regression guards** that pass today, each
      named by decision: **11** (a major crossing terminates a stretch; minor joins
      counted, not cut), **15** (finder returns the caveated best stretch, never
      empty, when no crossing-free one fits), **16** (`segmentQuality` ∈ [0,1] for
      random valid inputs).
- [ ] Add **cross-cutting guards** that pass today: **engine-never-sees-pace**
      (`TerrainRequirements` and the `finder`/`evaluate` signatures expose no pace
      field; the flow weight profile is terrain metadata — decisions 13/17/18);
      **determinism** (same graph+start ⇒ byte-identical route order);
      **units/bounds** (every quality & flow sub-score in [0,1]).
- [ ] Mark the two live violations as failing-but-tracked: `it.todo('decision 1:
      easy/long loop is signal-shaped, not ORS-shaped')` and `it.todo('decision 21:
      no engine/planner module references an API key or ORS')`, so the gaps are
      visible in the test run without breaking the build.

## Slice 1 — Keyless guard (coordinate with the loops plan)

- [ ] Turn the decision-21 todo into a **hard assertion**: no file under
      `src/lib/engine` or `src/lib/planner` references an `Authorization` header, an
      API key, or an Openrouteservice URL. It fails until the loops plan retires
      `connectors.ts` and moves assembly onto `route.ts` — that is the point. Land
      the assertion in the **same PR** that retires ORS, or as an allowlist that
      shrinks to empty.

## Slice 2 — Flip todos to pins as feature slices land

- [ ] As each flow/loops slice lands its named pin, tick the matching row here and
      remove the corresponding todo. Rows to close: **18** (session-weighted
      ordering; gentlest-non-crossing assembly; turn-smoothness/density), **19**
      (gradient shape), **20** (barrier exclusion), **21** (keyless + hill-rep
      retrace + every result is a closed loop from the door), **1** (easy/long loop
      shaped by our signals).

## Slice 3 — Meta-guard: no principle goes unpinned

- [ ] A test asserting each **algorithm** decision (`1, 11, 15, 16, 18, 19, 20,
      21`) appears in at least one `describe('decision NN: …')` across `src/lib`.
      Fails if a new decision lands with no conformance test — the self-maintaining
      part of "ensure the algorithm aligns."

## Out of scope

The **behaviour changes** that close the violations (retiring ORS, session-shaped
loops, flow/gradient/barrier work) belong to the flow and loops plans. This plan
only detects, guards, and tracks. Accounts (8), Mapillary/feedback (7), import (2),
in-run navigation (3).
