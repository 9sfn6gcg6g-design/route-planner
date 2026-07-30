# Conversational Session Ranking — Implementation Plan

**Status:** in progress · **Owner:** liam

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax — tick as you land each one and update this header when you claim or finish the plan (see `AGENTS.md`).

**Goal:** Implement decision 17: easy/long ("conversational") sessions rank
work segments by quietness + gradient + **length-fit** with **no crossing
penalty**, and stretch assembly extends toward the session's distance instead
of not extending at all — so a 10 km easy ask stops returning five "0.0 km"
courtyard loops.

**Why this exists (end-user report, BS1 5AU):** a 10 km easy session returned
five tiny crossing-free loops scoring ~100%. Three compounding causes, all
downstream of work-stretch rules leaking onto conversational sessions:
`assembleStretches` got `targetMeters: minUninterruptedMeters ?? 0` — zero for
easy/long, so no extension ever ran; the decision-16 quality blend weighted
crossing-freeness 0.30 for every session type, so tiny quiet loops scored
perfectly; and nothing filtered degenerate fragments, which `formatDistance`
renders as "0.0 km".

**Architecture:** Detect conversational sessions in the engine by the existing
marker `requirements.minUninterruptedMeters === null` (decision 17 makes this
semantic, not incidental). Thread the compiled work phase's `targetMeters`
from `planner/plan-route.ts` into the finder; the finder caps it for realistic
search reach, drives stretch assembly with it, filters sub-floor fragments,
and asks `segmentQuality` for the conversational blend. No `domain/` changes;
`engine` keeps importing domain **types only**.

**Tech Stack:** TypeScript, Vitest, existing engine fixtures (no network in
tests).

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test` green at **every commit**.
- No `any`; no new lint suppressions.
- Units: meters, percent, scores 0–1 (AGENTS.md).
- No network in tests — samplers/fetchers injected, fixture graphs built
  from `OsmWay` literals as in existing tests.
- `engine` imports from `domain` type-only; composition stays in `planner/`.
- Decision 15's caveat annotation ("crosses N roads") is unchanged — crossings
  are still *reported* for conversational sessions, they just cost nothing.
- Constants live beside the existing decision-16 weights and are tunable:
  conversational blend `{ quietness: 0.45, gradient: 0.2, lengthFit: 0.35 }`,
  `CONVERSATIONAL_STRETCH_CAP_METERS = 3000`,
  `MIN_CONVERSATIONAL_STRETCH_METERS = 400`,
  `CONVERSATIONAL_MAX_HOPS = 30`.

---

### Task 1: Conversational quality blend in `segmentQuality`

**Files:**
- Modify: `src/lib/engine/evaluate.ts`
- Test: `src/lib/engine/evaluate.test.ts`

**Interfaces:**
- Produces: `segmentQuality(params: { minQuietness: number; gradientPercent:
  number; wantsClimb: boolean; crossings: number; lengthMeters: number;
  conversationalTargetMeters: number | null }): number`. `null` target =
  work-stretch blend (unchanged behaviour); non-null = conversational blend.
  Task 2's finder calls exactly this signature.

- [x] **Step 1: Write the failing tests** — in `evaluate.test.ts`, extend the
  existing `base` fixture with the two new params and add a decision-17 block:

```ts
// existing base becomes:
const base = {
  minQuietness: 0.9,
  gradientPercent: 0.3,
  wantsClimb: false,
  crossings: 0,
  lengthMeters: 1000,
  conversationalTargetMeters: null,
}

