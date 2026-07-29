# Route Engine D: Fork Rule, Connectors, Assembly, GPX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the engine: implement Liam's two 2C-close decisions (straightest-by-bearing fork continuation; `pedestrian` as a minor join), then turn a `WorkSegment` into a full runnable route — warm-up connector, laps on the stretch, cool-down home — exported as GPX, behind one orchestrator function `generateRoute(session, start, deps)`.

**Architecture:** Five modules/changes. `geo.ts` gains bearing helpers. `chains.ts`'s `structuralContinuation` gains the bearing tie-breaker for ambiguous same-class forks (cap 45°, uniqueness margin 10° — tunable v1 constants) and `pedestrian` joins the minor set. `connectors.ts` wraps Openrouteservice: A→B foot routing and round-trip loops (for easy/long runs), pure body-builders/parsers + thin fetch. `assemble.ts` builds work geometry (out-and-back passes on a stretch; laps of a ring, rotated so the nearest ring point is the entry) and concatenates warm-up + work + cool-down with phase spans. `gpx.ts` renders GPX 1.1 with Work start/end waypoints. `plan.ts` orchestrates with injected I/O deps (tests use fakes): easy/long → ORS round-trip loop; tempo/intervals/hills → finder → connectors → laps. This plan extends the engine→domain dependency to a **function** import (`compileSession`) — one-way, engine→domain, never the reverse.

**Tech Stack:** TypeScript, Vitest. No new dependencies. No network in tests.

## Global Constraints