describe('segmentQuality — conversational sessions (decision 17)', () => {
  const conv = {
    minQuietness: 0.9,
    gradientPercent: 0.3,
    wantsClimb: false,
    crossings: 0,
    lengthMeters: 2000,
    conversationalTargetMeters: 3000,
  }

  it('crossings carry no ranking penalty', () => {
    expect(segmentQuality({ ...conv, crossings: 3 })).toBe(segmentQuality(conv))
  })

  it('rewards stretches nearer the target length', () => {
    expect(segmentQuality({ ...conv, lengthMeters: 2500 })).toBeGreaterThan(
      segmentQuality({ ...conv, lengthMeters: 500 }),
    )
  })

  it('a long ordinary stretch outranks a tiny perfect loop', () => {
    const tinyPerfectLoop = { ...conv, minQuietness: 1, gradientPercent: 0, lengthMeters: 40 }
    const decentLongStretch = {
      ...conv,
      minQuietness: 0.7,
      gradientPercent: 1,
      lengthMeters: 2800,
      crossings: 2,
    }
    expect(segmentQuality(decentLongStretch)).toBeGreaterThan(segmentQuality(tinyPerfectLoop))
  })

  it('length-fit saturates at the target', () => {
    expect(segmentQuality({ ...conv, lengthMeters: 6000 })).toBe(
      segmentQuality({ ...conv, lengthMeters: 3000 }),
    )
  })
})
```

- [x] **Step 2: Run to verify failure** — `npm test -- evaluate` — the new
  block fails (extra params are unknown to the current signature → TS error).
- [x] **Step 3: Implement** — rename `QUALITY_WEIGHTS` →
  `WORK_QUALITY_WEIGHTS`, add the conversational constant and branch:

```ts
const WORK_QUALITY_WEIGHTS = { quietness: 0.45, gradient: 0.25, crossingFree: 0.3 }
/**
 * Conversational sessions (decision 17) tolerate crossings: crossing-freeness
 * is replaced by length-fit — stretch length over the capped work-phase
 * target, clamped to 1. Weights sum to 1. v1 constants, tunable.
 */
const CONVERSATIONAL_QUALITY_WEIGHTS = { quietness: 0.45, gradient: 0.2, lengthFit: 0.35 }

export function segmentQuality(params: {
  minQuietness: number
  gradientPercent: number
  wantsClimb: boolean
  crossings: number
  lengthMeters: number
  /** Capped work-phase target for conversational sessions (decision 17); null = work stretch. */
  conversationalTargetMeters: number | null
}): number {
  const quietness = clamp01(params.minQuietness)
  const gradient = gradientFit(params.gradientPercent, params.wantsClimb)
  if (params.conversationalTargetMeters !== null) {
    const w = CONVERSATIONAL_QUALITY_WEIGHTS
    return (
      w.quietness * quietness +
      w.gradient * gradient +
      w.lengthFit * clamp01(params.lengthMeters / params.conversationalTargetMeters)
    )
  }
  const w = WORK_QUALITY_WEIGHTS
  return (
    w.quietness * quietness +
    w.gradient * gradient +
    w.crossingFree * crossingFreeness(params.crossings)
  )
}
```

- [x] **Step 4: Run to verify pass** — `npm test -- evaluate` all green
  (existing decision-16 tests updated only by the two new `base` fields).
- [x] **Step 5: Commit** — `feat: conversational quality blend without crossing cost`

### Task 2: Finder — extend, floor, and rank conversational stretches

**Files:**
- Modify: `src/lib/engine/finder.ts`
- Test: `src/lib/engine/finder.test.ts`

**Interfaces:**
- Consumes: Task 1's `segmentQuality` signature.
- Produces: `FindOptions` gains `workTargetMeters?: number` (compiled work
  phase length; used only when `requirements.minUninterruptedMeters === null`).
  Task 3 passes it from the planner.

- [x] **Step 1: Write the failing tests** — add to `finder.test.ts`:

```ts
const easy: TerrainRequirements = {
  maxAvgGradientPercent: 6,
  minAvgGradientPercent: null,
  maxJunctionsPerKm: 12,
  minQuietness: 0.4,
  surface: 'any',
  minUninterruptedMeters: null,
}

describe('findWorkSegments — conversational sessions (decision 17)', () => {
  it('filters degenerate fragments below the conversational floor', async () => {
    const graph = buildGraph([straightWay(1, 51.45, -2.58, 3, 'residential', 'asphalt')]) // ~222m
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
    })
    expect(results).toHaveLength(0)
  })

  it('extends conversational stretches toward the work target', async () => {
    // A→Jn is ~556m; only assembly across the junction goes further.
    const A: [number, number] = [51.45, -2.58]
    const Jn: [number, number] = [51.455, -2.58]
    const W: [number, number] = [51.455, -2.587]
    const graph = buildGraph([pointWay(1, [10, 20], [A, Jn]), pointWay(2, [20, 30], [Jn, W])])
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
    })
    expect(Math.max(...results.map((r) => r.lengthMeters))).toBeGreaterThan(700)
  })

  it('ranks a long stretch above a shorter quieter one', async () => {
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 28, 'residential', 'asphalt'), // ~3000m, quietness 0.7
      straightWay(2, 51.45, -2.577, 4, 'cycleway', 'asphalt'), // ~333m, quietness 0.9
    ])
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
      maxDistanceFromStartMeters: 4000,
    })
    expect(results.length).toBeGreaterThan(1)
    expect(results[0].lengthMeters).toBeGreaterThan(2000)
  })

  it('still reports crossings as an annotation', async () => {
    // Straight-on is the only continuation: a crossing, tolerated for easy.
    const A: [number, number] = [51.45, -2.58]
    const Jn: [number, number] = [51.455, -2.58]
    const N: [number, number] = [51.46, -2.58]
    const graph = buildGraph([pointWay(1, [10, 20], [A, Jn]), pointWay(2, [20, 50], [Jn, N])])
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
    })
    expect(results[0].crossings).toBe(1)
  })
})
```

- [x] **Step 2: Run to verify failure** — `npm test -- finder` — extension and
  ranking tests fail (no extension happens; `workTargetMeters` unknown).
- [x] **Step 3: Implement** in `finder.ts`:

```ts
/** Decision 17: conversational assembly and ranking constants. Tunable. */
const CONVERSATIONAL_STRETCH_CAP_METERS = 3000
const MIN_CONVERSATIONAL_STRETCH_METERS = 400
const CONVERSATIONAL_MAX_HOPS = 30

// FindOptions gains:
//   /** Compiled work-phase length (meters); drives conversational assembly
//    *  and length-fit (decision 17). Ignored for work sessions. */
//   workTargetMeters?: number

// In findWorkSegments, before assembling:
const conversationalTargetMeters =
  requirements.minUninterruptedMeters === null
    ? Math.min(
        options.workTargetMeters ?? CONVERSATIONAL_STRETCH_CAP_METERS,
        CONVERSATIONAL_STRETCH_CAP_METERS,
      )
    : null
const stretchOptions =
  conversationalTargetMeters !== null
    ? { targetMeters: conversationalTargetMeters, maxHops: CONVERSATIONAL_MAX_HOPS }
    : { targetMeters: requirements.minUninterruptedMeters ?? 0 }

// In the candidate loop, after the distance prefilter:
if (
  conversationalTargetMeters !== null &&
  chain.lengthMeters < MIN_CONVERSATIONAL_STRETCH_METERS
)
  continue

// segmentQuality call gains:
//   lengthMeters: chain.lengthMeters,
//   conversationalTargetMeters,
```

- [x] **Step 4: Run to verify pass** — `npm test -- finder` all green
  (existing work-stretch tests untouched and passing).
- [x] **Step 5: Commit** — `feat: extend and rank conversational stretches by length-fit`

### Task 3: Planner threads the work-phase target

**Files:**
- Modify: `src/lib/planner/plan-route.ts`
- Test: `src/lib/planner/plan-route.test.ts`

**Interfaces:**
- Consumes: Task 2's `FindOptions.workTargetMeters`.
- Produces: no signature change — `planRoute` internally passes the compiled
  work phase's `targetMeters` to the finder.

- [x] **Step 1: Write the failing test** — the compiled target caps assembly,
  so a short easy session must stop extending where a long one keeps going:

```ts
it('threads the work-phase distance into conversational assembly (decision 17)', async () => {
  // A→Jn ~556m plus a left branch ~490m: extension is possible but only
  // worthwhile if the finder knows the session's distance.
  const ways = [
    pointWay(1, [10, 20], [[51.45, -2.58], [51.455, -2.58]]),
    pointWay(2, [20, 30], [[51.455, -2.58], [51.455, -2.587]]),
  ]
  // 500m easy: the seed corridor already exceeds the target — no extension.
  const short = await planRoute({ type: 'easy', distanceMeters: 500 }, start, depsFor(ways))
  expect(Math.max(...short.segments.map((s) => s.lengthMeters))).toBeLessThan(700)
  // 10km easy: assembly extends across the junction.
  const long = await planRoute({ type: 'easy', distanceMeters: 10000 }, start, depsFor(ways))
  expect(Math.max(...long.segments.map((s) => s.lengthMeters))).toBeGreaterThan(700)
})
```

  (Add the same `pointWay` helper used in `finder.test.ts` to this file.)

- [x] **Step 2: Run to verify failure** — `npm test -- plan-route` — both
  sessions behave identically because the target is never passed.
- [x] **Step 3: Implement** — in `plan-route.ts`, return the whole phase from
  the guard and thread its target:

```ts
/** The work phase always exists with non-null requirements; guard defensively. */
function workPhase(plan: SessionPlan): PhasePlan & { requirements: TerrainRequirements } {
  const work = plan.phases.find((phase) => phase.kind === 'work')
  if (!work || work.requirements === null) {
    throw new Error('compiled plan has no work phase with requirements')
  }
  return { ...work, requirements: work.requirements }
}