- Distances meters, bearings degrees (0 = north, clockwise). No `any`; `npm run lint` and `npm test` pass at every commit.
- Decisions of record (Liam, 2026-07-29 — do not re-litigate): bearing fork rule with sanity cap; `pedestrian` minor join. The bearing rule applies ONLY to the same-class ambiguity branch — the "all others minor" veto is unchanged, so a residential Y-fork still terminates (its unchosen branch is not minor).
- ORS facts (validated live with Liam's key): POST `https://api.openrouteservice.org/v2/directions/foot-walking/geojson`, header `Authorization: <key>`, JSON body `{coordinates: [[lon,lat],…]}` (LON FIRST); response `features[0].geometry.coordinates` is `[lon,lat][]` and `features[0].properties.summary.distance` is meters. Round trips: single coordinate + `options: {round_trip: {length, points: 3, seed}}`.
- Known limitation to note in code (plan.ts doc comment), not to fix here: easy/long loops come from ORS round-trip, which ignores our quietness/surface signals.
- Cycle work segments enter at the ring point nearest the runner (never `points[0]` blindly).
- All I/O through injected deps; thin fetch wrappers untested, builders/parsers tested.
- Commit messages: conventional commits ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Bearing fork rule + pedestrian minor join

**Files:**
- Modify: `src/lib/engine/geo.ts` (add `bearingDegrees`, `angularDifferenceDegrees`)
- Modify: `src/lib/engine/geo.test.ts` (append bearing tests)
- Modify: `src/lib/engine/chains.ts`
- Modify: `src/lib/engine/chains.test.ts` (append fork tests)

**Interfaces:**
- Produces: `bearingDegrees(a: LatLon, b: LatLon): number`, `angularDifferenceDegrees(a: number, b: number): number`; updated `structuralContinuation` behavior; `MINOR_JOIN_HIGHWAYS` gains `'pedestrian'`.

- [ ] **Step 1: Write failing bearing tests**

Append to `src/lib/engine/geo.test.ts`:

```ts
describe('bearingDegrees', () => {
  it('points north, east, and south correctly', () => {
    expect(bearingDegrees({ lat: 51, lon: -2.5 }, { lat: 52, lon: -2.5 })).toBeCloseTo(0, 0)
    expect(bearingDegrees({ lat: 51, lon: -2.5 }, { lat: 51, lon: -2.4 })).toBeCloseTo(90, 0)
    expect(bearingDegrees({ lat: 52, lon: -2.5 }, { lat: 51, lon: -2.5 })).toBeCloseTo(180, 0)
  })
})

describe('angularDifferenceDegrees', () => {
  it('wraps around the compass', () => {
    expect(angularDifferenceDegrees(350, 10)).toBe(20)
    expect(angularDifferenceDegrees(10, 350)).toBe(20)
    expect(angularDifferenceDegrees(90, 90)).toBe(0)
    expect(angularDifferenceDegrees(0, 180)).toBe(180)
  })
})
```

(Add the two names to the existing import from `'./geo'`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — FAIL: names not exported.

- [ ] **Step 3: Implement bearing helpers**

Append to `src/lib/engine/geo.ts`:

```ts
/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const dLon = toRadians(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Smallest angle between two compass bearings, in [0, 180]. */
export function angularDifferenceDegrees(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
```

Run: `npm test` — bearing tests pass.

- [ ] **Step 4: Write failing fork tests**

Append inside `describe('buildChains', ...)` in `src/lib/engine/chains.test.ts`:

```ts
  it('continues through a same-class fork along the straightest branch', () => {
    // footways: a,b colinear heading north; c branches due east at node 11
    const a: OsmWay = { id: 1, tags: { highway: 'footway' }, nodeIds: [10, 11], points: [{ lat: 51.45, lon: -2.58 }, { lat: 51.451, lon: -2.58 }] }
    const b: OsmWay = { id: 2, tags: { highway: 'footway' }, nodeIds: [11, 12], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.452, lon: -2.58 }] }
    const c: OsmWay = { id: 3, tags: { highway: 'footway' }, nodeIds: [11, 13], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.451, lon: -2.579 }] }
    const chains = buildChains(buildGraph([a, b, c]))
    expect(chains).toHaveLength(2)
    const main = chains.find((ch) => ch.edges.length === 2)
    expect(main).toBeDefined()
    expect(main!.toleratedJunctionNodeIds).toEqual([11])
    const lats = main!.points.map((p) => p.lat)
    expect(lats).toEqual([...lats].sort((x, y) => x - y))
  })

  it('still cuts a symmetric same-class Y-fork (no unique straightest)', () => {
    const a: OsmWay = { id: 1, tags: { highway: 'footway' }, nodeIds: [10, 11], points: [{ lat: 51.45, lon: -2.58 }, { lat: 51.451, lon: -2.58 }] }
    const b: OsmWay = { id: 2, tags: { highway: 'footway' }, nodeIds: [11, 12], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.4517, lon: -2.579 }] }
    const c: OsmWay = { id: 3, tags: { highway: 'footway' }, nodeIds: [11, 13], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.4517, lon: -2.581 }] }
    const chains = buildChains(buildGraph([a, b, c]))
    expect(chains).toHaveLength(3)
    for (const ch of chains) expect(ch.toleratedJunctionNodeIds).toEqual([])
  })

  it('cuts a fork whose straightest branch still bends beyond the cap', () => {
    // both branches head back southish (>45 degrees off the northward arrival)
    const a: OsmWay = { id: 1, tags: { highway: 'footway' }, nodeIds: [10, 11], points: [{ lat: 51.45, lon: -2.58 }, { lat: 51.451, lon: -2.58 }] }
    const b: OsmWay = { id: 2, tags: { highway: 'footway' }, nodeIds: [11, 12], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.4505, lon: -2.579 }] }
    const c: OsmWay = { id: 3, tags: { highway: 'footway' }, nodeIds: [11, 13], points: [{ lat: 51.451, lon: -2.58 }, { lat: 51.4503, lon: -2.5815 }] }
    const chains = buildChains(buildGraph([a, b, c]))
    expect(chains).toHaveLength(3)
  })

  it('treats a pedestrian join as minor', () => {
    const street = way(1, [10, 11, 12], [51.45, 51.451, 51.452])
    const plaza: OsmWay = {
      id: 2,
      tags: { highway: 'pedestrian' },
      nodeIds: [11, 20],
      points: [
        { lat: 51.451, lon: -2.5801 },
        { lat: 51.451, lon: -2.579 },
      ],
    }
    const chains = buildChains(buildGraph([street, plaza]))
    expect(chains).toHaveLength(2)
    const streetChain = chains.find((c) => c.edges[0].highway === 'residential')
    expect(streetChain!.edges).toHaveLength(2)
    expect(streetChain!.toleratedJunctionNodeIds).toEqual([11])
  })
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test` — the straightest-branch test and pedestrian test fail (fork currently always cuts; pedestrian is not minor).

- [ ] **Step 6: Implement**

In `src/lib/engine/chains.ts`:

Add `'pedestrian'` to `MINOR_JOIN_HIGHWAYS`. Add imports: `import { bearingDegrees, angularDifferenceDegrees } from './geo'`. Add constants and helpers above `buildChains`:

```ts
/** A fork's straightest branch must stay within this of the arrival heading. */
const MAX_FORK_DEVIATION_DEGREES = 45
/** ...and beat the runner-up by at least this margin, else the fork is ambiguous. */
const FORK_MARGIN_DEGREES = 10

/** Bearing of the final approach into nodeId along an edge. */
function headingInto(edge: RunEdge, nodeId: number): number {
  const pts = edge.toNodeId === nodeId ? edge.points : [...edge.points].reverse()
  return bearingDegrees(pts[pts.length - 2], pts[pts.length - 1])
}

/** Bearing leaving nodeId along an edge. */
function headingOutOf(edge: RunEdge, nodeId: number): number {
  const pts = edge.fromNodeId === nodeId ? edge.points : [...edge.points].reverse()
  return bearingDegrees(pts[0], pts[1])
}

/** The uniquely straightest continuation among same-class fork branches, or null. */
function straightestBranch(byClass: RunEdge[], nodeId: number, arrived: RunEdge): RunEdge | null {
  const arrival = headingInto(arrived, nodeId)
  const scored = byClass
    .map((edge) => ({ edge, deviation: angularDifferenceDegrees(arrival, headingOutOf(edge, nodeId)) }))
    .sort((a, b) => a.deviation - b.deviation)
  const best = scored[0]
  if (best.deviation > MAX_FORK_DEVIATION_DEGREES) return null
  if (scored.length > 1 && scored[1].deviation - best.deviation < FORK_MARGIN_DEGREES) return null
  return best.edge
}
```

In `structuralContinuation`, extend the same-class branch:

```ts
    } else if (byWay.length === 0) {
      const byClass = candidates.filter((e) => e.highway === arrived.highway)
      if (byClass.length === 1) chosen = byClass[0]
      else if (byClass.length > 1) chosen = straightestBranch(byClass, nodeId, arrived)
    }
```

(The "all others minor" veto after selection is unchanged and still applies.)

**CRITICAL — mutuality wrapper.** Bearing selection is direction-dependent: at a symmetric Y, the stem sees an ambiguous fork, but each branch sees the stem as its unique straightest continuation. If the walk used `structuralContinuation` directly, chain shape would again depend on which end a walk started from — the exact nondeterminism 2C fixed. Passability must be agreed by BOTH directions. Add:

```ts
  /**
   * A chain passes through a node only when the continuation is mutual:
   * arriving on A picks B, and arriving on B picks A. Bearing selection is
   * direction-dependent (a Y-branch can see the stem as straight while the
   * stem sees ambiguity), so one-sided agreement would reintroduce
   * walk-order dependence.
   */
  const mutualContinuation = (nodeId: number, arrived: RunEdge): RunEdge | null => {
    const chosen = structuralContinuation(nodeId, arrived)
    if (!chosen) return null
    return structuralContinuation(nodeId, chosen) === arrived ? chosen : null
  }
```

Then replace BOTH call sites of `structuralContinuation` outside these helpers with `mutualContinuation`: the walk's degree-≥3 branch (`const next = mutualContinuation(nodeId, edge)`) and Pass 1's start condition (`degree(...) !== 2 && mutualContinuation(...) === null`). With mutuality, the symmetric-Y test's 3-chain expectation holds from every walk order; the straight-through fork remains mutual (each end picks the other) and still merges.

- [ ] **Step 7: Run tests to verify they pass; lint**

Run: `npm test && npm run lint` — all pass (existing wide-fixture lower-bound assertions still hold: the rule only merges more, never less). Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: straightest-by-bearing fork continuation and pedestrian minor joins

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Openrouteservice connectors

**Files:**
- Create: `src/lib/engine/connectors.ts`
- Test: `src/lib/engine/connectors.test.ts`

**Interfaces:**
- Produces: `FootRoute { points: LatLon[]; lengthMeters: number }`, `buildDirectionsBody(from: LatLon, to: LatLon)`, `buildRoundTripBody(start: LatLon, lengthMeters: number, seed?: number)`, `parseOrsResponse(body: unknown): FootRoute`, thin `fetchFootRoute(apiKey, from, to)` and `fetchRoundTrip(apiKey, start, lengthMeters, seed?)`. Tasks 3/5 consume `FootRoute`.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/connectors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDirectionsBody, buildRoundTripBody, parseOrsResponse } from './connectors'

const orsFixture = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { summary: { distance: 1176.3, duration: 846.9 } },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-2.5879, 51.4545],
          [-2.59, 51.4562],
          [-2.595, 51.46],
        ],
      },
    },
  ],
}

describe('buildDirectionsBody', () => {
  it('emits lon-first coordinate pairs', () => {
    const body = buildDirectionsBody({ lat: 51.4545, lon: -2.5879 }, { lat: 51.46, lon: -2.595 })
    expect(body.coordinates).toEqual([
      [-2.5879, 51.4545],
      [-2.595, 51.46],
    ])
  })
})

describe('buildRoundTripBody', () => {
  it('requests a round trip of the given length from one coordinate', () => {
    const body = buildRoundTripBody({ lat: 51.4545, lon: -2.5879 }, 8000, 7)
    expect(body.coordinates).toEqual([[-2.5879, 51.4545]])
    expect(body.options.round_trip).toEqual({ length: 8000, points: 3, seed: 7 })
  })

  it('defaults the seed', () => {
    expect(buildRoundTripBody({ lat: 51, lon: -2 }, 5000).options.round_trip.seed).toBe(1)
  })
})

describe('parseOrsResponse', () => {
  it('parses points (lat/lon swapped back) and distance', () => {
    const route = parseOrsResponse(orsFixture)
    expect(route.lengthMeters).toBeCloseTo(1176.3, 3)
    expect(route.points).toHaveLength(3)
    expect(route.points[0]).toEqual({ lat: 51.4545, lon: -2.5879 })
    expect(route.points[2]).toEqual({ lat: 51.46, lon: -2.595 })
  })

  it('throws descriptively on null, missing features, and empty features', () => {
    expect(() => parseOrsResponse(null)).toThrow(/features/)
    expect(() => parseOrsResponse({ error: 'x' })).toThrow(/features/)
    expect(() => parseOrsResponse({ features: [] })).toThrow(/features/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — FAIL: `Cannot find module './connectors'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/connectors.ts`:

```ts
import type { LatLon } from './types'

const ORS_DIRECTIONS_URL =
  'https://api.openrouteservice.org/v2/directions/foot-walking/geojson'

export interface FootRoute {
  points: LatLon[]
  lengthMeters: number
}

export function buildDirectionsBody(
  from: LatLon,
  to: LatLon,
): { coordinates: [number, number][] } {
  return {
    coordinates: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
  }
}

export function buildRoundTripBody(
  start: LatLon,
  lengthMeters: number,
  seed = 1,
): {
  coordinates: [number, number][]
  options: { round_trip: { length: number; points: number; seed: number } }
} {
  return {
    coordinates: [[start.lon, start.lat]],
    options: { round_trip: { length: lengthMeters, points: 3, seed } },
  }
}

interface OrsFeature {
  properties?: { summary?: { distance?: number } }
  geometry?: { coordinates?: [number, number][] }
}

export function parseOrsResponse(body: unknown): FootRoute {
  if (typeof body !== 'object' || body === null) {
    throw new Error('ORS response has no features array')
  }
  const features = (body as { features?: unknown }).features
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error('ORS response has no features array')
  }
  const feature = features[0] as OrsFeature
  const coordinates = feature.geometry?.coordinates
  const distance = feature.properties?.summary?.distance
  if (!Array.isArray(coordinates) || coordinates.length < 2 || typeof distance !== 'number') {
    throw new Error('ORS feature is missing geometry coordinates or summary distance')
  }
  return {
    points: coordinates.map(([lon, lat]) => ({ lat, lon })),
    lengthMeters: distance,
  }
}

/** I/O glue — composition of tested parts; not unit-tested. */
async function postOrs(apiKey: string, body: unknown): Promise<FootRoute> {
  const response = await fetch(ORS_DIRECTIONS_URL, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`ORS request failed: ${response.status}`)
  }
  return parseOrsResponse(await response.json())
}

/** I/O glue — not unit-tested. */
export async function fetchFootRoute(apiKey: string, from: LatLon, to: LatLon): Promise<FootRoute> {
  return postOrs(apiKey, buildDirectionsBody(from, to))
}

/** I/O glue — not unit-tested. */
export async function fetchRoundTrip(
  apiKey: string,
  start: LatLon,
  lengthMeters: number,
  seed = 1,
): Promise<FootRoute> {
  return postOrs(apiKey, buildRoundTripBody(start, lengthMeters, seed))
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: openrouteservice foot-route and round-trip connectors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Work geometry and route assembly

**Files:**
- Create: `src/lib/engine/assemble.ts`
- Test: `src/lib/engine/assemble.test.ts`

**Interfaces:**
- Consumes: `LatLon` from `./types`; `haversineMeters`, `pathLengthMeters` from `./geo`; `FootRoute` from `./connectors`.
- Produces: `WorkGeometry`, `RoutePhaseSpan`, `AssembledRoute`, `buildWorkGeometry(segment, targetMeters)`, `rotateRingToNearest(ring, target)`, `assembleRoute(warmup, work, cooldown)`, `assembleLoopRoute(loop)`. Task 5 composes these; the UI plan renders `AssembledRoute`; Task 4 renders it to GPX.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/assemble.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pathLengthMeters } from './geo'
import {
  assembleLoopRoute,
  assembleRoute,
  buildWorkGeometry,
  rotateRingToNearest,
} from './assemble'
import type { LatLon } from './types'

const stretch: LatLon[] = [
  { lat: 51.45, lon: -2.58 },
  { lat: 51.454, lon: -2.58 },
  { lat: 51.459, lon: -2.58 },
]
const stretchLength = pathLengthMeters(stretch) // ~1001m

const ring: LatLon[] = [
  { lat: 51.45, lon: -2.58 },
  { lat: 51.451, lon: -2.579 },
  { lat: 51.452, lon: -2.58 },
  { lat: 51.451, lon: -2.581 },
  { lat: 51.45, lon: -2.58 },
]

describe('buildWorkGeometry', () => {
  it('runs a stretch out-and-back for the required passes', () => {
    // target 6800m on ~1001m => 7 passes
    const work = buildWorkGeometry(
      { points: stretch, lengthMeters: stretchLength, isCycle: false },
      6800,
    )
    expect(work.passes).toBe(7)
    expect(work.meters).toBeCloseTo(stretchLength * 7, 6)
    // odd passes end at the far end
    expect(work.points[work.points.length - 1]).toEqual(stretch[2])
    expect(pathLengthMeters(work.points)).toBeCloseTo(stretchLength * 7, 0)
  })

  it('even passes return to the near end', () => {
    const work = buildWorkGeometry(
      { points: stretch, lengthMeters: stretchLength, isCycle: false },
      2000,
    )
    expect(work.passes).toBe(2)
    expect(work.points[work.points.length - 1]).toEqual(stretch[0])
  })

  it('laps a cycle forward without reversing', () => {
    const ringLength = pathLengthMeters(ring)
    const work = buildWorkGeometry({ points: ring, lengthMeters: ringLength, isCycle: true }, ringLength * 3)
    expect(work.passes).toBe(3)
    expect(work.points[0]).toEqual(ring[0])
    expect(work.points[work.points.length - 1]).toEqual(ring[0])
    expect(pathLengthMeters(work.points)).toBeCloseTo(ringLength * 3, 0)
  })

  it('always makes at least one pass and rejects nonsense targets', () => {
    const work = buildWorkGeometry({ points: stretch, lengthMeters: stretchLength, isCycle: false }, 100)
    expect(work.passes).toBe(1)
    expect(() =>
      buildWorkGeometry({ points: stretch, lengthMeters: stretchLength, isCycle: false }, 0),
    ).toThrow(/target/i)
  })
})

describe('rotateRingToNearest', () => {
  it('starts the ring at the point nearest the target and preserves length', () => {
    const target: LatLon = { lat: 51.452, lon: -2.5801 }
    const rotated = rotateRingToNearest(ring, target)
    expect(rotated[0]).toEqual({ lat: 51.452, lon: -2.58 })
    expect(rotated[rotated.length - 1]).toEqual(rotated[0])
    expect(rotated).toHaveLength(ring.length)
    expect(pathLengthMeters(rotated)).toBeCloseTo(pathLengthMeters(ring), 6)
  })

  it('rejects an unclosed ring', () => {
    expect(() => rotateRingToNearest(stretch, { lat: 51.45, lon: -2.58 })).toThrow(/ring/i)
  })
})

describe('assembleRoute', () => {
  it('concatenates phases with contiguous spans and summed totals', () => {
    const warmup = { points: [{ lat: 51.44, lon: -2.58 }, stretch[0]], lengthMeters: 500 }
    const cooldown = { points: [stretch[2], { lat: 51.44, lon: -2.58 }], lengthMeters: 600 }
    const work = buildWorkGeometry(
      { points: stretch, lengthMeters: stretchLength, isCycle: false },
      1000,
    )
    const route = assembleRoute(warmup, work, cooldown)
    expect(route.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
    expect(route.totalMeters).toBeCloseTo(500 + work.meters + 600, 6)
    expect(route.phases[0].startIndex).toBe(0)
    expect(route.phases[1].startIndex).toBe(route.phases[0].endIndex + 1)
    expect(route.phases[2].startIndex).toBe(route.phases[1].endIndex + 1)
    expect(route.phases[2].endIndex).toBe(route.points.length - 1)
  })
})

describe('assembleLoopRoute', () => {
  it('wraps a round-trip loop as a single work phase', () => {
    const loop = { points: ring, lengthMeters: 8000 }
    const route = assembleLoopRoute(loop)
    expect(route.phases).toEqual([
      { kind: 'work', startIndex: 0, endIndex: ring.length - 1, meters: 8000 },
    ])
    expect(route.totalMeters).toBe(8000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — FAIL: `Cannot find module './assemble'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/assemble.ts`:

```ts
import type { LatLon } from './types'
import type { FootRoute } from './connectors'
import { haversineMeters } from './geo'

export interface WorkGeometry {
  points: LatLon[]
  meters: number
  passes: number
}

export interface RoutePhaseSpan {
  kind: 'warmup' | 'work' | 'cooldown'
  startIndex: number
  endIndex: number
  meters: number
}

export interface AssembledRoute {
  points: LatLon[]
  totalMeters: number
  phases: RoutePhaseSpan[]
}

/**
 * Lay the work distance onto a segment: back-and-forth passes on a stretch
 * (odd pass count ends at the far end), forward laps on a cycle. Rounds to
 * the nearest whole pass, minimum one — a session overshoots or undershoots
 * by at most half a pass.
 */
export function buildWorkGeometry(
  segment: { points: LatLon[]; lengthMeters: number; isCycle: boolean },
  targetMeters: number,
): WorkGeometry {
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) {
    throw new Error('targetMeters must be a positive number')
  }
  const passes = Math.max(1, Math.round(targetMeters / segment.lengthMeters))
  const points: LatLon[] = [...segment.points]
  for (let pass = 1; pass < passes; pass++) {
    const forward = segment.isCycle || pass % 2 === 0
    const next = forward ? segment.points : [...segment.points].reverse()
    points.push(...next.slice(1))
  }
  return { points, meters: segment.lengthMeters * passes, passes }
}

/** Rotate a closed ring so it starts at the point nearest the target. */
export function rotateRingToNearest(ring: LatLon[], target: LatLon): LatLon[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (ring.length < 4 || first.lat !== last.lat || first.lon !== last.lon) {
    throw new Error('rotateRingToNearest requires a closed ring')
  }
  const open = ring.slice(0, -1)
  let bestIndex = 0
  let bestDistance = Infinity
  open.forEach((point, i) => {
    const d = haversineMeters(point, target)
    if (d < bestDistance) {
      bestDistance = d
      bestIndex = i
    }
  })
  const rotated = [...open.slice(bestIndex), ...open.slice(0, bestIndex)]
  rotated.push(rotated[0])
  return rotated
}

export function assembleRoute(
  warmup: FootRoute,
  work: WorkGeometry,
  cooldown: FootRoute,
): AssembledRoute {
  const points: LatLon[] = [...warmup.points]
  const phases: RoutePhaseSpan[] = [
    { kind: 'warmup', startIndex: 0, endIndex: points.length - 1, meters: warmup.lengthMeters },
  ]
  const workStart = points.length
  points.push(...work.points)
  phases.push({ kind: 'work', startIndex: workStart, endIndex: points.length - 1, meters: work.meters })
  const coolStart = points.length
  points.push(...cooldown.points)
  phases.push({ kind: 'cooldown', startIndex: coolStart, endIndex: points.length - 1, meters: cooldown.lengthMeters })
  return {
    points,
    totalMeters: warmup.lengthMeters + work.meters + cooldown.lengthMeters,
    phases,
  }
}

/** Easy/long loops have no connectors: the whole loop is the work phase. */
export function assembleLoopRoute(loop: FootRoute): AssembledRoute {
  return {
    points: [...loop.points],
    totalMeters: loop.lengthMeters,
    phases: [
      { kind: 'work', startIndex: 0, endIndex: loop.points.length - 1, meters: loop.lengthMeters },
    ],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: work-geometry laps and phase-spanned route assembly

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: GPX export

**Files:**
- Create: `src/lib/engine/gpx.ts`
- Test: `src/lib/engine/gpx.test.ts`

**Interfaces:**
- Consumes: `AssembledRoute` from `./assemble`.
- Produces: `toGpx(route: AssembledRoute, name: string): string`. Task 5 and the UI plan's download endpoint call it.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/gpx.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AssembledRoute } from './assemble'
import { toGpx } from './gpx'

const route: AssembledRoute = {
  points: [
    { lat: 51.44, lon: -2.58 },
    { lat: 51.45, lon: -2.58 },
    { lat: 51.459, lon: -2.58 },
    { lat: 51.44, lon: -2.58 },
  ],
  totalMeters: 3200,
  phases: [
    { kind: 'warmup', startIndex: 0, endIndex: 1, meters: 500 },
    { kind: 'work', startIndex: 2, endIndex: 2, meters: 2100 },
    { kind: 'cooldown', startIndex: 3, endIndex: 3, meters: 600 },
  ],
}

describe('toGpx', () => {
  it('renders a GPX 1.1 track with one trkpt per point', () => {
    const gpx = toGpx(route, 'Intervals 6x800m')
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(gpx).toContain('<gpx version="1.1"')
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"')
    expect(gpx.match(/<trkpt /g)).toHaveLength(4)
    expect(gpx).toContain('lat="51.44"')
    expect(gpx).toContain('lon="-2.58"')
    expect(gpx).toContain('<name>Intervals 6x800m</name>')
  })

  it('marks work start and end as waypoints for multi-phase routes', () => {
    const gpx = toGpx(route, 'Intervals')
    expect(gpx).toContain('<name>Work start</name>')
    expect(gpx).toContain('<name>Work end</name>')
  })

  it('omits waypoints for single-phase loop routes', () => {
    const loop: AssembledRoute = {
      points: route.points,
      totalMeters: 8000,
      phases: [{ kind: 'work', startIndex: 0, endIndex: 3, meters: 8000 }],
    }
    expect(toGpx(loop, 'Easy run')).not.toContain('<wpt')
  })

  it('escapes XML in names', () => {
    expect(toGpx(route, 'Reps & <hills>')).toContain('<name>Reps &amp; &lt;hills&gt;</name>')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — FAIL: `Cannot find module './gpx'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/gpx.ts`:

```ts
import type { AssembledRoute } from './assemble'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render a route as GPX 1.1 — the universal course format watches import. */
export function toGpx(route: AssembledRoute, name: string): string {
  const safeName = escapeXml(name)
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="route-planner" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${safeName}</name></metadata>`,
  ]
  const work = route.phases.find((p) => p.kind === 'work')
  if (work && route.phases.length > 1) {
    const start = route.points[work.startIndex]
    const end = route.points[work.endIndex]
    lines.push(`  <wpt lat="${start.lat}" lon="${start.lon}"><name>Work start</name></wpt>`)
    lines.push(`  <wpt lat="${end.lat}" lon="${end.lon}"><name>Work end</name></wpt>`)
  }
  lines.push(`  <trk><name>${safeName}</name><trkseg>`)
  for (const point of route.points) {
    lines.push(`    <trkpt lat="${point.lat}" lon="${point.lon}"></trkpt>`)
  }
  lines.push('  </trkseg></trk>', '</gpx>', '')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: GPX 1.1 export with work-phase waypoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The orchestrator

**Files:**
- Create: `src/lib/engine/plan.ts`
- Test: `src/lib/engine/plan.test.ts`

**Interfaces:**
- Consumes: `compileSession` from `@/lib/domain/compiler` (the engine's first domain FUNCTION import — one-way only); `findWorkSegments`, types from `./finder`; `buildGraph` from `./graph`; `assemble`/`gpx`/`connectors` modules; `OsmWay`, `LatLon` from `./types`.
- Produces: `RoutePlanDeps`, `GenerateOptions`, `GeneratedRoute`, `generateRoute(session, start, deps, options?)`. The API/UI plan binds real fetchers (`fetchWays`, `fetchElevations`, `fetchFootRoute`/`fetchRoundTrip` with the ORS key from env) and calls this one function.

- [ ] **Step 1: Write failing tests**

Create `src/lib/engine/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Session } from '@/lib/domain/types'
import type { FootRoute } from './connectors'
import type { ElevationSampler } from './finder'
import { generateRoute, type RoutePlanDeps } from './plan'
import type { LatLon, OsmWay } from './types'

function straightWay(
  id: number,
  startLat: number,
  lon: number,
  nodeCount: number,
  highway: string,
  surface?: string,
): OsmWay {
  const tags: Record<string, string> = { highway }
  if (surface) tags.surface = surface
  return {
    id,
    tags,
    nodeIds: Array.from({ length: nodeCount }, (_, i) => id * 1000 + i),
    points: Array.from({ length: nodeCount }, (_, i) => ({ lat: startLat + i * 0.001, lon })),
  }
}

const start: LatLon = { lat: 51.45, lon: -2.58 }
const flatSampler: ElevationSampler = async (points) => points.map(() => 10)

interface Recorded {
  waysCalls: Array<{ center: LatLon; radius: number }>
  footCalls: Array<{ from: LatLon; to: LatLon }>
  roundTripCalls: Array<{ start: LatLon; length: number }>
}

function fakeDeps(ways: OsmWay[]): { deps: RoutePlanDeps; recorded: Recorded } {
  const recorded: Recorded = { waysCalls: [], footCalls: [], roundTripCalls: [] }
  const deps: RoutePlanDeps = {
    fetchWays: async (center, radiusMeters) => {
      recorded.waysCalls.push({ center, radius: radiusMeters })
      return ways
    },
    sampleElevations: flatSampler,
    fetchFootRoute: async (from, to) => {
      recorded.footCalls.push({ from, to })
      return { points: [from, to], lengthMeters: 500 } satisfies FootRoute
    },
    fetchRoundTrip: async (s, lengthMeters) => {
      recorded.roundTripCalls.push({ start: s, length: lengthMeters })
      return { points: [s, { lat: s.lat + 0.01, lon: s.lon }, s], lengthMeters } satisfies FootRoute
    },
  }
  return { deps, recorded }
}

const intervalsSession: Session = { type: 'intervals', reps: 6, repMeters: 800, recovery: 'jog' }

describe('generateRoute — stretch sessions', () => {
  it('generates warmup, laps, cooldown, and gpx for intervals', async () => {
    const { deps, recorded } = fakeDeps([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'),
    ])
    const generated = await generateRoute(intervalsSession, start, deps)
    // fetch radius covers the prefilter radius plus the stretch requirement
    expect(recorded.waysCalls).toHaveLength(1)
    expect(recorded.waysCalls[0].radius).toBe(2000 + 1000)
    expect(generated.segment).not.toBeNull()
    expect(generated.route.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
    // warmup goes from the runner's start to the work entry
    expect(recorded.footCalls).toHaveLength(2)
    expect(recorded.footCalls[0].from).toEqual(start)
    // cooldown returns home
    expect(recorded.footCalls[1].to).toEqual(start)
    expect(generated.gpx).toContain('<name>Work start</name>')
    expect(generated.gpx).toContain('Intervals 6x800m')
    expect(generated.sessionPlan.workPattern).toBe('laps')
    expect(generated.route.totalMeters).toBeGreaterThan(6800)
  })

  it('throws a descriptive error when no segment qualifies', async () => {
    const { deps } = fakeDeps([straightWay(1, 51.45, -2.58, 10, 'trunk', 'asphalt')])
    await expect(generateRoute(intervalsSession, start, deps)).rejects.toThrow(/no suitable/i)
  })
})

describe('generateRoute — loop sessions', () => {
  it('routes easy runs through a round trip and skips the finder entirely', async () => {
    const { deps, recorded } = fakeDeps([])
    const generated = await generateRoute({ type: 'easy', distanceMeters: 8000 }, start, deps)
    expect(recorded.roundTripCalls).toEqual([{ start, length: 8000 }])
    expect(recorded.waysCalls).toHaveLength(0)
    expect(recorded.footCalls).toHaveLength(0)
    expect(generated.segment).toBeNull()
    expect(generated.route.phases).toHaveLength(1)
    expect(generated.gpx).not.toContain('<wpt')
    expect(generated.gpx).toContain('Easy run 8.0k')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — FAIL: `Cannot find module './plan'`.

- [ ] **Step 3: Implement**

Create `src/lib/engine/plan.ts`:

```ts
import type { Session, SessionPlan } from '@/lib/domain/types'
import { compileSession } from '@/lib/domain/compiler'
import type { LatLon, OsmWay } from './types'
import type { FootRoute } from './connectors'
import { assembleLoopRoute, assembleRoute, buildWorkGeometry, rotateRingToNearest } from './assemble'
import type { AssembledRoute } from './assemble'
import { buildGraph } from './graph'
import { findWorkSegments, type ElevationSampler, type WorkSegment } from './finder'
import { toGpx } from './gpx'

export interface RoutePlanDeps {
  fetchWays(center: LatLon, radiusMeters: number): Promise<OsmWay[]>
  sampleElevations: ElevationSampler
  fetchFootRoute(from: LatLon, to: LatLon): Promise<FootRoute>
  fetchRoundTrip(start: LatLon, lengthMeters: number): Promise<FootRoute>
}

export interface GenerateOptions {
  maxDistanceFromStartMeters?: number
  maxResults?: number
}

export interface GeneratedRoute {
  sessionPlan: SessionPlan
  route: AssembledRoute
  gpx: string
  /** The chosen work segment; null for loop (easy/long) routes. */
  segment: WorkSegment | null
}

function describeSession(session: Session): string {
  switch (session.type) {
    case 'easy':
      return `Easy run ${(session.distanceMeters / 1000).toFixed(1)}k`
    case 'long':
      return `Long run ${(session.distanceMeters / 1000).toFixed(1)}k`
    case 'tempo':
      return `Tempo ${(session.tempoMeters / 1000).toFixed(1)}k`
    case 'intervals':
      return `Intervals ${session.reps}x${session.repMeters}m`
    case 'hills':
      return `Hill reps ${session.reps}x${session.hillMeters}m`
  }
}

/**
 * The engine's front door: a session and a start point in, a routed,
 * GPX-ready course out. Easy/long runs become ORS round-trip loops (known
 * limitation: the round trip does not see our quietness/surface signals);
 * tempo/intervals/hills find a work segment, lap it, and connect it to the
 * runner's door. The Overpass fetch radius always exceeds the prefilter
 * radius by the stretch requirement so boundary clipping cannot silently
 * reject qualifying chains.
 */
export async function generateRoute(
  session: Session,
  start: LatLon,
  deps: RoutePlanDeps,
  options: GenerateOptions = {},
): Promise<GeneratedRoute> {
  const sessionPlan = compileSession(session)
  const name = describeSession(session)

  if (session.type === 'easy' || session.type === 'long') {
    const loop = await deps.fetchRoundTrip(start, sessionPlan.totalMeters)
    const route = assembleLoopRoute(loop)
    return { sessionPlan, route, gpx: toGpx(route, name), segment: null }
  }

  const workPhase = sessionPlan.phases.find((p) => p.kind === 'work')
  if (!workPhase || !workPhase.requirements) {
    throw new Error('session plan has no work phase with requirements')
  }
  const maxDistance = options.maxDistanceFromStartMeters ?? 2000
  const fetchRadius =
    maxDistance + Math.max(1000, workPhase.requirements.minUninterruptedMeters ?? 0)
  const ways = await deps.fetchWays(start, fetchRadius)
  const graph = buildGraph(ways)
  const segments = await findWorkSegments(
    graph,
    start,
    workPhase.requirements,
    deps.sampleElevations,
    { maxDistanceFromStartMeters: maxDistance, maxResults: options.maxResults ?? 5 },
  )
  if (segments.length === 0) {
    throw new Error('No suitable work segment found near the start point')
  }
  const segment = segments[0]
  const workPoints = segment.isCycle ? rotateRingToNearest(segment.points, start) : segment.points
  const work = buildWorkGeometry(
    { points: workPoints, lengthMeters: segment.lengthMeters, isCycle: segment.isCycle },
    workPhase.targetMeters,
  )
  const entry = work.points[0]
  const exit = work.points[work.points.length - 1]
  const warmup = await deps.fetchFootRoute(start, entry)
  const cooldown = await deps.fetchFootRoute(exit, start)
  const route = assembleRoute(warmup, work, cooldown)
  return { sessionPlan, route, gpx: toGpx(route, name), segment }
}
```

- [ ] **Step 4: Run tests to verify they pass; lint**

Run: `npm test && npm run lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine
git commit -m "$(cat <<'EOF'
feat: generateRoute orchestrator — session in, GPX-ready course out

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