// in planRoute:
const work = workPhase(plan)
const segments = await findWorkSegments(graph, start, work.requirements, deps.sampleElevations, {
  maxDistanceFromStartMeters: searchRadiusMeters,
  maxResults,
  workTargetMeters: work.targetMeters,
})
return { plan, requirements: work.requirements, segments }
```

- [x] **Step 4: Run to verify pass** — `npm test -- plan-route` all green.
- [x] **Step 5: Commit** — `feat: thread session distance into conversational stretch finding`

### Task 4: Full verification and live check

- [x] **Step 1:** `npm run lint && npm run typecheck && npm test` — all green.
- [x] **Step 2:** `npm run dev`; enter BS1 5AU, easy, 10 km. Verify: no
  "0.0 km" results; top results are ≥ ~1 km stretches; crossings shown as
  caveats, not score-killers. Tune the four constants if the live results
  argue for it (they are the only knobs).
- [ ] **Step 3:** Decide with the owner whether to push and open the PR
  (scorecard: Impact 🟡 — ranking changes for easy/long only; Breaking 🟢 —
  `segmentQuality` signature change is internal to `engine`; Review priority
  🟡 — touches `evaluate.ts` where the segment-quality plan is 6/7).

### Task 5: Flow continuation for conversational assembly (tuning round)

**Files:**
- Modify: `src/lib/engine/stretches.ts`, `src/lib/engine/finder.ts`
- Test: `src/lib/engine/stretches.test.ts`, `src/lib/engine/finder.test.ts`

**Why (evidence from live BS1 5AU data, 2,846 walks):** decision 15's
left>right>straight continuation walked off the harbourside quay onto a 7 m
sliver (turns exist to dodge crossings, which conversational sessions
tolerate); 2,841 walks ended with no reachable continuation and none reached
the 3 km cap. A "flow" rule — quietest sustained corridor first, sliver
corridors discounted below 200 m — reached the cap on real data and raised
gate-passing ≥400 m stretches from 258 to 326. Decision 17 amended first
(own commit) to record flow.

**Interfaces:**
- Produces: `AssembleOptions.continuation?: 'turns' | 'flow'` (default
  `'turns'`, unchanged for work stretches); the finder passes `'flow'` when
  `requirements.minUninterruptedMeters === null`.

- [x] **Step 1:** Failing tests — sliver-left vs sustained-straight fixture in
  `stretches.test.ts` (turns takes the sliver; flow takes the path and still
  tallies the crossing) and a finder test proving conversational sessions get
  flow (top length > 1000 m only if the long path is followed).
- [x] **Step 2:** Verified both fail (turns behaviour everywhere).
- [x] **Step 3:** Implement `continuation` option + `FLOW_SUSTAIN_METERS = 200`
  in `stretches.ts`; finder passes `continuation: 'flow'` for conversational.
- [x] **Step 4:** `lint`/`typecheck`/full suite green (238 tests).
- [x] **Step 5:** Commit — `feat: flow continuation for conversational stretch assembly`
- [ ] **Step 6:** Live BS1 5AU re-check: top stretches should now follow the
  harbourside instead of stopping at 0.9 km.
